import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Play, Wrench, Square, X } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { ConfirmationModal } from '../ConfirmationModal';

// Reinstall of a CoD4 server's game files, for when something got broken (CoD4X, main, zone, server.cfg):
// a card in server Settings > Game config, and the same in a window from the server list.

export type ReinstallKind = 'cod4' | 'linuxgsm' | 'ovhcloud';

export type Cod4ReinstallStatus = {
  kind?: ReinstallKind;
  state: 'running' | 'done' | 'error';
  step: 'checking' | 'removing' | 'copying' | 'config' | 'restoring' | 'done';
  done: number;
  total: number;
  keepContent: boolean;
  kept: string[];
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
};

const STEP_TEXT: Record<Cod4ReinstallStatus['step'], string> = {
  checking: 'Checking…',
  removing: 'Removing the old game files…',
  copying: 'Putting the game files back',
  config: 'Writing server.cfg…',
  restoring: 'Putting your mods and maps back…',
  done: 'Done',
};

// Reinstall / Start / Stop: solid, coloured like the server list's power buttons
const ACTION_STYLE = {
  start: { icon: Play, label: 'Start server', busy: 'Starting…', cls: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200' },
  stop: { icon: Square, label: 'Stop server', busy: 'Stopping…', cls: 'border-red-500/60 bg-red-500/15 text-red-300 hover:bg-red-500/25 hover:text-red-200' },
  reinstall: { icon: Wrench, label: 'Reinstall', busy: 'Reinstalling…', cls: 'border-amber-500/60 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 hover:text-amber-200' },
} as const;

function PowerButton({ kind, busy, disabled, onClick }: { kind: keyof typeof ACTION_STYLE; busy: boolean; disabled?: boolean; onClick: () => void }) {
  const style = ACTION_STYLE[kind];
  const Icon = style.icon;
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className={`inline-flex min-w-[9rem] items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${style.cls}`}
    >
      <Icon className={`h-4 w-4 ${busy && kind === 'reinstall' ? 'animate-pulse' : ''}`} />
      {busy ? style.busy : style.label}
    </button>
  );
}

function Cod4ReinstallBody({ serverId, serverStatus, textSecondary }: { serverId: number; serverStatus?: string | null; textSecondary: string }) {
  const [keepContent, setKeepContent] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState<Cod4ReinstallStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState<'idle' | 'starting' | 'started'>('idle');
  const [stopping, setStopping] = useState(false);
  // how this server is reinstalled (undefined while loading, null: not possible)
  const [kind, setKind] = useState<ReinstallKind | null | undefined>(undefined);
  const isRunning = ['running', 'starting', 'restarting'].includes(String(serverStatus ?? '').toLowerCase());
  const working = status?.state === 'running';

  // a reinstall that is already going (started here or elsewhere) is shown too
  useEffect(() => {
    let alive = true;
    void apiClient
      .cod4ReinstallStatus(serverId)
      .then((res) => {
        if (!alive) return;
        setKind((res as { kind?: ReinstallKind | null }).kind ?? null);
        if (res.status?.state === 'running') setStatus(res.status);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [serverId]);

  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => {
      void apiClient
        .cod4ReinstallStatus(serverId)
        .then((res) => res.status && setStatus(res.status))
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [working, serverId]);

  const percent = status && status.total > 0 ? Math.min(100, Math.round((status.done / status.total) * 100)) : 0;
  const seconds = status ? Math.max(1, Math.round(((status.finishedAt ?? Date.now()) - status.startedAt) / 1000)) : 0;

  return (
    <>
      <p className={`mt-1 text-sm ${textSecondary}`}>
        {kind === undefined && 'Loading…'}
        {kind === null && 'This server cannot be reinstalled from the panel (custom Docker image).'}
        {kind === 'cod4' &&
          'Something broken? This puts the game files back as on a new server: CoD4X, main, zone and a fresh server.cfg. The command line (RCON password, slots, FastDL), B3, backups and FTP stay.'}
        {kind === 'linuxgsm' &&
          'Something broken? This deletes the game files (serverfiles) and LinuxGSM downloads and installs the game again when the server starts (a few minutes, follow Log/Console). Everything in serverfiles goes, also configs, mods, maps and saves: download what you want to keep first (File Manager, FTP or Backups). The LinuxGSM settings stay.'}
        {kind === 'ovhcloud' &&
          'Something broken? This deletes everything of the server, also saves and worlds, and installs it again; it starts by itself when the install is done. Download what you want to keep first (File Manager or Backups).'}
      </p>
      {kind && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {kind === 'cod4' ? (
            <label className={`flex items-center gap-2 text-sm ${textSecondary}`}>
              <input type="checkbox" checked={keepContent} disabled={working} onChange={(e) => setKeepContent(e.target.checked)} />
              Keep my mods and custom maps (mods/, usermaps/)
            </label>
          ) : (
            <span />
          )}
          <PowerButton kind="reinstall" busy={working} disabled={isRunning} onClick={() => setConfirm(true)} />
        </div>
      )}
      {kind && isRunning && !working && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-amber-300">The server is running: stop it first.</p>
          <PowerButton
            kind="stop"
            busy={stopping}
            onClick={() => {
              setStopping(true);
              setError(null);
              apiClient
                .stopServer(serverId)
                .catch((e) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not stop the server.'))
                .finally(() => setStopping(false));
            }}
          />
        </div>
      )}

      {status && (
        <div className="mt-3 rounded-lg border border-gray-700 p-3">
          {status.state === 'running' && (
            <>
              <div className="mb-1.5 flex items-center justify-between text-sm text-gray-200">
                <span>
                  {STEP_TEXT[status.step]}
                  {status.step === 'copying' && `: ${status.done} / ${status.total} files`}
                </span>
                <span className="text-xs text-gray-400">{seconds} s</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-700">
                <div
                  className="h-full rounded-full bg-sky-400 transition-all duration-500"
                  style={{ width: `${status.step === 'copying' ? percent : status.step === 'restoring' ? 100 : 3}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-gray-400">You can close this window: the reinstall keeps going.</p>
            </>
          )}
          {status.state === 'done' && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {(status.kind ?? kind) === 'linuxgsm'
                  ? 'Game files removed. Start the server: LinuxGSM downloads and installs the game (follow Log/Console).'
                  : (status.kind ?? kind) === 'ovhcloud'
                    ? 'The reinstall has started: the server installs again and starts by itself (follow Log/Console).'
                    : `Reinstall finished in ${seconds} s${status.kept.length > 0 ? ' (mods and maps kept)' : ''}.`}
              </p>
              {(status.kind ?? kind) === 'ovhcloud' ? null : start === 'started' ? (
                <span className="text-sm text-emerald-300">Server is starting.</span>
              ) : (
                <PowerButton
                  kind="start"
                  busy={start === 'starting'}
                  onClick={() => {
                    setStart('starting');
                    setError(null);
                    apiClient
                      .startServer(serverId)
                      .then(() => setStart('started'))
                      .catch((e) => {
                        setStart('idle');
                        setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not start the server.');
                      });
                  }}
                />
              )}
            </div>
          )}
          {status.state === 'error' && <p className="text-sm text-red-300">Reinstall failed: {status.error}</p>}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}

      <ConfirmationModal
        isOpen={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          setError(null);
          try {
            setStart('idle');
            setStatus(await apiClient.cod4Reinstall(serverId, keepContent));
          } catch (e) {
            setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Reinstall failed.');
          }
        }}
        title="Reinstall the server"
        message={
          kind === 'linuxgsm'
            ? 'Delete the game files (serverfiles) and install the game again on the next start? Configs, mods, maps and saves in serverfiles are deleted.'
            : kind === 'ovhcloud'
              ? 'Delete everything of this server (also saves and worlds) and install it again?'
              : keepContent
                ? 'Put the game files back as new? server.cfg and every other file in the server folder are replaced; mods/ and usermaps/ stay.'
                : 'Put the game files back as new? Everything in the server folder is deleted, also mods/ and usermaps/.'
        }
        confirmText="Reinstall"
        icon="danger"
        confirmButtonClass="bg-red-600 hover:bg-red-700"
      />
    </>
  );
}

export function Cod4ReinstallSection({
  serverId,
  serverStatus,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
}: {
  serverId: number;
  serverStatus?: string | null;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}) {
  return (
    <section className={`mb-4 rounded-xl border ${borderColor} ${contentBg} p-4 sm:p-5`}>
      <h3 className={`flex items-center gap-2 text-base font-semibold ${textPrimary}`}>
        <Wrench className="h-4 w-4 text-sky-300" /> Reinstall
      </h3>
      <Cod4ReinstallBody serverId={serverId} serverStatus={serverStatus} textSecondary={textSecondary} />
    </section>
  );
}

// the same as a window (Game Servers list > Reinstall)
export function Cod4ReinstallDialog({
  serverId,
  serverName,
  serverStatus,
  onClose,
}: {
  serverId: number;
  serverName: string;
  serverStatus?: string | null;
  onClose: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Reinstall ${serverName}`}
        className="gp-themed-dialog w-full max-w-xl rounded-xl border border-gray-200 bg-white p-5 text-left text-gray-900 shadow-2xl dark:border-[#27364d] dark:bg-[#0f172a] dark:text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Wrench className="h-4 w-4 text-sky-300" /> Reinstall · {serverName}
          </h3>
          <button type="button" className="rounded p-1 text-gray-400 hover:text-white" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Cod4ReinstallBody serverId={serverId} serverStatus={serverStatus} textSecondary="text-gray-600 dark:text-gray-300" />
      </div>
    </div>,
    document.body
  );
}
