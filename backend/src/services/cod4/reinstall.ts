import fs from 'node:fs/promises';
import path from 'node:path';
import type { GameServerRow } from '../../types/gameServer.js';
import * as dockerUtils from '../../utils/docker.js';
import { getServerStoragePaths } from '../../utils/storage.js';
import { logError, logInfo } from '../../utils/logger.js';
import { actionsRepository } from '../../database/index.js';
import { assertCod4FilesReady, cod4FilesDir, prepareCod4ServerFiles, type LinkCount } from '../../providers/linuxgsm/adapters/cod4/index.js';

// Reinstall of a CoD4 server's game files (server Settings > Game config > Reinstall, or Reinstall in the server list),
// for when something got broken: serverfiles is made again from the cod4-linux folder like for a new server (CoD4X,
// main, zone, starting server.cfg). Kept: the command line (RCON password, slots, FastDL, mod: config-lgsm), B3,
// backups and the FTP account; the mods and custom maps too unless the user asks to delete them. The server must be
// stopped. It runs in the background (copying a few GB can take minutes); the panel follows it with the status below.

export type ReinstallStatus = {
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

function gameServerNameOf(server: GameServerRow): string {
    try {
        const meta = JSON.parse(server.provider_metadata_json ?? '{}') as { shortname?: string; gameservername?: string };
        if (String(meta.shortname ?? '').toLowerCase() !== 'cod4') throw fail('Reinstall is only for Call of Duty 4 servers', 400);
        return String(meta.gameservername || 'cod4server');
    } catch (error) {
        if ((error as { statusCode?: number }).statusCode) throw error;
        throw fail('Reinstall is only for Call of Duty 4 servers', 400);
    }
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
    if (server.provider !== 'linuxgsm') throw fail('Reinstall is only for Call of Duty 4 servers', 400);
    const gameServerName = gameServerNameOf(server);
    if (statuses.get(server.id)?.state === 'running') throw fail('A reinstall of this server is already running', 409);
    if (server.docker_container_id && (await dockerUtils.checkContainerStatus(server.docker_container_id)) === 'running') {
        throw fail('Stop the server first, then reinstall.', 409);
    }
    // before anything is deleted: the cod4-linux folder and the image must be there
    await assertCod4FilesReady();

    const status: ReinstallStatus = {
        state: 'running',
        step: 'checking',
        done: 0,
        total: await countFiles(cod4FilesDir()),
        keepContent,
        kept: [],
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
    };
    statuses.set(server.id, status);
    void runReinstall(server, gameServerName, status, actor);
    return status;
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
        status.step = 'removing';
        await fs.rm(serverfiles, { recursive: true, force: true });
        status.step = 'copying';
        await prepareCod4ServerFiles(dataDir, gameServerName, server.name, count);
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
