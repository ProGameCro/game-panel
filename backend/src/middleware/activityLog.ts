import fs from 'node:fs/promises';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { getConfig } from '../config.js';

// Activity log for the Admin page: every change made through the panel (anything but GET), who made it and how it
// ended. One JSON line per request in the panel's data folder (activity.jsonl), trimmed to the newest entries.
export type ActivityEntry = { time: number; user: string | null; method: string; path: string; status: number; detail?: string };

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP_LINES = 5000;
// noisy or sensitive requests that are not worth a line
const SKIP = [/^\/api\/auth\/(login|refresh)/, /\/files\/upload/, /\/download-token$/, /\/terminal/];

function logFile(): string {
    return path.join(getConfig().gamepanelDataDir, 'activity.jsonl');
}

let writing: Promise<void> = Promise.resolve();

async function append(entry: ActivityEntry): Promise<void> {
    const file = logFile();
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
    const st = await fs.stat(file).catch(() => null);
    if (st && st.size > MAX_BYTES) {
        const lines = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).slice(-KEEP_LINES);
        await fs.writeFile(`${file}.tmp`, `${lines.join('\n')}\n`, 'utf8');
        await fs.rename(`${file}.tmp`, file);
    }
}

export function recordActivity(entry: ActivityEntry): void {
    writing = writing.then(() => append(entry)).catch(() => undefined);
}

export function activityLog(req: Request, res: Response, next: NextFunction): void {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || SKIP.some((re) => re.test(req.originalUrl))) {
        return next();
    }
    res.on('finish', () => {
        const user = (req as Request & { user?: { username?: string } }).user?.username ?? null;
        recordActivity({
            time: Date.now(),
            user,
            method: req.method,
            path: req.originalUrl.split('?')[0],
            status: res.statusCode,
            detail: (res.locals as { activityDetail?: string }).activityDetail,
        });
    });
    next();
}

export async function readActivity(limit: number): Promise<ActivityEntry[]> {
    const content = await fs.readFile(logFile(), 'utf8').catch(() => '');
    return content
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .reverse()
        .map((line) => {
            try {
                return JSON.parse(line) as ActivityEntry;
            } catch {
                return null;
            }
        })
        .filter((entry): entry is ActivityEntry => entry !== null);
}
