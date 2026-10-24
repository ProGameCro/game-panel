import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Eye,
  EyeOff,
  FolderOpen,
  Play,
  RefreshCw,
  RotateCw,
  Square,
  Trash2,
} from 'lucide-react';
import { apiClient } from '../../utils/api';
import { AppButton, AppSelect } from '../../src/ui/components';
import {
  linuxGsmConfigPaths,
  parseCommandLine,
  readCfgValue,
  readOptional,
  writeServerFile,
} from './Cod4ModSection';

// BigBrotherBot (B3) for Call of Duty 4. B3 runs in its own container next to the game server, managed by the
// gamepanel-b3 service on the host (installed by gp-b3.sh). The service and this card share files in the server folder:
//   b3/conf, b3/parsers, b3/extplugins  the user's B3 configs, parsers and plugins (uploaded with the file manager)
//   b3/app                              optional: the user's own complete B3 (with b3_run.py), used instead of the built-in one
//   b3/control.json                     written here: start / stop / restart requests
//   b3/status.json                      written by the service: container state, heartbeat and B3's database
//   b3/logs/console.log                 B3's console output
// Inside the container the server folder is /data, so paths are the same as in the file manager.

export interface B3SectionProps {
  serverId: number;
  gameServerName?: string;
  canReadFileManager?: boolean;
  canWriteFileManager?: boolean;
  onOpenFileManagerPath?: (path: string) => void;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}

type B3Status = {
  state: 'running' | 'stopped' | 'exited' | 'restarting';
  exitCode: number | null;
  startedAt: string | null;
  heartbeat: number;
  lastAction: { id: string; action: string; result: 'ok' | 'error'; message: string | null } | null;
  database: { url: string; host: string; port: number; name: string; user: string } | null;
};

const B3_DIR = 'b3';
const FOLDERS = ['conf', 'parsers', 'extplugins', 'logs'];
const CONFIG_FILE = /\.(ini|xml)$/i;
// parsers and helper modules of the built-in B3 (B3 1.12 plus cod4x); anything else in a parsers folder is the user's own
const STOCK_PARSERS = new Set(
  (
    '__init__ altitude arma2 arma3 bf3 bf4 bfbc2 bfh chiv cod cod2 cod4 cod4gr cod4x cod5 cod6 cod7 cod8 csgo et etpro insurgency ' +
    'iourt41 iourt42 iourt43 moh mohw oa081 punkbuster q3 ro2 smg smg11 sof2 sof2pm wop wop15'
  ).split(' ')
);
const DATABASE_PLACEHOLDER = 'mysql://b3:password@127.0.0.1/b3';

/** Sets B3 settings in a b3.ini (key: value lines) or b3.xml (<set name="key">value</set>) config. */
export const setConfigValues = (text: string, xml: boolean, values: Record<string, string>): string =>
  Object.entries(values).reduce((out, [key, value]) => {
    if (xml) {
      const re = new RegExp(`(<set\\s+name=["']${key}["']\\s*>)[^<]*(</set>)`, 'i');
      return re.test(out) ? out.replace(re, (_m, open: string, close: string) => `${open}${value}${close}`) : out;
    }
    const re = new RegExp(`^(\\s*${key}\\s*[:=]).*$`, 'im');
    return re.test(out) ? out.replace(re, (_m, head: string) => `${head} ${value}`) : out;
  }, text);

/** Ready-to-use b3.ini for this server (B3's distribution config with the server's values filled in). */
const defaultConfig = (v: { database: string; rcon: string; port: string; gameLog: string }) => `# B3 config made by the panel (Install B3). Edit it in the file manager, then restart B3.
[b3]
parser: cod4x
database: ${v.database}
bot_name: b3
bot_prefix: ^0(^2b3^0)^7:
time_format: %I:%M%p %Z %m/%d/%y
time_zone: UTC
log_level: 9
logfile: /data/b3/logs/b3.log
disabled_plugins:
external_plugins_dir: @b3/extplugins

[server]
rcon_password: ${v.rcon || 'set-the-rcon-password'}
port: ${v.port || '28960'}
game_log: ${v.gameLog}
public_ip: 127.0.0.1
rcon_ip: 127.0.0.1
punkbuster: off
delay: 0.33
lines_per_second: 50
permban_with_frozensand: no
tempban_with_frozensand: no

[autodoc]
type: html
maxlevel: 100
destination: /data/b3/logs/b3_doc.html

[update]
channel: skip

[messages]
kicked_by: $clientname^7 was kicked by $adminname^7 $reason
kicked: $clientname^7 was kicked $reason
banned_by: $clientname^7 was banned by $adminname^7 $reason
banned: $clientname^7 was banned $reason
temp_banned_by: $clientname^7 was temp banned by $adminname^7 for $banduration^7 $reason
temp_banned: $clientname^7 was temp banned for $banduration^7 $reason
unbanned_by: $clientname^7 was un-banned by $adminname^7 $reason
unbanned: $clientname^7 was un-banned^7 $reason

# plugin configs of the built-in B3; to change one, copy it to b3/conf and point the line to /data/b3/conf/...
[plugins]
admin: @b3/conf/plugin_admin.ini
adv: @b3/conf/plugin_adv.xml
censor: @b3/conf/plugin_censor.xml
cmdmanager: @b3/conf/plugin_cmdmanager.ini
pingwatch: @b3/conf/plugin_pingwatch.ini
pluginmanager: @b3/conf/plugin_pluginmanager.ini
spamcontrol: @b3/conf/plugin_spamcontrol.ini
stats: @b3/conf/plugin_stats.ini
status: @b3/conf/plugin_status.ini
tk: @b3/conf/plugin_tk.ini
welcome: @b3/conf/plugin_welcome.ini
`;
const POLL_MS = 4000;
// the service writes status.json at least every 15 s; allow some clock difference between browser and server
const STALE_SECONDS = 120;
const LOG_LINES = 40;

const README = `B3 (BigBrotherBot) for this server
==================================
conf/        your b3.ini or b3.xml and the plugin configs
parsers/     your parser files (.py), for example cod4x.py -> "parser: cod4x"
extplugins/  your plugins (.py files or folders)
logs/        console.log (B3 output)
app/         optional: your own complete B3 (the folder with b3_run.py). When it is here it is used
             instead of the built-in B3 1.12; its requirements.txt is installed automatically.
             Configs can then also stay in app/b3/conf.

Inside B3 this server folder is /data, for example:
  game_log: /data/serverfiles/main/games_mp.log
  logfile:  /data/b3/logs/b3.log
RCON: rcon_ip 127.0.0.1 and the server port. Start / stop B3 in Settings > Game config > B3.
`;

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function B3Section({
  serverId,
  gameServerName = 'cod4server',
  canReadFileManager,
  canWriteFileManager,
  onOpenFileManagerPath,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
}: B3SectionProps) {
  const paths = useMemo(() => linuxGsmConfigPaths(gameServerName), [gameServerName]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const [configs, setConfigs] = useState<string[]>([]);
  const [parsers, setParsers] = useState<string[]>([]);
  const [config, setConfig] = useState('');
  const [appRoot, setAppRoot] = useState('');
  const [appWithoutB3, setAppWithoutB3] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dropDatabase, setDropDatabase] = useState(false);
  const [status, setStatus] = useState<B3Status | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [consoleLog, setConsoleLog] = useState('');
  const [server, setServer] = useState({ port: '', rcon: '', gameLog: '' });
  const [showRcon, setShowRcon] = useState(false);
  const consoleRef = useRef<HTMLPreElement>(null);

  const refresh = useCallback(async () => {
    const [statusText, logText] = await Promise.all([
      readOptional(serverId, `${B3_DIR}/status.json`),
      readOptional(serverId, `${B3_DIR}/logs/console.log`),
    ]);
    try {
      setStatus(statusText ? (JSON.parse(statusText) as B3Status) : null);
    } catch {
      setStatus(null);
    }
    setConsoleLog((logText ?? '').split('\n').slice(-LOG_LINES).join('\n').trim());
  }, [serverId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const root = await apiClient.listServerFiles(serverId, B3_DIR).catch(() => null);
      setInstalled(Boolean(root));
      if (root) {
        const list = (path: string) =>
          apiClient.listServerFiles(serverId, `${B3_DIR}/${path}`).catch(() => null);
        const [conf, parserDir, app] = await Promise.all([
          list('conf'),
          list('parsers'),
          list('app'),
        ]);
        // own B3: b3/app/b3_run.py, or one folder deeper (uploading a folder or zip adds one level)
        let appRoot = '';
        if (app?.entries.some((e) => e.type === 'file' && e.name === 'b3_run.py')) {
          appRoot = 'app';
        } else {
          for (const dir of (app?.entries ?? []).filter((e) => e.type === 'dir').slice(0, 10)) {
            const inner = await list(`app/${dir.name}`);
            if (inner?.entries.some((e) => e.type === 'file' && e.name === 'b3_run.py')) {
              appRoot = `app/${dir.name}`;
              break;
            }
          }
        }
        const [appConf, appParsers] = appRoot
          ? await Promise.all([list(`${appRoot}/b3/conf`), list(`${appRoot}/b3/parsers`)])
          : [null, null];
        const configFiles = (listing: typeof conf, dir: string) =>
          (listing?.entries ?? [])
            .filter((e) => e.type === 'file' && CONFIG_FILE.test(e.name))
            .map((e) => (dir ? `${dir}/${e.name}` : e.name))
            .sort();
        // config paths are relative to b3/, the service accepts the same form
        const all = [
          ...configFiles(conf, 'conf'),
          ...configFiles(root, ''),
          ...(appRoot ? configFiles(appConf, `${appRoot}/b3/conf`) : []),
        ];
        // main B3 configs only (b3.ini, b3.xml, b3_server2.ini …), not plugin configs or B3's example files
        const name = (f: string) => f.slice(f.lastIndexOf('/') + 1);
        const main = all.filter(
          (f) => /^b3/i.test(name(f)) && !/example|distribution/i.test(name(f))
        );
        const files = main.length
          ? main
          : all.filter((f) => !/^plugin_/i.test(name(f)) && !/example|distribution/i.test(name(f)));
        setAppRoot(appRoot);
        setAppWithoutB3(Boolean(app && !appRoot && app.entries.length > 0));
        setConfigs(files);
        setConfig((current) =>
          files.includes(current)
            ? current
            : (files.find((f) => /(^|\/)b3\.(ini|xml)$/i.test(f)) ?? files[0] ?? '')
        );
        // own parsers: b3/parsers plus the ones inside an uploaded B3 that B3 1.12 does not have
        const parserNames = (listing: typeof conf) =>
          (listing?.entries ?? [])
            .filter((e) => e.type === 'file' && e.name.endsWith('.py'))
            .map((e) => e.name.replace(/\.py$/, ''));
        const own = new Set([
          ...parserNames(parserDir),
          ...parserNames(appParsers).filter((n) => !STOCK_PARSERS.has(n)),
        ]);
        setParsers([...own].sort());
      }
      // what B3 needs from the game server, taken from the LinuxGSM config the Command line card edits
      const sources = await Promise.all(
        [
          paths.secretsInstance,
          paths.instance,
          paths.secretsCommon,
          paths.common,
          paths.defaults,
        ].map((p) => readOptional(serverId, p))
      );
      const value = (key: string) =>
        sources.map((c) => readCfgValue(c ?? '', key)).find((v) => v !== null) ?? '';
      const line = parseCommandLine(value('startparameters'));
      setServer({
        port: value('port'),
        rcon: line.rcon === '${rconpassword}' ? value('rconpassword') : line.rcon,
        gameLog: `/data/serverfiles/${line.mod ? `mods/${line.mod}` : 'main'}/games_mp.log`,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the B3 folder.');
    } finally {
      setLoading(false);
    }
  }, [serverId, paths, refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!installed) return undefined;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [installed, refresh]);

  useEffect(() => {
    // keep the newest console lines in view
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [consoleLog]);

  useEffect(() => {
    if (pending && status?.lastAction?.id === pending) setPending(null);
  }, [pending, status]);

  const install = async () => {
    setBusy('install');
    setError(null);
    try {
      await apiClient.createServerDirectory(serverId, '/', B3_DIR).catch((e) => {
        if ((e as { response?: { status?: number } })?.response?.status !== 409) throw e;
      });
      for (const folder of FOLDERS) {
        await apiClient.createServerDirectory(serverId, B3_DIR, folder).catch(() => undefined);
      }
      await writeServerFile(serverId, `${B3_DIR}/README.txt`, README);
      // a ready b3.ini, unless the user already has a config; the database name comes from the service (a few seconds)
      if (!(await readOptional(serverId, `${B3_DIR}/conf/b3.ini`)) && !(await readOptional(serverId, `${B3_DIR}/conf/b3.xml`))) {
        let database = '';
        for (let i = 0; i < 8 && !database; i += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          try {
            database = (JSON.parse((await readOptional(serverId, `${B3_DIR}/status.json`)) ?? '{}') as Partial<B3Status>).database?.url ?? '';
          } catch {
            database = '';
          }
        }
        await writeServerFile(serverId, `${B3_DIR}/conf/b3.ini`, defaultConfig({ ...server, database: database || DATABASE_PLACEHOLDER }));
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the B3 folder.');
    } finally {
      setBusy(null);
    }
  };

  const send = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(action);
    setError(null);
    try {
      const id = newId();
      await writeServerFile(
        serverId,
        `${B3_DIR}/control.json`,
        `${JSON.stringify({ action, id, config }, null, 2)}\n`
      );
      setPending(id);
      // stop waiting if the service never picks the request up (it is then shown as offline)
      window.setTimeout(() => setPending((current) => (current === id ? null : current)), 20000);
      window.setTimeout(() => void refresh(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the request to the B3 service.');
    } finally {
      setBusy(null);
    }
  };

  if (!canReadFileManager) return null;

  const serviceOnline = Boolean(status && Date.now() / 1000 - status.heartbeat < STALE_SECONDS);
  const running = status?.state === 'running' || status?.state === 'restarting';
  const lastError = status?.lastAction?.result === 'error' ? status.lastAction.message : null;
  const badge = !installed
    ? { text: 'Not installed', cls: 'border-gray-500/40 bg-gray-500/10 text-gray-300' }
    : !serviceOnline
      ? { text: 'Service offline', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' }
      : running
        ? {
            text: status?.state === 'restarting' ? 'Restarting' : 'Running',
            cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
          }
        : status?.state === 'exited'
          ? {
              text: `Stopped (exit ${status.exitCode ?? '?'})`,
              cls: 'border-red-500/40 bg-red-500/10 text-red-300',
            }
          : { text: 'Stopped', cls: 'border-gray-500/40 bg-gray-500/10 text-gray-300' };
  const canControl = installed && serviceOnline && canWriteFileManager && !busy && !pending;

  const writeValues = async () => {
    setBusy('values');
    setError(null);
    setNotice(null);
    try {
      if (!server.rcon) throw new Error('Set the RCON password in the Command line card first, then write the values again.');
      const path = `${B3_DIR}/${config}`;
      const text = await readOptional(serverId, path);
      if (text === null) throw new Error(`Could not read b3/${config}.`);
      const values: Record<string, string> = {
        rcon_password: server.rcon,
        port: server.port || '28960',
        rcon_ip: '127.0.0.1',
        game_log: server.gameLog,
        ...(status?.database ? { database: status.database.url } : {}),
      };
      const next = setConfigValues(text, /\.xml$/i.test(config), values);
      if (next !== text) await writeServerFile(serverId, path, next);
      setNotice(next !== text ? `Saved to b3/${config}.${running ? ' Restart B3 to use them.' : ''}` : `b3/${config} already has these values.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the config.');
    } finally {
      setBusy(null);
    }
  };

  const uninstall = async () => {
    setBusy('uninstall');
    setError(null);
    try {
      const exists = async () =>
        Boolean(await apiClient.listServerFiles(serverId, B3_DIR).catch(() => null));
      if (serviceOnline) {
        // the service stops B3 and removes the folder (it can also remove files B3 created)
        const request = { action: 'uninstall', id: newId(), dropDatabase };
        await writeServerFile(
          serverId,
          `${B3_DIR}/control.json`,
          `${JSON.stringify(request, null, 2)}\n`
        );
        for (let i = 0; i < 15 && (await exists()); i += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }
      }
      if (await exists()) await apiClient.deleteServerPaths(serverId, [B3_DIR]);
      setConfirmUninstall(false);
      setDropDatabase(false);
      setStatus(null);
      setConsoleLog('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not uninstall B3.');
    } finally {
      setBusy(null);
    }
  };
  const row = 'grid gap-1 sm:grid-cols-[9rem_1fr] sm:items-baseline sm:gap-x-4';
  const key = `text-sm font-semibold sm:text-right ${textPrimary}`;
  const val = `break-all font-mono text-sm ${textSecondary}`;

  return (
    <section className={`mb-4 rounded-xl border ${borderColor} ${contentBg} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className={`flex items-center gap-2 text-base font-semibold ${textPrimary}`}>
            <Bot className="h-4 w-4 text-sky-300" /> B3 (BigBrotherBot)
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
              {badge.text}
            </span>
          </h3>
          <p className={`mt-1 text-sm ${textSecondary}`}>
            Admin bot for the server. Upload your configs to <code>b3/conf</code>, parsers to{' '}
            <code>b3/parsers</code> and plugins to <code>b3/extplugins</code>, or your whole B3 to{' '}
            <code>b3/app</code>, then start B3.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {installed && onOpenFileManagerPath && (
            <AppButton tone="ghost" onClick={() => onOpenFileManagerPath(B3_DIR)}>
              <FolderOpen className="h-4 w-4" /> Open B3 folder
            </AppButton>
          )}
          <AppButton tone="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Reload
          </AppButton>
        </div>
      </div>

      {!loading && !installed && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-500/50 bg-sky-500/5 p-4">
          <span className={`text-sm ${textSecondary}`}>
            Creates the <code>b3</code> folder (conf, parsers, extplugins, logs) in this server.
          </span>
          {canWriteFileManager && (
            <AppButton
              tone="primary"
              className="!h-auto !px-5 !py-2"
              onClick={() => void install()}
              disabled={busy !== null}
            >
              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                <Bot className="h-4 w-4" /> {busy === 'install' ? 'Installing…' : 'Install B3'}
              </span>
            </AppButton>
          )}
        </div>
      )}

      {installed && (
        <>
          {!serviceOnline && !loading && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                The B3 service on the host is not answering. Run <code>sudo bash gp-b3.sh</code> on
                the server (or <code>systemctl restart gamepanel-b3</code>).
              </span>
            </div>
          )}

          <div className="mt-4 grid gap-3 rounded-lg border border-sky-500/50 bg-sky-500/5 p-4">
            <div className={row}>
              <span className={key}>Config</span>
              {configs.length > 0 ? (
                <div className="max-w-xs">
                  <AppSelect
                    options={configs.map((c) => ({ value: c, label: `b3/${c}` }))}
                    value={config}
                    onChange={setConfig}
                    disabled={!canWriteFileManager}
                  />
                </div>
              ) : (
                <span className="text-sm text-amber-300">
                  No b3.ini or b3.xml found in b3, b3/conf or your B3's b3/conf. Upload your B3
                  config.
                </span>
              )}
            </div>
            <div className={row}>
              <span className={key}>B3</span>
              <span className={val}>
                {appRoot
                  ? `your own B3 from b3/${appRoot}`
                  : 'your B3 from big-brother-bot-master.zip (B3 1.12 + cod4x parser)'}
                {appWithoutB3 && (
                  <span className="block text-amber-300">
                    b3/app has no b3_run.py (also not one folder deeper), so it is not used.
                  </span>
                )}
              </span>
            </div>
            <div className={row}>
              <span className={key}>Your parsers</span>
              <span className={val}>
                {parsers.length
                  ? `${parsers.join(', ')} (use the name in "parser:")`
                  : 'none extra (your B3 has cod4x, cod4, cod4gr …)'}
              </span>
            </div>
            <div className={row}>
              <span className={key}>game_log</span>
              <span className={val}>{server.gameLog}</span>
            </div>
            <div className={row}>
              <span className={key}>rcon_ip / port</span>
              <span className={val}>127.0.0.1 / {server.port || 'server port'}</span>
            </div>
            <div className={row}>
              <span className={key}>rcon_password</span>
              <span className={`flex items-center gap-2 ${val}`}>
                {server.rcon
                  ? showRcon
                    ? server.rcon
                    : '•'.repeat(Math.min(server.rcon.length, 12))
                  : (
                    <span className="text-amber-300">
                      not set: set it in the Command line card (+set rcon_password), Save, then press Reload here
                    </span>
                  )}
                {server.rcon && (
                  <button
                    type="button"
                    className="p-1 text-gray-400 hover:text-white"
                    onClick={() => setShowRcon((v) => !v)}
                    aria-label={showRcon ? 'Hide' : 'Show'}
                  >
                    {showRcon ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </span>
            </div>
            {status?.database && (
              <div className={row}>
                <span className={key}>database</span>
                <span className={val}>{status.database.url}</span>
              </div>
            )}
            <p className={`text-xs ${textSecondary} sm:pl-[10rem]`}>
              Values to use in your B3 config. Inside B3 this server folder is <code>/data</code>.
            </p>
            {canWriteFileManager && config && (
              <div className="flex flex-wrap items-center gap-3 sm:pl-[10rem]">
                <AppButton tone="neutral" className="!h-auto !px-4 !py-1.5" onClick={() => void writeValues()} disabled={busy !== null}>
                  {busy === 'values' ? 'Saving…' : `Write these values into b3/${config}`}
                </AppButton>
                {notice && <span className="text-sm text-emerald-300">{notice}</span>}
              </div>
            )}
          </div>

          {(error || lastError) && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>{error ?? lastError}</span>
            </div>
          )}
          {!error && !lastError && status?.lastAction?.result === 'ok' && running && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              <span>
                B3 is running
                {status.startedAt ? ` since ${new Date(status.startedAt).toLocaleString()}` : ''}.
              </span>
            </div>
          )}

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className={`text-sm font-semibold ${textPrimary}`}>Console</span>
              {onOpenFileManagerPath && (
                <AppButton tone="ghost" onClick={() => onOpenFileManagerPath(`${B3_DIR}/logs`)}>
                  <FolderOpen className="h-4 w-4" /> Logs
                </AppButton>
              )}
            </div>
            <pre
              ref={consoleRef}
              className={`max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border ${borderColor} bg-black/30 p-2 font-mono text-xs ${textSecondary}`}
            >
              {consoleLog || 'No output yet.'}
            </pre>
          </div>

          {canWriteFileManager && confirmUninstall && (
            <div className="mt-4 grid gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
              <span>
                Uninstall removes the <code>b3</code> folder of this server: configs, parsers,
                plugins, your own B3 and logs. B3 is stopped first.
              </span>
              {status?.database && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={dropDatabase}
                    onChange={(e) => setDropDatabase(e.target.checked)}
                  />
                  Also delete the database <code>{status.database.name}</code> (admins, bans,
                  stats). Leave it unticked to keep them.
                </label>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <AppButton
                  tone="neutral"
                  className="!h-auto !px-5 !py-2"
                  onClick={() => setConfirmUninstall(false)}
                  disabled={busy !== null}
                >
                  Cancel
                </AppButton>
                <AppButton
                  tone="critical"
                  className="!h-auto !px-5 !py-2"
                  onClick={() => void uninstall()}
                  disabled={busy !== null}
                >
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <Trash2 className="h-4 w-4" />{' '}
                    {busy === 'uninstall' ? 'Uninstalling…' : 'Yes, uninstall B3'}
                  </span>
                </AppButton>
              </div>
            </div>
          )}

          {canWriteFileManager && !confirmUninstall && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <AppButton
                tone="ghost"
                onClick={() => setConfirmUninstall(true)}
                disabled={busy !== null}
              >
                <Trash2 className="h-4 w-4" /> Uninstall B3
              </AppButton>
              <div className="flex flex-wrap gap-2">
                {running ? (
                  <>
                    <AppButton
                      tone="neutral"
                      className="!h-auto min-w-[8rem] !px-5 !py-2"
                      onClick={() => void send('restart')}
                      disabled={!canControl}
                    >
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <RotateCw className="h-4 w-4" /> Restart
                      </span>
                    </AppButton>
                    <AppButton
                      tone="critical"
                      className="!h-auto min-w-[8rem] !px-5 !py-2"
                      onClick={() => void send('stop')}
                      disabled={!canControl}
                    >
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <Square className="h-4 w-4" /> Stop
                      </span>
                    </AppButton>
                  </>
                ) : (
                  <AppButton
                    tone="primary"
                    className="!h-auto min-w-[8rem] !px-5 !py-2"
                    onClick={() => void send('start')}
                    disabled={!canControl || !config}
                  >
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <Play className="h-4 w-4" /> {pending ? 'Starting…' : 'Start B3'}
                    </span>
                  </AppButton>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
