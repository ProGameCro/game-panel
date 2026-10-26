import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, RotateCcw, X } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { AppButton } from '../../src/ui/components';
import { ConfirmationModal } from '../ConfirmationModal';

// Reinstall of a CoD4 server's game files, for when something got broken (CoD4X, main, zone, server.cfg):
// a card in server Settings > Game config, and the same in a window from the server list.

export type Cod4ReinstallStatus = {
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

function Cod4ReinstallBody({ serverId, serverStatus, textSecondary }: { serverId: number; serverStatus?: string | null; textSecondary: string }) {
  const [keepContent, setKeepContent] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState<Cod4ReinstallStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isRunning = ['running', 'starting', 'restarting'].includes(String(serverStatus ?? '').toLowerCase());
  const working = status?.state === 'running';

  // a reinstall that is already going (started here or elsewhere) is shown too
  useEffect(() => {
    let alive = true;
    void apiClient
      .cod4ReinstallStatus(serverId)
      .then((res) => alive && res.status?.state === 'running' && setStatus(res.status))
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
        Something broken? This puts the game files back as on a new server: CoD4X, main, zone and a fresh server.cfg. The command line (RCON
        password, slots, FastDL), B3, backups and FTP stay.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className={`flex items-center gap-2 text-sm ${textSecondary}`}>
          <input type="checkbox" checked={keepContent} disabled={working} onChange={(e) => setKeepContent(e.target.checked)} />
          Keep my mods and custom maps (mods/, usermaps/)
        </label>
        <AppButton tone="ghost" disabled={working || isRunning} onClick={() => setConfirm(true)}>
          <span className="inline-flex items-center gap-2 text-red-300">
            <RotateCcw className={`h-4 w-4 ${working ? 'animate-spin' : ''}`} /> {working ? 'Reinstalling…' : 'Reinstall'}
          </span>
        </AppButton>
      </div>
      {isRunning && !working && <p className="mt-2 text-xs text-amber-300">Stop the server first.</p>}

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
            <p className="flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> Reinstall finished in {seconds} s
              {status.kept.length > 0 ? ' (mods and maps kept)' : ''}. You can start the server.
            </p>
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
            setStatus(await apiClient.cod4Reinstall(serverId, keepContent));
          } catch (e) {
            setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Reinstall failed.');
          }
        }}
        title="Reinstall the server"
        message={
          keepContent
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
        <RotateCcw className="h-4 w-4 text-sky-300" /> Reinstall
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
        className="gp-app-card w-full max-w-xl rounded-xl border border-gray-700 bg-[#0b1324] p-5 text-left shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold text-white">
            <RotateCcw className="h-4 w-4 text-sky-300" /> Reinstall · {serverName}
          </h3>
          <button type="button" className="rounded p-1 text-gray-400 hover:text-white" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Cod4ReinstallBody serverId={serverId} serverStatus={serverStatus} textSecondary="text-gray-300" />
      </div>
    </div>,
    document.body
  );
}
