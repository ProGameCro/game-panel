import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, type Response } from 'express';
import { getConfig } from '../config.js';
import { authMiddleware, rootOnly, type AuthenticatedRequest } from '../middleware/auth.js';
import { requireBodyObject } from '../utils/httpValidation.js';
import { sendRouteError } from '../utils/routeErrors.js';

// The news bar above the server list, written by the panel's own admins instead of OVHcloud's catalog.
// Stored in the panel's data folder (news.json), so it survives rebuilds and updates.
const router = Router();
const MAX_ITEMS = 30;
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 1000;
const ICON_KEYS = new Set(['news', 'info', 'update', 'event', 'success', 'warning', 'maintenance', 'restart', 'server', 'security']);

export type PanelNewsItem = {
    id: number;
    title: string;
    description: string;
    date: number;
    iconKey: string;
    position: number;
    type: string | null;
};

function newsFile(): string {
    return path.join(getConfig().gamepanelDataDir, 'news.json');
}

async function readNews(): Promise<PanelNewsItem[]> {
    try {
        const parsed = JSON.parse(await fs.readFile(newsFile(), 'utf8')) as { news?: unknown };
        return Array.isArray(parsed.news) ? (parsed.news as PanelNewsItem[]) : [];
    } catch {
        return [];
    }
}

function cleanText(value: unknown, max: number): string {
    // control characters out, except line breaks in the description
    return typeof value === 'string' ? value.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '').trim().slice(0, max) : '';
}

function badRequest(message: string): Error {
    return Object.assign(new Error(message), { statusCode: 400 });
}

function normalizeItems(raw: unknown): PanelNewsItem[] {
    if (!Array.isArray(raw)) throw badRequest('news must be a list');
    if (raw.length > MAX_ITEMS) throw badRequest(`At most ${MAX_ITEMS} news`);
    const now = Date.now();
    return raw.map((entry, index) => {
        const item = (entry ?? {}) as Record<string, unknown>;
        const title = cleanText(item.title, MAX_TITLE).replace(/\s+/g, ' ');
        if (!title) throw badRequest(`News ${index + 1}: the title is empty`);
        const description = cleanText(item.description, MAX_DESCRIPTION);
        const iconKey = typeof item.iconKey === 'string' && ICON_KEYS.has(item.iconKey) ? item.iconKey : 'news';
        const date = Number(item.date);
        return {
            id: index + 1,
            title,
            description,
            date: Number.isFinite(date) && date > 0 ? Math.round(date) : now,
            iconKey,
            position: index,
            type: null,
        };
    });
}

// GET /api/news: the news, in the order the admin set
router.get('/', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ news: await readNews() });
});

// PUT /api/news { news: [{ title, description, iconKey, date }] }: replaces all news (Super Admins only)
router.put('/', authMiddleware, rootOnly, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const news = normalizeItems(requireBodyObject(req.body).news);
        const file = newsFile();
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temp = `${file}.tmp`;
        await fs.writeFile(temp, `${JSON.stringify({ news }, null, 2)}\n`, 'utf8');
        await fs.rename(temp, file);
        res.json({ news });
    } catch (error) {
        sendRouteError(res, error, { route: 'ROUTE:NEWS:SAVE', fallbackMessage: 'Could not save the news' });
    }
});

export default router;
