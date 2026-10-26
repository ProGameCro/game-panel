import fs from 'node:fs/promises';
import path from 'node:path';
import type { GameServerRow } from '../../types/gameServer.js';
import * as dockerUtils from '../../utils/docker.js';
import { getServerStoragePaths } from '../../utils/storage.js';
import { logInfo } from '../../utils/logger.js';
import { assertCod4FilesReady, prepareCod4ServerFiles } from '../../providers/linuxgsm/adapters/cod4/index.js';

// Reinstall of a CoD4 server's game files (server Settings > Game config > Reinstall), for when something got broken:
// serverfiles is made again from the cod4-linux folder like for a new server (CoD4X, main, zone, starting server.cfg).
// Kept: the command line (RCON password, slots, FastDL, mod: config-lgsm), B3, backups and the FTP account; the mods
// and custom maps too unless the user asks to delete them. The server must be stopped.

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

const running = new Set<number>();

export async function reinstallCod4Server(server: GameServerRow, keepContent: boolean): Promise<{ linked: number; copied: number; kept: string[] }> {
    if (server.provider !== 'linuxgsm') throw fail('Reinstall is only for Call of Duty 4 servers', 400);
    const gameServerName = gameServerNameOf(server);
    if (server.docker_container_id && (await dockerUtils.checkContainerStatus(server.docker_container_id)) === 'running') {
        throw fail('Stop the server first, then reinstall.', 409);
    }
    // before anything is deleted: the cod4-linux folder and the image must be there
    await assertCod4FilesReady();
    if (running.has(server.id)) throw fail('A reinstall of this server is already running', 409);
    running.add(server.id);
    const dataDir = getServerStoragePaths(server.id).dataDir;
    const serverfiles = path.join(dataDir, 'serverfiles');
    const keepDir = path.join(dataDir, `.reinstall-keep-${Date.now()}`);
    const kept: string[] = [];
    try {
        // the mods and maps wait next to it (same disk: a rename, instant)
        if (keepContent) {
            await fs.mkdir(keepDir, { recursive: true });
            for (const section of ['mods', 'usermaps']) {
                const from = path.join(serverfiles, section);
                if (await fs.stat(from).then((st) => st.isDirectory(), () => false)) {
                    await fs.rename(from, path.join(keepDir, section));
                    kept.push(section);
                }
            }
        }
        await fs.rm(serverfiles, { recursive: true, force: true });
        const count = await prepareCod4ServerFiles(dataDir, gameServerName, server.name);
        for (const section of kept) {
            await fs.rm(path.join(serverfiles, section), { recursive: true, force: true });
            await fs.rename(path.join(keepDir, section), path.join(serverfiles, section));
        }
        await fs.rm(keepDir, { recursive: true, force: true });
        logInfo('LINUXGSM:COD4', `Reinstalled the game files${kept.length ? ` (kept ${kept.join(', ')})` : ''}`, { serverId: server.id });
        return { linked: count?.linked ?? 0, copied: count?.copied ?? 0, kept };
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
        throw error;
    } finally {
        running.delete(server.id);
    }
}
