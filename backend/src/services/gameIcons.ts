import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../config.js';

// Game icons set by a Super Admin (Admin > Panel > Game icons), shown left of the server names. One picture per game
// (the server's game key, e.g. cod4, cs), in the panel's data folder (game-icons/<game>.<ext>). PNG, JPG, WEBP or GIF
// only (no SVG: a picture served by the panel must not be able to run scripts).
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const MAX_BYTES = 512 * 1024;
export const GAME_KEY = /^[a-z0-9][a-z0-9_.-]{0,40}$/;

const dir = () => path.join(getConfig().gamepanelDataDir, 'game-icons');

function bad(message: string, statusCode = 400): Error {
    return Object.assign(new Error(message), { statusCode });
}

export async function listGameIcons(): Promise<Record<string, string>> {
    const icons: Record<string, string> = {};
    for (const name of await fs.readdir(dir()).catch(() => [] as string[])) {
        const m = /^(.+)\.(png|jpg|webp|gif)$/.exec(name);
        if (!m || !GAME_KEY.test(m[1])) continue;
        const st = await fs.stat(path.join(dir(), name)).catch(() => null);
        // the time in the link: a new picture is not taken from the browser's cache
        if (st) icons[m[1]] = `/api/branding/game-icons/${m[1]}?v=${Math.round(st.mtimeMs)}`;
    }
    return icons;
}

export async function readGameIcon(key: string): Promise<{ data: Buffer; type: string } | null> {
    if (!GAME_KEY.test(key)) return null;
    for (const [ext, type] of Object.entries(TYPES)) {
        const data = await fs.readFile(path.join(dir(), `${key}.${ext}`)).catch(() => null);
        if (data) return { data, type };
    }
    return null;
}

// an icon set or removed by hand is not touched by a later Steam import
export async function forgetImportedIcon(key: string): Promise<void> {
    const keys = await readImported();
    if (keys.includes(key)) await writeImported(keys.filter((k) => k !== key));
}

export async function deleteGameIcon(key: string): Promise<void> {
    if (!GAME_KEY.test(key)) throw bad('Invalid game');
    for (const ext of Object.keys(TYPES)) await fs.rm(path.join(dir(), `${key}.${ext}`), { force: true });
}

// dataUrl: data:image/png;base64,... from the browser
export async function saveGameIcon(key: string, dataUrl: unknown): Promise<void> {
    if (!GAME_KEY.test(key)) throw bad('Invalid game');
    const m = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
    if (!m) throw bad('Choose a PNG, JPG, WEBP or GIF picture');
    const data = Buffer.from(m[2], 'base64');
    if (data.length === 0 || data.length > MAX_BYTES) throw bad('The picture can be at most 512 KB');
    // the file must really be that kind of picture
    const magic: Record<string, (b: Buffer) => boolean> = {
        png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
        jpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
        webp: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
        gif: (b) => b.subarray(0, 3).toString() === 'GIF',
    };
    if (!magic[m[1]](data)) throw bad('The file is not a valid picture');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    await fs.mkdir(dir(), { recursive: true });
    await deleteGameIcon(key);
    await fs.writeFile(path.join(dir(), `${key}.${ext}.tmp`), data);
    await fs.rename(path.join(dir(), `${key}.${ext}.tmp`), path.join(dir(), `${key}.${ext}`));
}

// ---- official icons from Steam, downloaded on the panel server (not kept in the repository: they are the games')
// game key (LinuxGSM short name, or the family of an OVHcloud image) -> the game's Steam app id. Games that are not on
// Steam (Minecraft, Hytale, Teamspeak ...) keep the panel's own badge, or an icon set in Admin > Panel > Game icons.
export const STEAM_APPS: Record<string, number> = {
    ac: 244210, ark: 346110, arma3: 107410, armar: 1874880, ats: 270880, av: 445220, bb2: 346330, bmdm: 362890,
    bo: 296300, bs: 225600, bt: 602960, btl: 489940, cc: 355180, ce: 440900, ck: 1621690, cmw: 219640, cod: 2620,
    cod2: 2630, coduo: 2640, codwaw: 10090, col: 366090, cs: 10, cs2: 730, cscz: 80, csgo: 730, css: 240, ct: 1307550,
    dab: 317360, dayz: 221100, dmc: 40, dod: 30, dods: 300, doi: 447820, dst: 322330, dys: 17580, eco: 382310,
    em: 17740, ets2: 227300, fctr: 427520, fof: 265630, gmod: 4000, hl2dm: 320, hldm: 70, hldms: 360, hw: 393420,
    hz: 1766060, ins: 222880, inss: 581320, ios: 673560, jc2: 8190, jc3: 225540, jk2: 6030, jk3: 6020, kf: 1250,
    kf2: 232090, l4d: 500, l4d2: 550, mh: 629760, nd: 17710, nec: 1169040, nmrih: 224260, ns2: 4920, ns2c: 4920,
    ohd: 736590, opfor: 50, pc: 234630, pc2: 378860, pvkii: 17570, pvr: 555160, pw: 1623730, pz: 108600, q2: 2320,
    q3: 2200, q4: 2210, ql: 282440, qw: 2310, ricochet: 60, ro: 1200, rtcw: 9010, rust: 252490, rw: 324080,
    rwr: 270150, sb: 211820, scpsl: 700330, sdtd: 251570, sf: 526870, sm: 2646460, sol: 638490, squad: 393380,
    squad44: 736220, st: 544550, stn: 541300, sven: 225840, terraria: 105600, tf: 2285150, tf2: 440, tfc: 20,
    ti: 376210, tu: 394690, tw: 380840, unt: 304930, ut2k4: 13230, ut3: 13210, ut99: 13240, vh: 892970, wf: 671610,
    wurm: 366220, zps: 17500,
    // OVHcloud images (their image id; rust is the same key as LinuxGSM's)
    'counter-strike-2': 730, 'garrys-mod': 4000, palworld: 1623730, 'project-zomboid': 108600, valheim: 892970,
};

export type SteamImportStatus = {
    running: boolean;
    startedAt: number | null;
    finishedAt: number | null;
    done: number;
    total: number;
    added: string[];
    failed: string[];
};

const steamStatus: SteamImportStatus = { running: false, startedAt: null, finishedAt: null, done: 0, total: 0, added: [], failed: [] };

export function getSteamImportStatus(): SteamImportStatus {
    return steamStatus;
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!res?.ok) return null;
    return Buffer.from(await res.arrayBuffer());
}

// the game's square Steam icon (its community icon, found through api.steamcmd.net), else its small store capsule
async function steamIcon(appId: number): Promise<Buffer | null> {
    const info = await fetch(`https://api.steamcmd.net/v1/info/${appId}`, { signal: AbortSignal.timeout(15000) })
        .then((res) => (res.ok ? (res.json() as Promise<{ data?: Record<string, { common?: { icon?: string } }> }>) : null))
        .catch(() => null);
    const hash = info?.data?.[String(appId)]?.common?.icon;
    if (hash && /^[0-9a-f]{40}$/.test(hash)) {
        const icon = await fetchBuffer(`https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appId}/${hash}.jpg`);
        if (icon) return icon;
    }
    return fetchBuffer(`https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_sm_120.jpg`);
}

// every game in STEAM_APPS that has no icon yet (an icon set by hand is never replaced); force: also the ones the
// import put there before
export function startSteamIconImport(force = false): SteamImportStatus {
    if (steamStatus.running) return steamStatus;
    Object.assign(steamStatus, { running: true, startedAt: Date.now(), finishedAt: null, done: 0, added: [], failed: [] });
    void (async () => {
        try {
            const have = await listGameIcons();
            const imported = new Set(await readImported());
            // CoD4 has the panel's own icon
            const keys = Object.keys(STEAM_APPS).filter((key) => key !== 'cod4' && (!have[key] || (force && imported.has(key))));
            steamStatus.total = keys.length;
            const cache = new Map<number, Buffer | null>();
            for (const key of keys) {
                const appId = STEAM_APPS[key];
                if (!cache.has(appId)) cache.set(appId, await steamIcon(appId).catch(() => null));
                const data = cache.get(appId);
                const kind = data && data[0] === 0xff && data[1] === 0xd8 ? 'jpeg' : data && data.subarray(0, 4).toString('hex') === '89504e47' ? 'png' : null;
                if (data && kind) {
                    await saveGameIcon(key, `data:image/${kind};base64,${data.toString('base64')}`).then(
                        () => {
                            steamStatus.added.push(key);
                            imported.add(key);
                        },
                        () => steamStatus.failed.push(key)
                    );
                } else {
                    steamStatus.failed.push(key);
                }
                steamStatus.done++;
            }
            await writeImported([...imported]);
        } finally {
            steamStatus.running = false;
            steamStatus.finishedAt = Date.now();
        }
    })();
    return steamStatus;
}

// which icons came from Steam (so a later import may refresh them, never the ones set by hand)
const importedFile = () => path.join(dir(), '.steam-imported.json');

async function readImported(): Promise<string[]> {
    try {
        return JSON.parse(await fs.readFile(importedFile(), 'utf8')) as string[];
    } catch {
        return [];
    }
}

async function writeImported(keys: string[]): Promise<void> {
    await fs.mkdir(dir(), { recursive: true });
    await fs.writeFile(importedFile(), JSON.stringify(keys.sort()), 'utf8');
}

// once, a minute after the panel starts (after an update): the icons are there without anyone doing anything
export function scheduleFirstSteamIconImport(): void {
    setTimeout(() => {
        void fs
            .access(importedFile())
            .then(
                () => undefined,
                () => startSteamIconImport()
            );
    }, 60_000).unref();
}
