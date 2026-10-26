import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../../../../config.js';
import * as dockerUtils from '../../../../utils/docker.js';
import { logInfo } from '../../../../utils/logger.js';
import { applyLinuxGsmConfigPatches } from '../linuxGsmConfig.js';
import { runGenericBeforeContainerCreate } from '../generic/index.js';
import type {
    AfterContainerStartContext,
    BeforeContainerCreateContext,
    GameAdapter,
} from '../types.js';

// Call of Duty 4: nothing is downloaded when a server is installed (no LinuxGSM GitHub, no CoD4X download).
// - The game files come from the cod4-linux folder (host /opt/gamepanel/cod4-linux, set up by gp-cod4-linux.sh).
//   Big files are hard links to that folder (no extra disk space, instant); small files (configs) are copied.
// - The container runs the local image gamepanel-local/cod4 (built by gp-cod4-linux.sh): the LinuxGSM image with
//   the cod4server script and its default config already inside, so LinuxGSM does not fetch them from GitHub.
export const COD4_LOCAL_IMAGE = 'gamepanel-local/cod4:latest';

// files from this size up are linked, smaller ones copied: a server may edit those in place (server.cfg ...)
const LINK_MIN_BYTES = 1024 * 1024;

export function cod4FilesDir(): string {
    return path.join(getConfig().gamepanelDataDir, 'cod4-linux');
}

// where the admin sees the folder on the host
export function cod4FilesHostDir(): string {
    return path.posix.join(getConfig().gamepanelAppRoot, 'cod4-linux');
}

// LinuxGSM data files new servers need (dependency list), saved by gp-cod4-linux.sh
function cod4LinuxGsmKitDir(): string {
    return path.join(getConfig().gamepanelDataDir, 'cod4-lgsm');
}

export type Cod4FilesStatus = {
    ready: boolean;
    folder: string;
    problems: string[];
};

async function statOrNull(target: string) {
    return fs.stat(target).catch(() => null);
}

export async function checkCod4Files(): Promise<Cod4FilesStatus> {
    const dir = cod4FilesDir();
    const folder = cod4FilesHostDir();
    const problems: string[] = [];

    const root = await statOrNull(dir);
    if (!root?.isDirectory()) {
        problems.push(`The folder ${folder} does not exist. Run gp-cod4-linux.sh on the panel server.`);
    } else {
        const dedrun = await statOrNull(path.join(dir, 'cod4x18_dedrun'));
        if (!dedrun?.isFile()) problems.push('cod4x18_dedrun (the CoD4X server) is missing.');
        const main = await fs.readdir(path.join(dir, 'main')).catch(() => null);
        if (!main) problems.push('The main folder is missing.');
        else if (!main.some((name) => name.toLowerCase().endsWith('.iwd'))) problems.push('The main folder has no .iwd files.');
        const zone = await fs.readdir(path.join(dir, 'zone')).catch(() => null);
        if (!zone || zone.length === 0) problems.push('The zone folder is missing or empty.');
    }
    if (!(await dockerUtils.imageExists(COD4_LOCAL_IMAGE))) {
        problems.push(`The image ${COD4_LOCAL_IMAGE} is missing. Run gp-cod4-linux.sh on the panel server.`);
    }
    return { ready: problems.length === 0, folder, problems };
}

export async function assertCod4FilesReady(): Promise<void> {
    const status = await checkCod4Files();
    if (!status.ready) {
        throw Object.assign(new Error(`CoD4 files are not ready (${status.folder}): ${status.problems.join(' ')}`), {
            statusCode: 400,
        });
    }
}

async function isEmptyDir(dir: string): Promise<boolean> {
    const entries = await fs.readdir(dir).catch(() => null);
    return entries === null || entries.length === 0;
}

type LinkCount = { linked: number; copied: number };

async function copyFile(source: string, target: string): Promise<void> {
    // FICLONE makes a copy-on-write clone where the filesystem supports it and a normal copy elsewhere
    await fs.copyFile(source, target, constants.COPYFILE_FICLONE);
}

async function linkTree(source: string, target: string, count: LinkCount): Promise<void> {
    await fs.mkdir(target, { recursive: true });
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name);
        const to = path.join(target, entry.name);
        if (entry.isDirectory()) {
            await linkTree(from, to, count);
        } else if (entry.isSymbolicLink()) {
            await fs.symlink(await fs.readlink(from), to);
        } else if (entry.isFile()) {
            if (/\.log(\.\d+)?$/i.test(entry.name)) continue;
            const st = await fs.stat(from);
            // executables are copied too: CoD4X replaces its own binary when it updates
            if (st.size >= LINK_MIN_BYTES && (st.mode & 0o111) === 0) {
                try {
                    await fs.link(from, to);
                    count.linked++;
                    continue;
                } catch {
                    // another filesystem (or links not allowed): copy instead
                }
            }
            await copyFile(from, to);
            count.copied++;
        }
    }
}

export async function linkCod4Files(dataDir: string): Promise<LinkCount | null> {
    const target = path.join(dataDir, 'serverfiles');
    if (!(await isEmptyDir(target))) return null;
    const count: LinkCount = { linked: 0, copied: 0 };
    try {
        await linkTree(cod4FilesDir(), target, count);
    } catch (error) {
        await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
    return count;
}

const CONFIG_HEADER = '# LinuxGSM settings for this server; values here override _default.cfg';

// the files LinuxGSM would otherwise fetch from GitHub on the first start
async function prepareLinuxGsmFiles(dataDir: string, gameServerName: string): Promise<void> {
    const configDir = path.join(dataDir, 'config-lgsm', path.basename(gameServerName));
    await fs.mkdir(configDir, { recursive: true });
    for (const name of ['common.cfg', 'secrets-common.cfg', `${gameServerName}.cfg`, `secrets-${gameServerName}.cfg`]) {
        await fs.writeFile(path.join(configDir, name), CONFIG_HEADER, { flag: 'wx' }).catch((error) => {
            if (error?.code !== 'EEXIST') throw error;
        });
    }
    const kitData = path.join(cod4LinuxGsmKitDir(), 'data');
    const dataTarget = path.join(dataDir, 'data');
    await fs.mkdir(dataTarget, { recursive: true });
    for (const name of await fs.readdir(kitData).catch(() => [] as string[])) {
        await copyFile(path.join(kitData, name), path.join(dataTarget, name)).catch(() => undefined);
    }
}

// LinuxGSM downloads a default server config when the server has none (cod4server.cfg in main)
const DEFAULT_SERVER_CFG = `// CoD4X settings for this server. Port, slots and the first map are set on the startup line
// (Settings > Game config > Command line).
set sv_hostname "CoD4X Server"
set g_gametype "war"
set sv_mapRotation "gametype war map mp_backlot map mp_crash map mp_crossfire map mp_strike map mp_vacant"
`;

async function ensureServerConfig(dataDir: string, gameServerName: string): Promise<void> {
    const mainDir = path.join(dataDir, 'serverfiles', 'main');
    await fs.mkdir(mainDir, { recursive: true });
    await fs.writeFile(path.join(mainDir, `${path.basename(gameServerName)}.cfg`), DEFAULT_SERVER_CFG, { flag: 'wx' }).catch((error) => {
        if (error?.code !== 'EEXIST') throw error;
    });
}

// slots chosen in the install form (COD4_MAXPLAYERS), written as LinuxGSM's maxplayers (+set sv_maxclients)
export function cod4MaxPlayers(env: string[] | undefined): number | null {
    const raw = (env ?? []).find((entry) => entry.startsWith('COD4_MAXPLAYERS='))?.slice('COD4_MAXPLAYERS='.length).trim() ?? '';
    const value = Number(raw);
    return /^\d+$/.test(raw) && value >= 1 && value <= 64 ? value : null;
}

export const cod4Adapter: GameAdapter = {
    async beforeContainerCreate(ctx: BeforeContainerCreateContext): Promise<void> {
        await runGenericBeforeContainerCreate(ctx);
        await prepareLinuxGsmFiles(ctx.dataDir, ctx.gameServerName);
        const slots = cod4MaxPlayers(ctx.env);
        if (slots !== null) {
            await applyLinuxGsmConfigPatches({ dataDir: ctx.dataDir, gameServerName: ctx.gameServerName }, [
                { fileName: `${ctx.gameServerName}.cfg`, values: { maxplayers: String(slots) } },
            ]);
        }
        // checked again here: the folder may have changed since the install was requested
        await assertCod4FilesReady();
        const count = await linkCod4Files(ctx.dataDir);
        await ensureServerConfig(ctx.dataDir, ctx.gameServerName);
        if (count) {
            logInfo('LINUXGSM:COD4', `Game files from ${cod4FilesHostDir()}: ${count.linked} linked, ${count.copied} copied`, {
                serverId: ctx.serverId,
            });
        }
    },
    async afterContainerStart(_ctx: AfterContainerStartContext): Promise<void> {
        return;
    },
};
