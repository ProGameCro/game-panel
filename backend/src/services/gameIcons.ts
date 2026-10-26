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
