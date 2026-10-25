import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, type Response } from 'express';
import { getConfig } from '../config.js';
import { authMiddleware, rootOnly, type AuthenticatedRequest } from '../middleware/auth.js';
import { requireBodyObject } from '../utils/httpValidation.js';
import { sendRouteError } from '../utils/routeErrors.js';

// Custom panel name shown instead of the "OVHcloud Game Panel" logo (sidebar, login page, browser tab).
// Stored in the panel's data folder, so it survives rebuilds and updates. Reading it needs no login (login page).
const router = Router();
const MAX_NAME_LENGTH = 40;

function brandingFile(): string {
    return path.join(getConfig().gamepanelDataDir, 'branding.json');
}

async function readName(): Promise<string | null> {
    try {
        const parsed = JSON.parse(await fs.readFile(brandingFile(), 'utf8')) as { name?: unknown };
        return typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null;
    } catch {
        return null;
    }
}

// GET /api/branding
router.get('/', async (_req, res: Response) => {
    res.json({ name: await readName() });
});

// PUT /api/branding  { name: string }  (empty name = back to the OVHcloud logo)
router.put('/', authMiddleware, rootOnly, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const body = requireBodyObject(req.body);
        const raw = typeof body.name === 'string' ? body.name : '';
        // no control characters; spaces collapsed
        const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
        if (name.length > MAX_NAME_LENGTH) {
            return res.status(400).json({ error: `The name can have at most ${MAX_NAME_LENGTH} characters` });
        }
        const file = brandingFile();
        if (name) {
            await fs.writeFile(`${file}.tmp`, `${JSON.stringify({ name }, null, 2)}\n`, 'utf8');
            await fs.rename(`${file}.tmp`, file);
        } else {
            await fs.rm(file, { force: true });
        }
        return res.json({ name: name || null });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:BRANDING:UPDATE',
            fallbackMessage: 'Could not save the panel name',
        });
    }
});

export default router;
