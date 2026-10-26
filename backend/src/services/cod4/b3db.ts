import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { docker } from '../../utils/docker/client.js';
import { getServerStoragePaths } from '../../utils/storage.js';

// B3's MariaDB (container gamepanel-b3-db from gp-b3.sh). The panel's backend is not on the database's network, so it
// runs the mariadb client inside that container, with the server's own B3 login from its b3.xml.
const DB_CONTAINER = 'gamepanel-b3-db';

export type B3Database = { user: string; password: string; database: string };

const B3_CONFIGS = ['b3/b3/conf/b3.xml', 'b3/conf/b3.xml', 'b3/b3.xml', 'b3/b3/conf/b3.ini', 'b3/conf/b3.ini'];

export function b3ConfigCandidates(serverId: number): string[] {
    const dataDir = getServerStoragePaths(serverId).dataDir;
    return B3_CONFIGS.map((rel) => path.join(dataDir, rel));
}

export async function findB3Config(serverId: number): Promise<string | null> {
    for (const file of b3ConfigCandidates(serverId)) {
        if (await fs.access(file).then(() => true, () => false)) return file;
    }
    return null;
}

// database: mysql://user:password@host:port/name
export async function readB3Database(serverId: number): Promise<B3Database> {
    const file = await findB3Config(serverId);
    if (!file) throw Object.assign(new Error('B3 is not installed on this server.'), { statusCode: 409 });
    const content = await fs.readFile(file, 'utf8');
    const dsn = /mysql:\/\/([^:@\s<]+):([^@\s<]*)@[^/\s<]+\/([A-Za-z0-9_]+)/.exec(content);
    if (!dsn) throw Object.assign(new Error(`No MySQL database in ${path.basename(file)}.`), { statusCode: 409 });
    return { user: decodeURIComponent(dsn[1]), password: decodeURIComponent(dsn[2]), database: dsn[3] };
}

async function execInDb(cmd: string[], env: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
    const container = docker.getContainer(DB_CONTAINER);
    const exec = await container.exec({ Cmd: cmd, Env: env, AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({ hijack: true, stdin: false });
    const out = new PassThrough();
    const err = new PassThrough();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    out.on('data', (chunk: Buffer) => stdout.push(chunk));
    err.on('data', (chunk: Buffer) => stderr.push(chunk));
    docker.modem.demuxStream(stream, out, err);
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The database did not answer in time.')), timeoutMs);
        stream.on('end', () => {
            clearTimeout(timer);
            resolve();
        });
        stream.on('error', (error: Error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
    const info = await exec.inspect();
    return { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), code: info.ExitCode ?? 0 };
}

// --batch output: tab separated, first line the column names; \t \n \\ escaped
function parseBatch(text: string): Array<Record<string, string>> {
    const lines = text.split('\n').filter((line) => line.length > 0);
    if (lines.length === 0) return [];
    const unescape = (value: string) => (value === 'NULL' ? '' : value.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\'));
    const columns = lines[0].split('\t');
    return lines.slice(1).map((line) => {
        const values = line.split('\t');
        return Object.fromEntries(columns.map((column, i) => [column, unescape(values[i] ?? '')]));
    });
}

export async function b3Query(serverId: number, sql: string): Promise<Array<Record<string, string>>> {
    const db = await readB3Database(serverId);
    const result = await execInDb(
        ['mariadb', '--batch', '-h127.0.0.1', `-u${db.user}`, db.database, '-e', sql],
        [`MYSQL_PWD=${db.password}`],
        20000
    ).catch((error: Error) => {
        throw Object.assign(new Error(`B3 database: ${error.message}`), { statusCode: 502 });
    });
    if (result.code !== 0) {
        throw Object.assign(new Error(`B3 database: ${result.stderr.trim() || 'query failed'}`), { statusCode: 502 });
    }
    return parseBatch(result.stdout);
}

// mysqldump of the server's B3 database into its folder (b3-backups/), returns the file's path inside the server
export async function backupB3Database(serverId: number): Promise<{ file: string; size: number }> {
    const db = await readB3Database(serverId);
    const result = await execInDb(
        ['mariadb-dump', '--single-transaction', '--routines', '-h127.0.0.1', `-u${db.user}`, db.database],
        [`MYSQL_PWD=${db.password}`],
        10 * 60_000
    );
    if (result.code !== 0) throw Object.assign(new Error(`Backup failed: ${result.stderr.trim()}`), { statusCode: 502 });
    const dataDir = getServerStoragePaths(serverId).dataDir;
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const rel = path.posix.join('b3-backups', `${db.database}-${stamp}.sql`);
    await fs.mkdir(path.join(dataDir, 'b3-backups'), { recursive: true });
    await fs.writeFile(path.join(dataDir, rel), result.stdout, 'utf8');
    return { file: rel, size: Buffer.byteLength(result.stdout) };
}
