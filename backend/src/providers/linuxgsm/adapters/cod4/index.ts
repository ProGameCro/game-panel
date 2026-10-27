import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../../../../config.js';
import * as dockerUtils from '../../../../utils/docker.js';
import { logInfo } from '../../../../utils/logger.js';
import { applyLinuxGsmConfigPatches } from '../linuxGsmConfig.js';
import { runGenericBeforeContainerCreate } from '../generic/index.js';
import { readAdminSettings } from '../../../../services/cod4/settings.js';
import { autoInstallB3 } from '../../../../services/cod4/b3install.js';
import { getServerStoragePaths } from '../../../../utils/storage.js';
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

export type LinkCount = { linked: number; copied: number };

async function copyFile(source: string, target: string): Promise<void> {
    // FICLONE makes a copy-on-write clone where the filesystem supports it and a normal copy elsewhere
    await fs.copyFile(source, target, constants.COPYFILE_FICLONE);
}

// a Linux program or library (ELF), recognised by its content: game files often have the executable bit set too
async function isProgram(file: string): Promise<boolean> {
    const handle = await fs.open(file, 'r');
    try {
        const head = Buffer.alloc(4);
        await handle.read(head, 0, 4, 0);
        return head.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    } finally {
        await handle.close();
    }
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
            // programs are copied too: CoD4X replaces its own binary when it updates
            if (st.size >= LINK_MIN_BYTES && !(await isProgram(from))) {
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

// count: optional, filled while it works (the reinstall shows it as progress)
export async function linkCod4Files(dataDir: string, count: LinkCount = { linked: 0, copied: 0 }): Promise<LinkCount | null> {
    const target = path.join(dataDir, 'serverfiles');
    if (!(await isEmptyDir(target))) return null;
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

// RCON password from the install form (COD4_RCON_PASSWORD): up to 8 letters and numbers, CoD4 refuses others ("Bad rcon")
const RCON_PATTERN = /^[A-Za-z0-9]{1,8}$/;

export function takeCod4RconPassword(env: string[]): { env: string[]; password: string | null } {
    const entry = env.find((item) => item.startsWith('COD4_RCON_PASSWORD='));
    const rest = env.filter((item) => !item.startsWith('COD4_RCON_PASSWORD='));
    const password = entry?.slice('COD4_RCON_PASSWORD='.length).trim() ?? '';
    if (!password) return { env: rest, password: null };
    if (!RCON_PATTERN.test(password)) {
        throw Object.assign(new Error('RCON password: up to 8 characters, small and capital letters and numbers only.'), {
            statusCode: 400,
        });
    }
    return { env: rest, password };
}

// LinuxGSM's startup line for CoD4 (lgsm/config-default/config-lgsm/cod4server/_default.cfg)
const DEFAULT_STARTPARAMETERS =
    '+set sv_punkbuster 0 +set fs_basepath ${serverfiles} +set fs_homepath ${serverfiles} +set sv_authorizemode "-1" ' +
    '+set dedicated 2 +set net_ip ${ip} +set net_port ${port} +set sv_maxclients ${maxplayers} +map ${defaultmap} +exec ${servercfg}';

async function defaultStartParameters(): Promise<string> {
    const content = await fs.readFile(path.join(cod4LinuxGsmKitDir(), '_default.cfg'), 'utf8').catch(() => '');
    const match = /^[ \t]*startparameters=(.*)$/m.exec(content);
    if (!match) return DEFAULT_STARTPARAMETERS;
    const raw = match[1].trim();
    return raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

// this server's FastDL (gp-fastdl.sh): <base>/<server number>, or null when FastDL is not installed
export async function cod4FastDlUrl(serverId: number): Promise<string | null> {
    try {
        const info = JSON.parse(await fs.readFile(path.join(getConfig().gamepanelDataDir, 'fastdl', 'fastdl.json'), 'utf8')) as {
            url?: unknown;
        };
        return typeof info.url === 'string' && /^https?:\/\/\S+$/.test(info.url) ? `${info.url.replace(/\/+$/, '')}/${serverId}` : null;
    } catch {
        return null;
    }
}

// The startup line of a new server, in the same form as the Command line card writes it (startparameters in
// <gameservername>.cfg): FastDL settings before +map / +exec, +rcon_password at the very end (after +exec, so it counts
// even if server.cfg has its own rcon_password).
async function setCod4StartParameters(
    dataDir: string,
    gameServerName: string,
    options: { rconPassword?: string; fastDlUrl?: string | null; mod?: string }
): Promise<void> {
    let parameters = await defaultStartParameters();
    const early = [
        options.mod && `+set fs_game mods/${options.mod}`,
        options.fastDlUrl && `+set sv_allowDownload 1 +set sv_wwwDownload 1 +set sv_wwwBaseURL ${options.fastDlUrl} +set sv_wwwDlDisconnected 0`,
    ]
        .filter(Boolean)
        .join(' ');
    if (early) {
        const at = parameters.search(/\+(?:exec|map|map_rotate|devmap)\b/);
        parameters = at >= 0 ? `${parameters.slice(0, at)}${early} ${parameters.slice(at)}` : `${parameters} ${early}`;
    }
    if (options.rconPassword) parameters = `${parameters} +rcon_password ${options.rconPassword}`;
    await applyLinuxGsmConfigPatches({ dataDir, gameServerName }, [
        { fileName: `${gameServerName}.cfg`, values: { startparameters: parameters } },
    ]);
}

// the new server is called by the name given in the install form, not by the name in the folder's config
// (which came from the server the folder was filled from)
const HOSTNAME_LINE = /^[ \t]*(?:set[as]?[ \t]+)?sv_hostname[ \t].*$/gim;

export async function setCod4Hostname(dataDir: string, gameServerName: string, name: string): Promise<void> {
    const clean = name.replace(/[\x00-\x1f\x7f"]/g, '').trim().slice(0, 64);
    if (!clean) return;
    const file = path.join(dataDir, 'serverfiles', 'main', `${path.basename(gameServerName)}.cfg`);
    const current = await fs.readFile(file, 'utf8').catch(() => '');
    const line = `set sv_hostname "${clean}"`;
    const next = new RegExp(HOSTNAME_LINE.source, 'im').test(current)
        ? current.replace(HOSTNAME_LINE, line)
        : `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`;
    // a new file in place of the old one: never write into a file that may be shared
    const temp = `${file}.tmp-${process.pid}`;
    await fs.writeFile(temp, next, 'utf8');
    await fs.rename(temp, file);
}

// slots chosen in the install form (COD4_MAXPLAYERS), written as LinuxGSM's maxplayers (+set sv_maxclients)
export function cod4MaxPlayers(env: string[] | undefined): number | null {
    const raw = (env ?? []).find((entry) => entry.startsWith('COD4_MAXPLAYERS='))?.slice('COD4_MAXPLAYERS='.length).trim() ?? '';
    const value = Number(raw);
    return /^\d+$/.test(raw) && value >= 1 && value <= 64 ? value : null;
}


// what a new server gets: chosen per server in the install form (Admin > CoD4 files only fills the form in);
// installs without them (API) use the Admin defaults
export type Cod4InstallOptions = { mod: string; fastdl: boolean; b3: boolean; serverCfg: string };

const MOD_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

// install form -> installSecrets (kept for the install only, not with the server)
export function takeCod4InstallOptions(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object') return {};
    const o = value as Record<string, unknown>;
    const mod = String(o.mod ?? '').trim();
    if (mod && (!MOD_PATTERN.test(mod) || mod.startsWith('.'))) {
        throw Object.assign(new Error('Mod: letters, numbers, dot, dash and underscore'), { statusCode: 400 });
    }
    const serverCfg = String(o.serverCfg ?? '');
    if (serverCfg.length > 200_000) throw Object.assign(new Error('The server.cfg is too long'), { statusCode: 400 });
    return { cod4Mod: mod, cod4FastDl: o.fastdl ? '1' : '0', cod4B3: o.b3 ? '1' : '0', cod4ServerCfg: serverCfg };
}

export async function cod4InstallOptions(secrets?: Record<string, string>): Promise<Cod4InstallOptions> {
    const { cod4Defaults } = await readAdminSettings();
    if (!secrets || secrets.cod4FastDl === undefined) {
        return { mod: cod4Defaults.mod, fastdl: cod4Defaults.fastdl, b3: cod4Defaults.b3, serverCfg: cod4Defaults.serverCfg };
    }
    return { mod: secrets.cod4Mod ?? '', fastdl: secrets.cod4FastDl === '1', b3: secrets.cod4B3 === '1', serverCfg: secrets.cod4ServerCfg ?? '' };
}

// the mods in the cod4-linux folder (install form)
export async function listCod4Mods(): Promise<string[]> {
    const entries = await fs.readdir(path.join(cod4FilesDir(), 'mods'), { withFileTypes: true }).catch(() => []);
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort((a, b) => a.localeCompare(b));
}

// the mod when this server's files have it, else none
async function existingMod(dataDir: string, mod: string): Promise<string> {
    if (!mod) return '';
    return (await fs.stat(path.join(dataDir, 'serverfiles', 'mods', mod)).catch(() => null))?.isDirectory() ? mod : '';
}

// the game files of a new server, or of a reinstalled one (server Settings > Game config > Reinstall): linked from the
// cod4-linux folder, the starting server.cfg (the install form; a reinstall keeps the server's own) and the server's name in it
export async function prepareCod4ServerFiles(
    dataDir: string,
    gameServerName: string,
    serverName?: string | null,
    progress?: LinkCount,
    serverCfg?: string
): Promise<LinkCount | null> {
    // checked again here: the folder may have changed since the install was requested
    await assertCod4FilesReady();
    const count = await linkCod4Files(dataDir, progress);
    const startCfg = serverCfg ?? (await readAdminSettings()).cod4Defaults.serverCfg;
    if (startCfg.trim()) {
        const cfg = path.join(dataDir, 'serverfiles', 'main', `${path.basename(gameServerName)}.cfg`);
        await fs.mkdir(path.dirname(cfg), { recursive: true });
        await fs.rm(cfg, { force: true });
        await fs.writeFile(cfg, startCfg.endsWith('\n') ? startCfg : `${startCfg}\n`, 'utf8');
    }
    await ensureServerConfig(dataDir, gameServerName);
    if (serverName) await setCod4Hostname(dataDir, gameServerName, serverName);
    return count;
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
        const options = await cod4InstallOptions(ctx.installSecrets);
        const count = await prepareCod4ServerFiles(ctx.dataDir, ctx.gameServerName, ctx.serverName, undefined, options.serverCfg);
        const mod = await existingMod(ctx.dataDir, options.mod);
        if (options.mod && !mod) logInfo('LINUXGSM:COD4', `Mod ${options.mod} is not in the files, left out`, { serverId: ctx.serverId });
        // a new server gets its RCON password from the install form and its own FastDL link (when FastDL is installed)
        const rconPassword = ctx.installSecrets?.rconPassword;
        const fastDlUrl = options.fastdl ? await cod4FastDlUrl(ctx.serverId) : null;
        if (rconPassword || fastDlUrl || mod) {
            await setCod4StartParameters(ctx.dataDir, ctx.gameServerName, { rconPassword, fastDlUrl, mod });
            if (fastDlUrl) logInfo('LINUXGSM:COD4', `FastDL: ${fastDlUrl}`, { serverId: ctx.serverId });
        }
        if (count) {
            logInfo('LINUXGSM:COD4', `Game files from ${cod4FilesHostDir()}: ${count.linked} linked, ${count.copied} copied`, {
                serverId: ctx.serverId,
            });
        }
    },
    async afterContainerStart(ctx: AfterContainerStartContext): Promise<void> {
        // B3 when the install form asked for it: in the background, the install does not wait for it
        const options = await cod4InstallOptions(ctx.installSecrets);
        if (!options.b3) return;
        const mod = await existingMod(getServerStoragePaths(ctx.serverId).dataDir, options.mod);
        void autoInstallB3(ctx.serverId, mod);
    },
};
