import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../config.js';
import { docker } from '../utils/docker/client.js';
import { logWarn } from '../utils/logger.js';

// FTP / FTPS / SFTP access to a server's files (gp-ftp.sh: SFTPGo in the container gamepanel-ftp).
// One account per server (ftp<server number>), its home is the server's serverfiles folder. gp-ftp.sh leaves its
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

function sftpgoUser(config: FtpConfig, serverId: number, password: string) {
    return {
        username: ftpUsername(serverId),
        password,
        status: 1,
        home_dir: path.posix.join(config.serversDir, String(serverId), 'data', 'serverfiles'),
        // the game server's own user (LinuxGSM): files uploaded over FTP belong to it
        uid: 1000,
        gid: 1000,
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
    const user = sftpgoUser(config, serverId, password);
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
