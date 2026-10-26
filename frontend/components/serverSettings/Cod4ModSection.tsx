import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, FolderOpen, RefreshCw, Save, Terminal, Wand2 } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { AppButton, AppInput, AppSelect } from '../../src/ui/components';
import { RestartToApplyNote } from './RestartToApplyNote';

// Call of Duty 4 (LinuxGSM cod4server) command line, edited like on CoD4X hosting panels:
// +set sv_authtoken, r_xassetnum (materials / xanims / xmodels), +set fs_game and rcon_password.
// - startparameters is written to the instance config (<gameservername>.cfg), which LinuxGSM
//   reads last of the normal configs, so it overrides _default.cfg and survives LinuxGSM updates;
// - the RCON password is written straight into the command line (never server.cfg); LinuxGSM runs that line through a
//   shell, so the password is limited to characters the shell leaves alone;
// - the auth token is kept in secrets-common.cfg (LinuxGSM's file for secrets); the command line references ${authtoken};
// - fs_game, sv_authtoken and r_xassetnum go before the first +map/+exec.
// - CoD4X applies every "+set" before running the other startup commands, so server.cfg (+exec) would override a
//   "+set rcon_password". The password is set with "+rcon_password X" at the end instead: plain commands run in order,
//   after +exec, so this one wins over a rcon_password in server.cfg.

export interface Cod4ModSectionProps {
  serverId: number;
  serverStatus?: string | null;
  gameServerName?: string;
  canReadFileManager?: boolean;
  canWriteFileManager?: boolean;
  onOpenFileManagerPath?: (path: string) => void;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}

type Assets = { material: string; xanim: string; xmodel: string };
export type Cod4CommandLine = { mod: string; auth: boolean; assets: Assets; custom: boolean; rcon: string };

const MOD_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
// no spaces, quotes, $ or shell characters: the value is expanded unquoted by LinuxGSM
// CoD4 wants a simple RCON password: letters and numbers only, at least 8
const PASSWORD_PATTERN = /^[A-Za-z0-9]{8,32}$/;
// no look-alike characters (0/O, 1/l/I), so the password is easy to type in the game console
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const ASSET_LIMIT = 65535;
const NO_MOD = '__none__';

const SET_VALUE = (dvar: string) => new RegExp(`\\s*\\+set\\s+${dvar}\\s+(?:"[^"]*"|\\S+)`, 'gi');
// rcon_password as "+set rcon_password X" (older lines) or "+rcon_password X"
const RCON_VALUE = /\s*\+(?:set\s+)?rcon_password\s+(?:"([^"]*)"|(\S+))/gi;
const CUSTOM_REFERENCE = '${customparameters}';
const EARLY_AT = /\+(?:exec|map|map_rotate|devmap)\b/;

const unquote = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).replace(/\\"/g, '"') : trimmed;
};
const cfgLine = (key: string) => new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm');
export const readCfgValue = (content: string, key: string): string | null => {
  const match = cfgLine(key).exec(content);
  return match ? unquote(match[1]) : null;
};
const upsertCfgValue = (content: string, key: string, value: string, before?: string): string => {
  const line = `${key}="${value.replace(/"/g, '\\"')}"`;
  if (cfgLine(key).test(content)) return content.replace(cfgLine(key), line);
  if (before && cfgLine(before).test(content)) return content.replace(cfgLine(before), (m) => `${line}\n${m}`);
  const prefix = content.length > 0 && !content.endsWith('\n') ? `${content}\n` : content;
  return `${prefix}${line}\n`;
};
const removeCfgKey = (content: string, key: string): string => content.replace(new RegExp(`^\\s*${key}\\s*=.*(?:\\r?\\n)?`, 'm'), '');
const tidy = (value: string) => value.replace(/\s{2,}/g, ' ').trim();

/** What the panel manages in a command line. */
export const parseCommandLine = (parameters: string): Cod4CommandLine => {
  const assetsRaw = /\+set\s+r_xassetnum\s+(?:"([^"]*)"|(\S+))/i.exec(parameters);
  const assetText = assetsRaw ? assetsRaw[1] ?? assetsRaw[2] ?? '' : '';
  const asset = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(\\d+)`, 'i').exec(assetText)?.[1] ?? '';
  return {
    mod: /\+set\s+fs_game\s+"?mods\/([^"\s]+)"?/i.exec(parameters)?.[1] ?? '',
    auth: /\+set\s+sv_authtoken\s/i.test(parameters),
    assets: { material: asset('material'), xanim: asset('xanim'), xmodel: asset('xmodel') },
    custom: parameters.includes(CUSTOM_REFERENCE),
    rcon: new RegExp(RCON_VALUE.source, 'i').exec(parameters)?.slice(1).find((v) => v !== undefined) ?? '',
  };
};

/** The command line without anything the panel manages. */
export const baseCommandLine = (parameters: string): string =>
  tidy(
    ['fs_game', 'sv_authtoken', 'r_xassetnum']
      .reduce((text, dvar) => text.replace(SET_VALUE(dvar), ''), parameters)
      .replace(RCON_VALUE, '')
      .split(CUSTOM_REFERENCE)
      .join('')
  );

export const buildCommandLine = (parameters: string, wanted: Cod4CommandLine): string => {
  const base = baseCommandLine(parameters);
  const assets = (['material', 'xanim', 'xmodel'] as const).filter((k) => wanted.assets[k]).map((k) => `${k}=${wanted.assets[k]}`);
  const early = [
    wanted.mod && `+set fs_game mods/${wanted.mod}`,
    wanted.auth && '+set sv_authtoken ${authtoken}',
    assets.length > 0 && `+set r_xassetnum "${assets.join(' ')}"`,
  ]
    .filter(Boolean)
    .join(' ');
  const at = base.search(EARLY_AT);
  const withEarly = !early ? base : at >= 0 ? `${base.slice(0, at)}${early} ${base.slice(at)}` : `${base} ${early}`;
  return tidy([withEarly, wanted.custom && CUSTOM_REFERENCE, wanted.rcon && `+rcon_password ${wanted.rcon}`].filter(Boolean).join(' '));
};

// kept for the earlier mod-only callers and tests
export const modFromStartParameters = (parameters: string): string => parseCommandLine(parameters).mod;
export const withMod = (parameters: string, mod: string): string => buildCommandLine(parameters, { ...parseCommandLine(parameters), mod });

const generatePassword = (): string => {
  const bytes = new Uint32Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => PASSWORD_CHARS[n % PASSWORD_CHARS.length]).join('');
};

export const readOptional = async (serverId: number, path: string): Promise<string | null> => {
  try {
    return await apiClient.readServerFile(serverId, path);
  } catch {
    return null;
  }
};

/** Writes a server file, creating it when it does not exist yet (the update call only works on existing files). */
export const writeServerFile = async (serverId: number, path: string, content: string): Promise<void> => {
  try {
    await apiClient.updateServerFile(serverId, path, content);
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status !== 404) throw e;
    const at = path.lastIndexOf('/');
    await apiClient.createServerFile(serverId, at >= 0 ? path.slice(0, at) : '/', path.slice(at + 1), content);
  }
};

/** LinuxGSM config files of an instance, in the order LinuxGSM lets them override each other (last wins). */
export const linuxGsmConfigPaths = (gameServerName: string) => {
  const dir = `config-lgsm/${gameServerName}`;
  return {
    defaults: `${dir}/_default.cfg`,
    common: `${dir}/common.cfg`,
    secretsCommon: `${dir}/secrets-common.cfg`,
    instance: `${dir}/${gameServerName}.cfg`,
    secretsInstance: `${dir}/secrets-${gameServerName}.cfg`,
  };
};

const validAsset = (value: string) => value === '' || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= ASSET_LIMIT);

function SecretInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <AppInput
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoComplete="new-password"
        className="w-full pr-10"
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-white"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide' : 'Show'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function Cod4ModSection({
  serverId,
  serverStatus,
  gameServerName = 'cod4server',
  canReadFileManager,
  canWriteFileManager,
  onOpenFileManagerPath,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
}: Cod4ModSectionProps) {
  const paths = useMemo(() => linuxGsmConfigPaths(gameServerName), [gameServerName]);
  const modsPath = 'serverfiles/mods';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [mods, setMods] = useState<string[]>([]);
  const [parameters, setParameters] = useState<string | null>(null);
  const [instanceContent, setInstanceContent] = useState('');
  const [secretsContent, setSecretsContent] = useState('');
  const [initial, setInitial] = useState({ mod: '', auth: '', material: '', xanim: '', xmodel: '', rcon: '', slots: '' });

  const [selected, setSelected] = useState(NO_MOD);
  const [typed, setTyped] = useState('');
  const [auth, setAuth] = useState('');
  const [assets, setAssets] = useState<Assets>({ material: '', xanim: '', xmodel: '' });
  const [rcon, setRcon] = useState('');
  // LinuxGSM's maxplayers, used by the command line as +set sv_maxclients ${maxplayers}
  const [slots, setSlots] = useState('');
  // ${customparameters} is kept where LinuxGSM's config already has it
  const [keepCustom, setKeepCustom] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listing, defaults, common, secretsCommon, instance, secretsInstance] = await Promise.all([
        apiClient.listServerFiles(serverId, modsPath).catch(() => null),
        readOptional(serverId, paths.defaults),
        readOptional(serverId, paths.common),
        readOptional(serverId, paths.secretsCommon),
        readOptional(serverId, paths.instance),
        readOptional(serverId, paths.secretsInstance),
      ]);
      const folders = (listing?.entries ?? [])
        .filter((entry) => entry.type === 'dir' && MOD_NAME_PATTERN.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
      // same priority LinuxGSM uses: instance secrets, instance, common secrets, common, defaults
      const sources = [secretsInstance, instance, secretsCommon, common, defaults].map((c) => c ?? '');
      const effective = sources.map((c) => readCfgValue(c, 'startparameters')).find((v) => v !== null) ?? null;
      const line = parseCommandLine(effective ?? '');
      const secretOf = (key: string) => readCfgValue(secretsInstance ?? '', key) ?? readCfgValue(secretsCommon ?? '', key) ?? '';
      const values = {
        mod: line.mod,
        auth: line.auth ? secretOf('authtoken') : '',
        material: line.assets.material,
        xanim: line.assets.xanim,
        xmodel: line.assets.xmodel,
        rcon: line.rcon === '${rconpassword}' ? secretOf('rconpassword') : line.rcon,
        slots: sources.map((c) => readCfgValue(c, 'maxplayers')).find((v) => v !== null) ?? '',
      };
      setMods(folders);
      setParameters(effective);
      setInstanceContent(instance ?? '');
      setSecretsContent(secretsCommon ?? '');
      setInitial(values);
      setSelected(values.mod && folders.includes(values.mod) ? values.mod : NO_MOD);
      setTyped(values.mod && !folders.includes(values.mod) ? values.mod : '');
      setAuth(values.auth);
      setAssets({ material: values.material, xanim: values.xanim, xmodel: values.xmodel });
      setRcon(values.rcon);
      setSlots(values.slots);
      setKeepCustom(line.custom);
      if (effective === null) {
        setError(`Could not find "startparameters" in ${paths.defaults}. Start the server once so LinuxGSM creates its config, then reload.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the server configuration.');
    } finally {
      setLoading(false);
    }
  }, [serverId, paths]);

  useEffect(() => {
    void load();
  }, [load]);

  const mod = typed.trim() || (selected === NO_MOD ? '' : selected);
  const problems = {
    mod: typed.trim() !== '' && !MOD_NAME_PATTERN.test(typed.trim()),
    auth: auth !== '' && !TOKEN_PATTERN.test(auth),
    material: !validAsset(assets.material),
    xanim: !validAsset(assets.xanim),
    xmodel: !validAsset(assets.xmodel),
    rcon: rcon !== '' && !PASSWORD_PATTERN.test(rcon),
    slots: slots !== '' && !(/^\d+$/.test(slots) && Number(slots) >= 1 && Number(slots) <= 64),
  };
  const invalid = Object.values(problems).some(Boolean);
  const current = { mod, auth, ...assets, rcon, slots };
  const wanted: Cod4CommandLine = { mod, auth: auth !== '', assets, custom: keepCustom, rcon };
  const preview = parameters === null ? '' : buildCommandLine(parameters, wanted);
  // also when the saved line only needs rewriting (e.g. an old "+set rcon_password" moved to "+rcon_password")
  const changed =
    (Object.keys(current) as (keyof typeof current)[]).some((k) => current[k] !== initial[k]) ||
    (parameters !== null && preview !== parameters);

  const options = useMemo(
    () => [{ value: NO_MOD, label: 'No mod (stock game)' }, ...mods.map((m) => ({ value: m, label: `mods/${m}` }))],
    [mods]
  );

  const save = async () => {
    if (parameters === null || invalid || !canWriteFileManager) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      let secrets = secretsContent;
      if (auth) secrets = upsertCfgValue(secrets, 'authtoken', auth);
      else if (initial.auth) secrets = removeCfgKey(secrets, 'authtoken');
      // the RCON password lives only in the command line now
      secrets = removeCfgKey(secrets, 'rconpassword');
      let instance = upsertCfgValue(instanceContent, 'startparameters', preview);
      if (slots && slots !== initial.slots) instance = upsertCfgValue(instance, 'maxplayers', slots, 'startparameters');
      if (secrets !== secretsContent) await writeServerFile(serverId, paths.secretsCommon, secrets);
      await writeServerFile(serverId, paths.instance, instance);
      setSaved(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the command line.');
    } finally {
      setSaving(false);
    }
  };

  if (!canReadFileManager) return null;

  const disabled = loading || !canWriteFileManager;
  const row = 'grid gap-1.5 sm:grid-cols-[11rem_1fr] sm:items-center sm:gap-x-4';
  const label = `text-sm font-semibold sm:text-right ${textPrimary}`;
  const hint = `text-xs ${textSecondary} sm:col-start-2`;
  const bad = 'text-xs text-red-400 sm:col-start-2';
  const assetLabel = { material: 'Materials', xanim: 'Xanims', xmodel: 'Xmodels' } as const;

  return (
    <section className={`mb-4 rounded-xl border ${borderColor} ${contentBg} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className={`flex items-center gap-2 text-base font-semibold ${textPrimary}`}>
            <Terminal className="h-4 w-4 text-sky-300" /> Command line
          </h3>
          <p className={`mt-1 text-sm ${textSecondary}`}>
            Start options of the CoD4 server. Empty fields are left out. The RCON password goes straight into the start command, the auth token is stored in{' '}
            <code>{paths.secretsCommon}</code>. Nothing is written to server.cfg.
          </p>
        </div>
        <div className="flex gap-2">
          {onOpenFileManagerPath && (
            <AppButton tone="ghost" onClick={() => onOpenFileManagerPath(`${modsPath}/`)}>
              <FolderOpen className="h-4 w-4" /> Open mods folder
            </AppButton>
          )}
          <AppButton tone="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Reload
          </AppButton>
        </div>
      </div>

      <div className="mt-4 grid gap-4 rounded-lg border border-sky-500/50 bg-sky-500/5 p-4">
        <label className={row}>
          <span className={label}>Slots</span>
          <AppInput
            type="number"
            min={1}
            max={64}
            value={slots}
            className="w-full max-w-[10rem]"
            onChange={(event) => {
              setSlots(event.target.value.trim());
              setSaved(false);
            }}
            disabled={disabled}
          />
          <span className={hint}>Maximum players (sv_maxclients, LinuxGSM maxplayers), 1 to 64.</span>
          {problems.slots && <span className={bad}>Enter a number from 1 to 64.</span>}
        </label>

        <label className={row}>
          <span className={label}>+set sv_authtoken</span>
          <SecretInput
            value={auth}
            onChange={(v) => {
              setAuth(v.trim());
              setSaved(false);
            }}
            placeholder="CoD4X auth token"
            disabled={disabled}
          />
          {problems.auth && <span className={bad}>8–128 characters: letters, numbers, dot, dash, underscore.</span>}
        </label>

        {(['material', 'xanim', 'xmodel'] as const).map((key) => (
          <label key={key} className={row}>
            <span className={label}>{assetLabel[key]}</span>
            <AppInput
              type="number"
              min={1}
              max={ASSET_LIMIT}
              value={assets[key]}
              placeholder="default"
              className="w-full"
              onChange={(event) => {
                const value = event.target.value.trim();
                setAssets((a) => ({ ...a, [key]: value }));
                setSaved(false);
              }}
              disabled={disabled}
            />
            {problems[key] && <span className={bad}>A whole number from 1 to {ASSET_LIMIT}.</span>}
          </label>
        ))}
        <div className={row}>
          <span className="hidden sm:block" />
          <span className={`text-xs ${textSecondary}`}>Materials, Xanims and Xmodels raise the asset limits for big mods (+set r_xassetnum).</span>
        </div>

        <div className={row}>
          <span className={label}>+set fs_game</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <AppSelect
              options={options}
              value={selected}
              onChange={(v) => {
                setSelected(v);
                setTyped('');
                setSaved(false);
              }}
              disabled={disabled}
            />
            <AppInput
              value={typed}
              placeholder="or type the mod folder name"
              className="w-full"
              onChange={(event) => {
                setTyped(event.target.value);
                setSaved(false);
              }}
              disabled={disabled}
            />
          </div>
          <span className={hint}>
            A folder in <code>{modsPath}</code> (with its mod.ff and .iwd files).
          </span>
          {problems.mod && <span className={bad}>Letters, numbers, dot, dash and underscore only.</span>}
        </div>

        <div className={row}>
          <span className={label}>rcon_password</span>
          <div className="flex gap-2">
            <div className="flex-1">
              <SecretInput
                value={rcon}
                onChange={(v) => {
                  setRcon(v.trim());
                  setSaved(false);
                }}
                placeholder="8–32 letters and numbers"
                disabled={disabled}
              />
            </div>
            {canWriteFileManager && (
              <AppButton
                tone="ghost"
                onClick={() => {
                  setRcon(generatePassword());
                  setSaved(false);
                }}
                disabled={loading}
              >
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <Wand2 className="h-4 w-4" /> Generate
                </span>
              </AppButton>
            )}
          </div>
          <span className={hint}>Set after server.cfg (+rcon_password at the end of the command line), so it counts even if server.cfg has its own rcon_password.</span>
          {problems.rcon && <span className={bad}>8–32 characters, letters and numbers only (no special characters).</span>}
        </div>

      </div>

      {preview && (
        <p className={`mt-3 break-all rounded-lg border ${borderColor} bg-black/20 p-2 font-mono text-xs ${textSecondary}`}>{preview}</p>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {saved && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>
            Saved to {paths.instance}
            {auth ? ` and ${paths.secretsCommon}` : ''}.
          </span>
        </div>
      )}
      {saved && (
        <div className="mt-3">
          <RestartToApplyNote serverStatus={serverStatus} />
        </div>
      )}

      {canWriteFileManager && (
        <div className="mt-4 flex justify-end">
          <AppButton
            tone="primary"
            className="!h-auto min-w-[9.5rem] !px-5 !py-2"
            onClick={() => void save()}
            disabled={loading || saving || !changed || invalid || parameters === null}
          >
            <span className="inline-flex items-center gap-2 whitespace-nowrap">
              <Save className="h-4 w-4 flex-shrink-0" /> {saving ? 'Saving…' : 'Save'}
            </span>
          </AppButton>
        </div>
      )}
    </section>
  );
}
