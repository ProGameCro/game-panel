import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  Pencil,
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
  // the host's own (public) address, reported by the service
  serverIp?: string | null;
};

const B3_DIR = 'b3';
const FOLDERS = ['logs'];
const CONFIG_FILE = /\.(ini|xml)$/i;
// parsers and helper modules of the built-in B3 (B3 1.12 plus cod4x); anything else in a parsers folder is the user's own
const STOCK_PARSERS = new Set(
  (
    '__init__ altitude arma2 arma3 bf3 bf4 bfbc2 bfh chiv cod cod2 cod4 cod4gr cod4x cod4x18 cod5 cod6 cod7 cod8 csgo et etpro insurgency ' +
    'iourt41 iourt42 iourt43 moh mohw oa081 punkbuster q3 ro2 smg smg11 sof2 sof2pm wop wop15'
  ).split(' ')
);
const DATABASE_PLACEHOLDER = 'mysql://b3:password@127.0.0.1/b3';

/** Sets B3 settings in a b3.ini (key: value lines) or b3.xml (<set name="key">value</set>) config. */
/** Reads a B3 setting from a b3.ini or b3.xml config ('' when it is not set). */
export const getConfigValue = (text: string, xml: boolean, key: string): string => {
  const m = xml
    ? new RegExp(`<set\\s+name=["']${key}["']\\s*>([^<]*)</set>`, 'i').exec(text)
    : new RegExp(`^\\s*${key}\\s*[:=]\\s*(.*)$`, 'im').exec(text);
  return m ? m[1].trim() : '';
};

export const setConfigValues = (text: string, xml: boolean, values: Record<string, string>): string =>
  Object.entries(values).reduce((out, [key, value]) => {
    if (xml) {
      const re = new RegExp(`(<set\\s+name=["']${key}["']\\s*>)[^<]*(</set>)`, 'i');
      return re.test(out) ? out.replace(re, (_m, open: string, close: string) => `${open}${value}${close}`) : out;
    }
    const re = new RegExp(`^(\\s*${key}\\s*[:=]).*$`, 'im');
    return re.test(out) ? out.replace(re, (_m, head: string) => `${head} ${value}`) : out;
  }, text);

const xmlEscape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Ready-to-use b3.xml for this server (the user's CWP-Bot config with the server's values filled in). */
const defaultConfig = (v: { database: string; rcon: string; port: string; gameLog: string; ip: string }) => `<configuration>
<!--
 B3 main config, made by the panel (Install B3). For any change made in this config file, restart the bot.
 Whenever you can specify a file/directory path, the following shortcuts can be used:
    @b3 : the folder where B3 code is installed in (b3/app/b3)
    @conf : the folder containing this config file
 -->
    <settings name="b3">
        <!-- cod4x18: CoD4X without the b3hide plugin (players from "status"); cod4x needs b3hide (b3status) -->
        <set name="parser">cod4x18</set>
        <!-- Your database info: [protocol]://[db-user]:[db-password]@[db-server[:port]]/[db-name] -->
        <set name="database">${xmlEscape(v.database)}</set>
        <set name="bot_name">CWP-Bot</set>
        <set name="bot_prefix">^0(^5CWP-Bot5^0)^5:</set>
        <set name="time_format">%I:%M%p %Z %m/%d/%y</set>
        <set name="time_zone">CEST</set>
        <!-- How much detail in the b3 logfile: 9 = verbose, 10 = debug, 21 = bot, 22 = console -->
        <set name="log_level">9</set>
        <set name="logfile">b3.log</set>
    </settings>
    <settings name="server">
        <!-- The RCON password of the game server (Command line card) -->
        <set name="rcon_password">${xmlEscape(v.rcon || 'set-the-rcon-password')}</set>
        <set name="port">${xmlEscape(v.port || '28960')}</set>
        <!-- B3 sees this server's folder as /data -->
        <set name="game_log">${xmlEscape(v.gameLog)}</set>
        <!-- The public IP of the game server, and the IP the bot sends RCON commands to -->
        <set name="public_ip">${xmlEscape(v.ip)}</set>
        <set name="rcon_ip">${xmlEscape(v.ip)}</set>
        <set name="punkbuster">off</set>
        <set name="delay">0.33</set>
        <set name="lines_per_second">50</set>
    </settings>
    <settings name="autodoc">
        <set name="type">html</set>
        <set name="maxlevel">100</set>
    </settings>
    <settings name="update">
        <set name="channel">stable</set>
    </settings>
    <settings name="messages">
        <set name="kicked_by">$clientname^7 was kicked by $adminname^7 $reason</set>
        <set name="kicked">$clientname^7 was kicked $reason</set>
        <set name="banned_by">$clientname^7 was banned by $adminname^7 $reason</set>
        <set name="banned">$clientname^7 was banned $reason</set>
        <set name="temp_banned_by">$clientname^7 was temp banned by $adminname^7 for $banduration^7 $reason</set>
        <set name="temp_banned">$clientname^7 was temp banned for $banduration^7 $reason</set>
        <set name="unbanned_by">$clientname^7 was un-banned by $adminname^7 $reason</set>
        <set name="unbanned">$clientname^7 was un-banned^7 $reason</set>
    </settings>
    <settings name="plugins">
        <set name="external_dir">@b3/extplugins</set>
    </settings>
    <plugins>
        <plugin name="admin" config="@b3/conf/plugin_admin.ini" />
        <plugin name="adv" config="@b3/conf/plugin_adv.xml" />
        <plugin name="banlist" config="@b3/conf/plugin_banlist.xml" />
        <plugin name="censor" config="@b3/conf/plugin_censor.xml" />
        <plugin name="cmdmanager" config="@b3/conf/plugin_cmdmanager.ini" />
        <plugin name="pingwatch" config="@b3/conf/plugin_pingwatch.ini" />
        <plugin name="pluginmanager" config="@b3/conf/plugin_pluginmanager.ini" />
        <plugin name="stats" config="@b3/conf/plugin_stats.ini" />
        <plugin name="status" config="@b3/conf/plugin_status.ini" />
        <plugin name="welcome" config="@b3/conf/plugin_welcome.ini" />
        <plugin name="countryfilter" config="@b3/conf/plugin_countryfilter.ini" />
        <plugin name="customcommands" config="@b3/conf/plugin_customcommands.ini" />
        <plugin name="firstkill" config="@b3/conf/plugin_firstkill.ini" />
        <plugin name="geowelcome" config="@b3/conf/plugin_geowelcome.ini" />
        <plugin name="location" config="@b3/conf/plugin_location.ini" />
        <plugin name="ipban" config="@b3/conf/plugin_ipban.ini" />
        <plugin name="nickreg" config="@b3/conf/plugin_nickreg.ini" />
        <plugin name="spawnkill" config="@b3/conf/plugin_spawnkill.ini" />
    </plugins>
</configuration>
`;
const POLL_MS = 4000;
// the service writes status.json at least every 15 s; allow some clock difference between browser and server
const STALE_SECONDS = 120;
const LOG_LINES = 40;

const README = `B3 (BigBrotherBot) for this server
==================================
This folder is your B3 (big-brother-bot-master.zip, put here by Install B3) and it is the B3 that runs.
b3/conf/b3.xml    main config (made by Install B3 with this server's RCON, port, game_log and database)
b3/conf/          plugin configs (@b3/conf in b3.xml)
b3/extplugins/    extra plugins
logs/             console.log (B3 output)
control.json, status.json: used by the panel to start / stop B3

Inside B3 this server folder is /data, for example:
  game_log: /data/serverfiles/main/games_mp.log
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
  // folder of the B3 that runs, relative to b3/ ('' = b3/ itself); null = none uploaded
  const [appRoot, setAppRoot] = useState<string | null>(null);
  const [appWithoutB3, setAppWithoutB3] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasB3Log, setHasB3Log] = useState(false);
  // rcon_ip and port as written in the selected config
  const [configRcon, setConfigRcon] = useState({ ip: '', port: '' });
  const [configTick, setConfigTick] = useState(0);
  // inline editor for the selected B3 config; null = closed
  const [draft, setDraft] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState('');
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
        // the B3: directly in b3/ (Install B3 puts it there), or in b3/app, or one folder deeper
        let appRoot: string | null = null;
        if (root.entries.some((e) => e.type === 'file' && e.name === 'b3_run.py')) {
          appRoot = '';
        } else if (app?.entries.some((e) => e.type === 'file' && e.name === 'b3_run.py')) {
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
        const pre = appRoot ? `${appRoot}/` : '';
        const [appConf, appParsers] =
          appRoot !== null ? await Promise.all([list(`${pre}b3/conf`), list(`${pre}b3/parsers`)]) : [null, null];
        const configFiles = (listing: typeof conf, dir: string) =>
          (listing?.entries ?? [])
            .filter((e) => e.type === 'file' && CONFIG_FILE.test(e.name))
            .map((e) => (dir ? `${dir}/${e.name}` : e.name))
            .sort();
        // config paths are relative to b3/, the service accepts the same form
        // your B3's own conf folder first: that is where B3 keeps its config
        const all = [
          ...(appRoot !== null ? configFiles(appConf, `${pre}b3/conf`) : []),
          ...configFiles(conf, 'conf'),
          ...configFiles(root, ''),
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
        setHasB3Log(root.entries.some((e) => e.type === 'file' && e.name === 'b3.log'));
        setAppWithoutB3(Boolean(app && appRoot === null && app.entries.length > 0));
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
      setConfigTick((t) => t + 1);
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
    if (!config) {
      setConfigRcon({ ip: '', port: '' });
      return undefined;
    }
    let cancelled = false;
    void readOptional(serverId, `${B3_DIR}/${config}`).then((text) => {
      if (cancelled) return;
      const xml = /\.xml$/i.test(config);
      setConfigRcon(text ? { ip: getConfigValue(text, xml, 'rcon_ip'), port: getConfigValue(text, xml, 'port') } : { ip: '', port: '' });
    });
    return () => {
      cancelled = true;
    };
  }, [serverId, config, configTick]);

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
      const wait = () => new Promise((resolve) => window.setTimeout(resolve, 1500));
      const readStatus = async (): Promise<Partial<B3Status>> => {
        try {
          return JSON.parse((await readOptional(serverId, `${B3_DIR}/status.json`)) ?? '{}') as Partial<B3Status>;
        } catch {
          return {};
        }
      };
      // the service notices the new folder within a few seconds and reports the database
      let current: Partial<B3Status> = {};
      for (let i = 0; i < 8 && !current.database; i += 1) {
        await wait();
        current = await readStatus();
      }
      if (current.heartbeat) {
        // the service unpacks the bundled B3 (big-brother-bot zip) into b3/app, so its files can be seen and edited
        const id = newId();
        await writeServerFile(serverId, `${B3_DIR}/control.json`, `${JSON.stringify({ action: 'install', id }, null, 2)}\n`);
        for (let i = 0; i < 30 && current.lastAction?.id !== id; i += 1) {
          await wait();
          current = await readStatus();
        }
        if (current.lastAction?.id === id && current.lastAction.result === 'error') throw new Error(current.lastAction.message ?? 'Install failed.');
      }
      // a ready b3.xml in the B3's conf folder (b3/b3/conf), unless there is one already
      const confDir =
        (await readOptional(serverId, `${B3_DIR}/b3_run.py`)) !== null
          ? `${B3_DIR}/b3/conf`
          : (await readOptional(serverId, `${B3_DIR}/app/b3_run.py`)) !== null
            ? `${B3_DIR}/app/b3/conf`
            : `${B3_DIR}/conf`;
      if (confDir === `${B3_DIR}/conf`) await apiClient.createServerDirectory(serverId, B3_DIR, 'conf').catch(() => undefined);
      if (!(await readOptional(serverId, `${confDir}/b3.xml`)) && !(await readOptional(serverId, `${confDir}/b3.ini`))) {
        await writeServerFile(serverId, `${confDir}/b3.xml`, defaultConfig({ ...server, database: current.database?.url || DATABASE_PLACEHOLDER, ip: current.serverIp || '127.0.0.1' }));
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
        game_log: server.gameLog,
        ...(status?.database ? { database: status.database.url } : {}),
      };
      const next = setConfigValues(text, /\.xml$/i.test(config), values);
      if (next !== text) await writeServerFile(serverId, path, next);
      setConfigTick((t) => t + 1);
      setNotice(next !== text ? `Saved to b3/${config}.${running ? ' Restart B3 to use them.' : ''}` : `b3/${config} already has these values.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the config.');
    } finally {
      setBusy(null);
    }
  };

  const openEditor = async () => {
    setError(null);
    setNotice(null);
    const text = await readOptional(serverId, `${B3_DIR}/${config}`);
    if (text === null) {
      setError(`Could not read b3/${config}.`);
      return;
    }
    setDraft(text);
    setDraftSaved(text);
  };

  const saveEditor = async (restart: boolean) => {
    if (draft === null) return;
    setBusy('edit');
    setError(null);
    setNotice(null);
    try {
      if (/\.xml$/i.test(config)) {
        const parsed = new DOMParser().parseFromString(draft, 'application/xml');
        const problem = parsed.getElementsByTagName('parsererror')[0];
        if (problem) throw new Error(`b3/${config} is not valid XML: ${(problem.textContent ?? '').trim().split('\n')[0]}`);
      }
      await writeServerFile(serverId, `${B3_DIR}/${config}`, draft);
      setDraftSaved(draft);
      setConfigTick((t) => t + 1);
      setNotice(`Saved b3/${config}.${running && !restart ? ' Restart B3 to use the changes.' : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the config.');
      return;
    } finally {
      setBusy(null);
    }
    if (restart) await send('restart');
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
            Admin bot for the server. Install B3 puts your B3 (big-brother-bot-master.zip) into the server folder{' '}
            <code>b3</code>, with its config in <code>b3/b3/conf/b3.xml</code>. Edit the files there, then start or restart B3.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {installed && onOpenFileManagerPath && (
            <AppButton tone="ghost" onClick={() => onOpenFileManagerPath(`${B3_DIR}/`)}>
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
                    onChange={(value) => {
                      setConfig(value);
                      setDraft(null);
                    }}
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
                {appRoot !== null
                  ? `your B3 in b3/${appRoot}`
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
                  : 'none extra (your B3 has cod4x18, cod4x, cod4 …)'}
              </span>
            </div>
            <div className={row}>
              <span className={key}>game_log</span>
              <span className={val}>{server.gameLog}</span>
            </div>
            <div className={row}>
              <span className={key}>rcon_ip / port</span>
              <span className={val}>
                {configRcon.ip || status?.serverIp || '127.0.0.1'} / {configRcon.port || server.port || 'server port'}
                {!configRcon.ip && config && <span className={`ml-2 text-xs ${textSecondary}`}>(suggested; not set in b3/{config})</span>}
              </span>
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
                {draft === null && (
                  <AppButton tone="neutral" className="!h-auto !px-4 !py-1.5" onClick={() => void openEditor()} disabled={busy !== null}>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <Pencil className="h-4 w-4" /> Edit b3/{config}
                    </span>
                  </AppButton>
                )}
                {notice && <span className="text-sm text-emerald-300">{notice}</span>}
              </div>
            )}
            {draft !== null && (
              <div className="grid gap-2">
                <span className={`text-sm font-semibold ${textPrimary}`}>b3/{config}</span>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  rows={24}
                  className={`w-full resize-y rounded-lg border ${borderColor} bg-black/30 p-2 font-mono text-xs leading-5 text-gray-100`}
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <AppButton tone="neutral" className="!h-auto !px-4 !py-1.5" onClick={() => setDraft(null)} disabled={busy !== null}>
                    {draft !== draftSaved ? 'Cancel' : 'Close'}
                  </AppButton>
                  <AppButton tone="primary" className="!h-auto !px-4 !py-1.5" onClick={() => void saveEditor(false)} disabled={busy !== null || draft === draftSaved}>
                    {busy === 'edit' ? 'Saving…' : 'Save'}
                  </AppButton>
                  {running && (
                    <AppButton tone="primary" className="!h-auto !px-4 !py-1.5" onClick={() => void saveEditor(true)} disabled={busy !== null || draft === draftSaved}>
                      Save and restart B3
                    </AppButton>
                  )}
                </div>
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
                <div className="flex flex-wrap gap-1">
                  <AppButton tone="ghost" onClick={() => onOpenFileManagerPath(`${B3_DIR}/logs/console.log`)}>
                    <FileText className="h-4 w-4" /> console.log
                  </AppButton>
                  {hasB3Log && (
                    <AppButton tone="ghost" onClick={() => onOpenFileManagerPath(`${B3_DIR}/b3.log`)}>
                      <FileText className="h-4 w-4" /> b3.log
                    </AppButton>
                  )}
                </div>
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
