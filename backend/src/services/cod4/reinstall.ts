import fs from 'node:fs/promises';
import path from 'node:path';
import type { GameServerRow } from '../../types/gameServer.js';
import * as dockerUtils from '../../utils/docker.js';
import { getServerStoragePaths } from '../../utils/storage.js';
import { logError, logInfo } from '../../utils/logger.js';
import { actionsRepository } from '../../database/index.js';
import { getServerWipeModes, hardWipeServer } from '../serverWipe.js';
import { assertCod4FilesReady, cod4FilesDir, prepareCod4ServerFiles, type LinkCount } from '../../providers/linuxgsm/adapters/cod4/index.js';

// Reinstall of a server's game files (any game; CoD4 below, the others in runGenericReinstall).
// Reinstall of a CoD4 server's game files (server Settings > Game config > Reinstall, or Reinstall in the server list),
// for when something got broken: serverfiles is made again from the cod4-linux folder like for a new server (CoD4X,
// main, zone, starting server.cfg). Kept: the command line (RCON password, slots, FastDL, mod: config-lgsm), B3,
// backups and the FTP account; the mods and custom maps too unless the user asks to delete them. The server must be
// stopped. It runs in the background (copying a few GB can take minutes); the panel follows it with the status below.

// cod4: from the cod4-linux folder; linuxgsm: serverfiles emptied, LinuxGSM downloads the game again on the next start;
// ovhcloud: the game's own reinstall (hard wipe), the server installs and starts again by itself
export type ReinstallKind = 'cod4' | 'linuxgsm' | 'ovhcloud';

export type ReinstallStatus = {
    kind: ReinstallKind;
    state: 'running' | 'done' | 'error';
    step: 'checking' | 'removing' | 'copying' | 'config' | 'restoring' | 'done';
    done: number;
    total: number;
    keepContent: boolean;
    kept: string[];
    startedAt: number;
    finishedAt: number | null;
    error: string | null;
};

function fail(message: string, statusCode: number): Error {
    return Object.assign(new Error(message), { statusCode });
}

function metaOf(server: GameServerRow): { shortname?: string; gameservername?: string } {
    try {
        return JSON.parse(server.provider_metadata_json ?? '{}') as { shortname?: string; gameservername?: string };
    } catch {
        return {};
    }
}

// how this server is reinstalled, or null when it cannot be (custom Docker images)
export function reinstallKindOf(server: GameServerRow): ReinstallKind | null {
    if (server.provider === 'linuxgsm') return String(metaOf(server).shortname ?? '').toLowerCase() === 'cod4' ? 'cod4' : 'linuxgsm';
    if (server.provider === 'ovhcloud') return getServerWipeModes(server).includes('hard') ? 'ovhcloud' : null;
    return null;
}

// the files a new server gets from the cod4-linux folder (no logs), for the progress bar
async function countFiles(dir: string): Promise<number> {
    let n = 0;
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (entry.isDirectory()) n += await countFiles(path.join(dir, entry.name));
        else if (!/\.log(\.\d+)?$/i.test(entry.name)) n++;
    }
    return n;
}

const statuses = new Map<number, ReinstallStatus>();
const progress = new Map<number, LinkCount>();

export function getReinstallStatus(serverId: number): ReinstallStatus | null {
    const status = statuses.get(serverId);
    if (!status) return null;
    const count = progress.get(serverId);
    return count && status.step === 'copying' ? { ...status, done: count.linked + count.copied } : status;
}

// checks, then starts the reinstall in the background
export async function startCod4Reinstall(server: GameServerRow, keepContent: boolean, actor: string): Promise<ReinstallStatus> {
    const kind = reinstallKindOf(server);
    if (!kind) throw fail('This server cannot be reinstalled from the panel (custom Docker image).', 400);
    if (statuses.get(server.id)?.state === 'running') throw fail('A reinstall of this server is already running', 409);
    if (server.docker_container_id && (await dockerUtils.checkContainerStatus(server.docker_container_id)) === 'running') {
        throw fail('Stop the server first, then reinstall.', 409);
    }
    // before anything is deleted: the cod4-linux folder and the image must be there
    if (kind === 'cod4') await assertCod4FilesReady();

    const status: ReinstallStatus = {
        kind,
        state: 'running',
        step: 'checking',
        done: 0,
        total: kind === 'cod4' ? await countFiles(cod4FilesDir()) : 0,
        keepContent,
        kept: [],
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
    };
    statuses.set(server.id, status);
    if (kind === 'cod4') void runReinstall(server, String(metaOf(server).gameservername || 'cod4server'), status, actor);
    else void runGenericReinstall(server, kind, status, actor);
    return status;
}

// other games: LinuxGSM installs the game again when the container starts with an empty serverfiles (its entrypoint);
// OVHcloud images have their own reinstall (hard wipe), which also starts the install
async function runGenericReinstall(server: GameServerRow, kind: ReinstallKind, status: ReinstallStatus, actor: string): Promise<void> {
    try {
        status.step = 'removing';
        if (kind === 'ovhcloud') {
            await hardWipeServer(server as GameServerRow & { docker_container_id: string }, actor);
        } else {
            // the folder itself stays (the container's mount), only what is in it goes
            const serverfiles = path.join(getServerStoragePaths(server.id).dataDir, 'serverfiles');
            for (const name of await fs.readdir(serverfiles).catch(() => [] as string[])) {
                await fs.rm(path.join(serverfiles, name), { recursive: true, force: true });
            }
            await fs.mkdir(serverfiles, { recursive: true });
        }
        Object.assign(status, { state: 'done', step: 'done', finishedAt: Date.now() });
        logInfo('SERVERS:REINSTALL', kind === 'ovhcloud' ? 'Reinstall started (hard wipe)' : 'Game files removed: LinuxGSM installs the game on the next start', {
            serverId: server.id,
        });
        await actionsRepository
            .create(server.id, 'success', kind === 'ovhcloud' ? 'Server reinstall started' : 'Game files removed for a reinstall', actor)
            .catch(() => undefined);
    } catch (error) {
        Object.assign(status, { state: 'error', finishedAt: Date.now(), error: error instanceof Error ? error.message : String(error) });
        logError('SERVERS:REINSTALL', error, { serverId: server.id });
    }
}

async function runReinstall(server: GameServerRow, gameServerName: string, status: ReinstallStatus, actor: string): Promise<void> {
    const dataDir = getServerStoragePaths(server.id).dataDir;
    const serverfiles = path.join(dataDir, 'serverfiles');
    const keepDir = path.join(dataDir, `.reinstall-keep-${Date.now()}`);
    const kept = status.kept;
    const count: LinkCount = { linked: 0, copied: 0 };
    progress.set(server.id, count);
    try {
        // the mods and maps wait next to it (same disk: a rename, instant)
        if (status.keepContent) {
            await fs.mkdir(keepDir, { recursive: true });
            for (const section of ['mods', 'usermaps']) {
                const from = path.join(serverfiles, section);
                if (await fs.stat(from).then((st) => st.isDirectory(), () => false)) {
                    await fs.rename(from, path.join(keepDir, section));
                    kept.push(section);
                }
            }
        }
        // the server keeps its own server.cfg (not the starting one of new servers)
        const ownCfg = await fs.readFile(path.join(serverfiles, 'main', `${path.basename(gameServerName)}.cfg`), 'utf8').catch(() => undefined);
        status.step = 'removing';
        await fs.rm(serverfiles, { recursive: true, force: true });
        status.step = 'copying';
        await prepareCod4ServerFiles(dataDir, gameServerName, server.name, count, ownCfg);
        status.done = count.linked + count.copied;
        status.step = 'restoring';
        for (const section of kept) {
            await fs.rm(path.join(serverfiles, section), { recursive: true, force: true });
            await fs.rename(path.join(keepDir, section), path.join(serverfiles, section));
        }
        await fs.rm(keepDir, { recursive: true, force: true });
        Object.assign(status, { state: 'done', step: 'done', finishedAt: Date.now() });
        logInfo('LINUXGSM:COD4', `Reinstalled the game files${kept.length ? ` (kept ${kept.join(', ')})` : ''}`, { serverId: server.id });
        await actionsRepository
            .create(server.id, 'success', `Game files reinstalled${kept.length ? ' (mods and maps kept)' : ''}`, actor)
            .catch(() => undefined);
    } catch (error) {
        // whatever was kept goes back, so nothing of the user's is lost
        for (const section of kept) {
            const saved = path.join(keepDir, section);
            if (await fs.stat(saved).then(() => true, () => false)) {
                await fs.mkdir(serverfiles, { recursive: true }).catch(() => undefined);
                await fs.rm(path.join(serverfiles, section), { recursive: true, force: true }).catch(() => undefined);
                await fs.rename(saved, path.join(serverfiles, section)).catch(() => undefined);
            }
        }
        await fs.rm(keepDir, { recursive: true, force: true }).catch(() => undefined);
        Object.assign(status, { state: 'error', finishedAt: Date.now(), error: error instanceof Error ? error.message : String(error) });
        logError('LINUXGSM:COD4:REINSTALL', error, { serverId: server.id });
    } finally {
        progress.delete(server.id);
    }
}
