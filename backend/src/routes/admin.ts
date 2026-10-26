import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Router, type Response } from 'express';
import { authMiddleware, rootOnly, type AuthenticatedRequest } from '../middleware/auth.js';
import { getConfig } from '../config.js';
import { serverRepository } from '../database/index.js';
import { docker } from '../utils/docker/client.js';
import { getServerStoragePaths } from '../utils/storage.js';

// Admin page (Super Admins): everything the panel can tell about the servers' add-ons (B3, FastDL), the host and what
// needs attention, in one call. Server status, metrics and players come from the endpoints the panel already uses.
const router = Router();
router.use(authMiddleware, rootOnly);

type Alert = { level: 'error' | 'warning'; text: string; serverId?: number };

async function readJson<T>(file: string): Promise<T | null> {
    try {
        return JSON.parse(await fs.readFile(file, 'utf8')) as T;
    } catch {
        return null;
    }
}

async function exists(file: string): Promise<boolean> {
    return fs.access(file).then(() => true, () => false);
}

// statuses that are on their way somewhere: no alert while a server is in one of them
const MOVING = new Set(['starting', 'restarting', 'stopping', 'installing', 'creating', 'updating']);

type B3Status = { state?: string; heartbeat?: number; lastAction?: { action?: string; result?: string } | null };

async function b3Info(dataDir: string) {
    const b3 = path.join(dataDir, 'b3');
    if (!(await exists(b3))) return null;
    const status = await readJson<B3Status>(path.join(b3, 'status.json'));
    const heartbeatAge = typeof status?.heartbeat === 'number' ? Math.round(Date.now() / 1000 - status.heartbeat) : null;
    return {
        state: status?.state ?? 'unknown',
        // B3 should run when its last action in the panel was Start (or Restart) and that worked
        wanted: ['start', 'restart'].includes(status?.lastAction?.action ?? '') && status?.lastAction?.result !== 'error',
        heartbeatAge,
    };
}

// FastDL on for a CoD4 server: sv_wwwDownload 1 on its startup line (LinuxGSM instance config)
async function fastDlOn(dataDir: string): Promise<boolean | null> {
    const configDir = path.join(dataDir, 'config-lgsm', 'cod4server');
    if (!(await exists(configDir))) return null;
    for (const name of ['secrets-cod4server.cfg', 'cod4server.cfg', 'secrets-common.cfg', 'common.cfg']) {
        const content = await fs.readFile(path.join(configDir, name), 'utf8').catch(() => '');
        const line = /^\s*startparameters=(.*)$/m.exec(content)?.[1];
        if (line !== undefined) return /\+set\s+sv_wwwDownload\s+\\?"?1/i.test(line);
    }
    return false;
}

async function diskOf(dir: string) {
    try {
        const st = await fs.statfs(dir);
        const total = st.blocks * st.bsize;
        const free = st.bavail * st.bsize;
        return { total, free, used: total - free };
    } catch {
        return null;
    }
}

// folder sizes (counting hard-linked files once), cached: walking a few servers takes a moment
let sizeCache: { at: number; sizes: Record<string, number> } | null = null;

async function folderSize(dir: string, seen: Set<string>): Promise<number> {
    let total = 0;
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            total += await folderSize(full, seen);
        } else if (entry.isFile()) {
            const st = await fs.lstat(full).catch(() => null);
            if (!st) continue;
            const id = `${st.dev}:${st.ino}`;
            if (seen.has(id)) continue;
            seen.add(id);
            total += st.size;
        }
    }
    return total;
}

async function folderSizes(serverIds: number[]): Promise<Record<string, number>> {
    if (sizeCache && Date.now() - sizeCache.at < 5 * 60_000) return sizeCache.sizes;
    const sizes: Record<string, number> = {};
    // the shared CoD4 files first, so each server only counts what is its own
    const seen = new Set<string>();
    sizes['cod4-linux'] = await folderSize(path.join(getConfig().gamepanelDataDir, 'cod4-linux'), seen);
    for (const id of serverIds) {
        sizes[String(id)] = await folderSize(getServerStoragePaths(id).serverRoot, seen);
    }
    sizeCache = { at: Date.now(), sizes };
    return sizes;
}

router.get('/overview', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const alerts: Alert[] = [];
        const dataRoot = getConfig().gamepanelDataDir;
        const rows = await serverRepository.listAll();

        // ---- servers: add-ons and state
        const servers = await Promise.all(
            rows.map(async (row) => {
                const dataDir = getServerStoragePaths(row.id).dataDir;
                const isCod4 = row.catalog_id === 'cod4';
                const [b3, fastdl] = isCod4 ? await Promise.all([b3Info(dataDir), fastDlOn(dataDir)]) : [null, null];
                const status = String(row.status ?? 'unknown');
                if (row.desired_state === 'running' && status !== 'running' && !MOVING.has(status)) {
                    alerts.push({ level: 'error', text: `${row.name} should be running but is ${status}.`, serverId: row.id });
                }
                if (b3?.wanted && b3.state !== 'running') {
                    alerts.push({ level: 'error', text: `${row.name}: B3 is ${b3.state}.`, serverId: row.id });
                }
                return { id: row.id, name: row.name, catalogId: row.catalog_id, status, desiredState: row.desired_state, b3, fastdl };
            })
        );
        const b3Ages = servers.map((s) => s.b3?.heartbeatAge).filter((age): age is number => typeof age === 'number');
        if (b3Ages.length > 0 && Math.min(...b3Ages) > 180) {
            alerts.push({ level: 'warning', text: 'The B3 service (gamepanel-b3) has not reported for a while: systemctl status gamepanel-b3' });
        }

        // ---- FastDL
        const fastdlDir = path.join(dataRoot, 'fastdl');
        const info = await readJson<{ url?: string; browserUrl?: string }>(path.join(fastdlDir, 'fastdl.json'));
        let fastdl: Record<string, unknown> = { installed: false };
        if (info?.url) {
            const manifest = (await readJson<string[]>(path.join(fastdlDir, 'manifest.json'))) ?? [];
            const status = await readJson<{ time?: number; ok?: boolean; error?: string }>(path.join(fastdlDir, 'status.json'));
            const running = await docker
                .getContainer('gamepanel-fastdl')
                .inspect()
                .then((c) => Boolean(c.State?.Running))
                .catch(() => false);
            const syncAge = typeof status?.time === 'number' ? Math.round(Date.now() / 1000 - status.time) : null;
            const published: Record<string, number> = {};
            for (const rel of manifest) {
                const key = rel.split('/')[0];
                published[key] = (published[key] ?? 0) + 1;
            }
            fastdl = {
                installed: true,
                url: info.url,
                browserUrl: info.browserUrl || null,
                running,
                lastSync: typeof status?.time === 'number' ? Math.round(status.time * 1000) : null,
                serviceAlive: syncAge !== null && syncAge < 120,
                published,
            };
            if (!running) alerts.push({ level: 'error', text: 'The FastDL web server (gamepanel-fastdl) is not running: bash gp-fastdl.sh' });
            if (syncAge === null || syncAge >= 120) {
                alerts.push({ level: 'warning', text: 'The FastDL sync service is not running: systemctl status gamepanel-fastdl' });
            } else if (status?.ok === false) {
                alerts.push({ level: 'error', text: `FastDL sync failed: ${status.error ?? 'unknown error'}` });
            }
        }

        // ---- host
        const disk = await diskOf(getConfig().gamepanelServersDir);
        if (disk && disk.total > 0) {
            const usedPct = (disk.used / disk.total) * 100;
            if (usedPct >= 95) alerts.push({ level: 'error', text: `The disk is ${usedPct.toFixed(0)}% full.` });
            else if (usedPct >= 85) alerts.push({ level: 'warning', text: `The disk is ${usedPct.toFixed(0)}% full.` });
        }
        const memory = { total: os.totalmem(), free: os.freemem() };
        if (memory.free / memory.total < 0.08) {
            alerts.push({ level: 'warning', text: `Little free memory: ${(memory.free / 1024 ** 3).toFixed(1)} GB of ${(memory.total / 1024 ** 3).toFixed(1)} GB.` });
        }
        const containers = await docker
            .listContainers({ all: true })
            .then((list) =>
                list
                    .map((c) => ({
                        name: (c.Names?.[0] ?? '').replace(/^\//, ''),
                        image: c.Image,
                        state: c.State,
                        status: c.Status,
                        project: c.Labels?.['com.docker.compose.project'] ?? null,
                    }))
                    // the panel's own containers and its add-ons; game servers are on the Overview tab
                    .filter((c) => c.project === getConfig().composeProjectName || /^gamepanel-/.test(c.name))
                    .sort((a, b) => a.name.localeCompare(b.name))
            )
            .catch(() => []);
        for (const c of containers) {
            if (c.state !== 'running' && !/^gamepanel-b3-\d+/.test(c.name)) {
                alerts.push({ level: 'warning', text: `Container ${c.name} is ${c.state}.` });
            }
        }

        const sizes = req.query.sizes === '1' ? await folderSizes(rows.map((r) => r.id)) : null;
        return res.json({
            servers,
            fastdl,
            system: {
                hostname: os.hostname(),
                uptime: os.uptime(),
                load: os.loadavg(),
                cpus: os.cpus().length,
                memory,
                disk,
                containers,
                sizes,
            },
            alerts,
        });
    } catch (error) {
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Could not build the overview' });
    }
});

// FastDL "Sync all": the same request file as the per-server button; the service syncs every server at once
router.post('/fastdl/sync', async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const stateDir = path.join(getConfig().gamepanelDataDir, 'fastdl');
        if (!(await readJson<{ url?: string }>(path.join(stateDir, 'fastdl.json')))?.url) {
            return res.status(409).json({ error: 'FastDL is not installed (run gp-fastdl.sh on the panel server)' });
        }
        const requestedAt = Date.now();
        await fs.writeFile(path.join(stateDir, 'sync-request'), String(requestedAt));
        for (let waited = 0; waited < 15000; waited += 500) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            const status = await readJson<{ time?: number; ok?: boolean; error?: string; total?: number; added?: number; removed?: number }>(
                path.join(stateDir, 'status.json')
            );
            if (typeof status?.time === 'number' && status.time * 1000 >= requestedAt) {
                if (!status.ok) return res.status(500).json({ error: `FastDL sync failed: ${status.error ?? 'unknown error'}` });
                return res.json({ total: status.total ?? 0, added: status.added ?? 0, removed: status.removed ?? 0 });
            }
        }
        return res.status(504).json({ error: 'The FastDL service did not answer (systemctl status gamepanel-fastdl)' });
    } catch (error) {
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Could not start the FastDL sync' });
    }
});

export default router;
