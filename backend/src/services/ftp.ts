import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../config.js';
import { docker } from '../utils/docker/client.js';
import { logWarn } from '../utils/logger.js';
import { serverRepository } from '../database/index.js';

// FTP / FTPS / SFTP access to a server's files (gp-ftp.sh: SFTPGo in the container gamepanel-ftp).
// One account per server (ftp<server number>), its home is the server's game files (see homeSubdir). gp-ftp.sh leaves its
// settings in the panel's data folder (ftp/ftp.json: the SFTPGo API on the panel's network and its admin login);
// the panel keeps the accounts' passwords in ftp/accounts.json, so the server's settings can show them.

const CONTAINER = 'gamepanel-ftp';

type FtpConfig = {
    api: string;
    admin: string;
    password: string;
    host: string;
    ftpPort: number;
    sftpPort: number;
    // where the servers' folders are inside the FTP container
    serversDir: string;
    // the FTP service reports every upload, delete ... to the panel with this key (/api/ftp/events)
    hookKey: string | null;
};

export type FtpAccount = { username: string; password: string; createdAt: number };

export type FtpInfo = {
    installed: boolean;
    running: boolean;
    host: string | null;
    ftpPort: number | null;
    sftpPort: number | null;
    account: { username: string; password: string } | null;
};

const stateDir = () => path.join(getConfig().gamepanelDataDir, 'ftp');
const accountsFile = () => path.join(stateDir(), 'accounts.json');

export const ftpUsername = (serverId: number) => `ftp${serverId}`;

function fail(message: string, statusCode: number): Error {
    return Object.assign(new Error(message), { statusCode });
}

export async function readFtpConfig(): Promise<FtpConfig | null> {
    try {
        const raw = JSON.parse(await fs.readFile(path.join(stateDir(), 'ftp.json'), 'utf8')) as Partial<FtpConfig>;
        if (!raw.api || !raw.admin || !raw.password) return null;
        return {
            api: raw.api.replace(/\/+$/, ''),
            admin: raw.admin,
            password: raw.password,
            host: raw.host || getConfig().domain,
            ftpPort: Number(raw.ftpPort) || 21,
            sftpPort: Number(raw.sftpPort) || 2022,
            serversDir: raw.serversDir || '/srv/servers',
            hookKey: raw.hookKey || null,
        };
    } catch {
        return null;
    }
}

async function readAccounts(): Promise<Record<string, FtpAccount>> {
    try {
        return JSON.parse(await fs.readFile(accountsFile(), 'utf8')) as Record<string, FtpAccount>;
    } catch {
        return {};
    }
}

async function writeAccounts(accounts: Record<string, FtpAccount>): Promise<void> {
    const file = accountsFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, `${JSON.stringify(accounts, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
}

export async function ftpRunning(): Promise<boolean> {
    return docker
        .getContainer(CONTAINER)
        .inspect()
        .then((c) => Boolean(c.State?.Running))
        .catch(() => false);
}

// ---- SFTPGo REST API (an admin token, valid for a while)
let token: { value: string; until: number } | null = null;

async function api<T>(config: FtpConfig, method: string, url: string, body?: unknown): Promise<{ status: number; data: T | null }> {
    if (!token || token.until < Date.now()) {
        const res = await fetch(`${config.api}/api/v2/token`, {
            headers: { Authorization: `Basic ${Buffer.from(`${config.admin}:${config.password}`).toString('base64')}` },
            signal: AbortSignal.timeout(8000),
        }).catch((error: Error) => {
            throw fail(`The FTP service does not answer (${error.message}). On the panel server: bash gp-ftp.sh`, 502);
        });
        if (!res.ok) throw fail(`The FTP service refused the panel's login (${res.status}). Run bash gp-ftp.sh again.`, 502);
        const data = (await res.json()) as { access_token: string };
        token = { value: data.access_token, until: Date.now() + 10 * 60_000 };
    }
    const res = await fetch(`${config.api}/api/v2${url}`, {
        method,
        headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
    }).catch((error: Error) => {
        throw fail(`The FTP service does not answer (${error.message})`, 502);
    });
    if (res.status === 401) token = null;
    const text = await res.text();
    let data: T | null = null;
    try {
        data = text ? (JSON.parse(text) as T) : null;
    } catch {
        data = null;
    }
    if (!res.ok && res.status !== 404) {
        const message = (data as { message?: string; error?: string } | null)?.error || (data as { message?: string } | null)?.message || text;
        throw fail(`FTP service: ${message || res.status}`, 502);
    }
    return { status: res.status, data };
}

// 12 letters and numbers, without look-alikes (0/O, 1/l/I)
function newPassword(): string {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.randomBytes(12), (b) => chars[b % chars.length]).join('');
}

// the account's folder: a LinuxGSM server's game files (serverfiles), for other games the server's whole data folder
// (what the File Manager shows); files uploaded over FTP get the user the game runs as (LinuxGSM 1000, OVHcloud
// images 10001, custom images their own), so the server can use them
async function accountTarget(serverId: number): Promise<{ home: string; uid: number; gid: number }> {
    const server = await serverRepository.findById(serverId);
    let uid = 1000;
    let gid = 1000;
    try {
        const runtime = JSON.parse(server?.runtime_config_json ?? '{}') as { volumeUid?: unknown; volumeGid?: unknown };
        if (Number.isInteger(runtime.volumeUid) && Number.isInteger(runtime.volumeGid)) {
            uid = Number(runtime.volumeUid);
            gid = Number(runtime.volumeGid);
        }
    } catch {
        // the default
    }
    return { home: server?.provider === 'linuxgsm' ? 'data/serverfiles' : 'data', uid, gid };
}

function sftpgoUser(config: FtpConfig, serverId: number, password: string, target: { home: string; uid: number; gid: number }) {
    return {
        username: ftpUsername(serverId),
        password,
        status: 1,
        home_dir: path.posix.join(config.serversDir, String(serverId), target.home),
        uid: target.uid,
        gid: target.gid,
        permissions: { '/': ['*'] },
        description: `Game Panel server ${serverId}`,
    };
}

async function requireConfig(): Promise<FtpConfig> {
    const config = await readFtpConfig();
    if (!config) throw fail('FTP is not installed. On the panel server: bash gp-ftp.sh', 409);
    return config;
}

// opens the server's account (or gives it a new password); the account works as soon as this returns
export async function ensureFtpAccount(serverId: number, resetPassword = false): Promise<FtpAccount> {
    const config = await requireConfig();
    const accounts = await readAccounts();
    const key = String(serverId);
    const current = accounts[key];
    const password = !current || resetPassword ? newPassword() : current.password;
    const user = sftpgoUser(config, serverId, password, await accountTarget(serverId));
    const existing = await api(config, 'GET', `/users/${user.username}`);
    if (existing.status === 404) await api(config, 'POST', '/users', user);
    else await api(config, 'PUT', `/users/${user.username}`, user);
    const account: FtpAccount = { username: user.username, password, createdAt: current?.createdAt ?? Date.now() };
    accounts[key] = account;
    await writeAccounts(accounts);
    return account;
}

export async function deleteFtpAccount(serverId: number): Promise<void> {
    const accounts = await readAccounts();
    const config = await readFtpConfig();
    if (config) await api(config, 'DELETE', `/users/${ftpUsername(serverId)}`);
    if (accounts[String(serverId)]) {
        delete accounts[String(serverId)];
        await writeAccounts(accounts);
    }
}

// a deleted server: its account goes too (FTP may not be installed at all)
export async function deleteFtpAccountBestEffort(serverId: number): Promise<void> {
    if (!(await readFtpConfig())) return;
    await deleteFtpAccount(serverId).catch((error: Error) => logWarn('FTP', `Could not delete the FTP account of server ${serverId}: ${error.message}`));
}

export async function ftpInfo(serverId: number): Promise<FtpInfo> {
    const config = await readFtpConfig();
    const account = (await readAccounts())[String(serverId)];
    return {
        installed: Boolean(config),
        running: config ? await ftpRunning() : false,
        host: config?.host ?? null,
        ftpPort: config?.ftpPort ?? null,
        sftpPort: config?.sftpPort ?? null,
        account: account ? { username: account.username, password: account.password } : null,
    };
}

export async function listFtpAccounts(): Promise<Array<{ serverId: number } & FtpAccount>> {
    return Object.entries(await readAccounts())
        .map(([id, account]) => ({ serverId: Number(id), ...account }))
        .sort((a, b) => a.serverId - b.serverId);
}

// ---- what users do over FTP (the FTP service reports it, see gp-ftp.sh) and who is connected now
export type FtpEvent = {
    time: number;
    serverId: number | null;
    username: string;
    action: string;
    path: string;
    target?: string;
    size?: number;
    protocol: string;
    ip: string;
    ok: boolean;
};

const eventsFile = () => path.join(stateDir(), 'events.jsonl');
const MAX_EVENTS_BYTES = 5 * 1024 * 1024;
const KEEP_EVENTS = 20000;
let writing: Promise<void> = Promise.resolve();

export async function checkFtpHookKey(key: unknown): Promise<boolean> {
    const config = await readFtpConfig();
    if (!config?.hookKey || typeof key !== 'string') return false;
    const a = Buffer.from(key);
    const b = Buffer.from(config.hookKey);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function recordFtpEvent(raw: Record<string, unknown>): Promise<void> {
    const username = String(raw.username ?? '');
    const id = /^ftp(\d+)$/.exec(username)?.[1];
    const ns = Number(raw.timestamp);
    const event: FtpEvent = {
        time: Number.isFinite(ns) && ns > 0 ? Math.round(ns / 1e6) : Date.now(),
        serverId: id ? Number(id) : null,
        username: username.slice(0, 64),
        action: String(raw.action ?? '').slice(0, 20),
        path: String(raw.virtual_path ?? '').slice(0, 500),
        protocol: String(raw.protocol ?? '').slice(0, 10),
        ip: String(raw.ip ?? '').slice(0, 64),
        // status 1 = done; 2 = failed, 3 = over the quota
        ok: Number(raw.status ?? 1) === 1,
    };
    if (raw.virtual_target_path) event.target = String(raw.virtual_target_path).slice(0, 500);
    if (raw.file_size !== undefined && Number.isFinite(Number(raw.file_size))) event.size = Number(raw.file_size);
    writing = writing
        .then(async () => {
            const file = eventsFile();
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
            const st = await fs.stat(file);
            if (st.size > MAX_EVENTS_BYTES) {
                const lines = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).slice(-KEEP_EVENTS);
                await fs.writeFile(`${file}.tmp`, `${lines.join('\n')}\n`, 'utf8');
                await fs.rename(`${file}.tmp`, file);
            }
        })
        .catch((error: Error) => logWarn('FTP', `Could not record an FTP event: ${error.message}`));
    return writing;
}

export async function readFtpEvents(options: { serverId?: number; limit?: number; uploadsOnly?: boolean } = {}): Promise<FtpEvent[]> {
    const limit = Math.max(1, Math.min(2000, options.limit ?? 300));
    let lines: string[] = [];
    try {
        lines = (await fs.readFile(eventsFile(), 'utf8')).split('\n').filter(Boolean);
    } catch {
        return [];
    }
    const events: FtpEvent[] = [];
    for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
        try {
            const event = JSON.parse(lines[i]) as FtpEvent;
            if (options.serverId !== undefined && event.serverId !== options.serverId) continue;
            if (options.uploadsOnly && event.action !== 'upload') continue;
            events.push(event);
        } catch {
            // a broken line
        }
    }
    return events;
}

export type FtpConnection = {
    id: string;
    username: string;
    serverId: number | null;
    protocol: string;
    address: string;
    since: number;
    lastActivity: number;
    command: string;
    transfers: Array<{ type: string; path: string; size: number; since: number }>;
};

export async function listFtpConnections(): Promise<FtpConnection[]> {
    const config = await requireConfig();
    const { data } = await api<Array<Record<string, unknown>>>(config, 'GET', '/connections');
    return (data ?? []).map((c) => {
        const username = String(c.username ?? '');
        const id = /^ftp(\d+)$/.exec(username)?.[1];
        return {
            id: String(c.connection_id ?? ''),
            username,
            serverId: id ? Number(id) : null,
            protocol: String(c.protocol ?? ''),
            address: String(c.remote_address ?? '').replace(/:\d+$/, ''),
            since: Number(c.connection_time) || 0,
            lastActivity: Number(c.last_activity) || 0,
            command: String(c.command ?? ''),
            transfers: ((c.active_transfers as Array<Record<string, unknown>> | undefined) ?? []).map((t) => ({
                type: String(t.operation_type ?? ''),
                path: String(t.path ?? ''),
                size: Number(t.size) || 0,
                since: Number(t.start_time) || 0,
            })),
        };
    });
}

export async function kickFtpConnection(connectionId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(connectionId)) throw fail('Invalid connection', 400);
    const config = await requireConfig();
    const { status } = await api(config, 'DELETE', `/connections/${connectionId}`);
    if (status === 404) throw fail('That connection has already ended', 404);
}
