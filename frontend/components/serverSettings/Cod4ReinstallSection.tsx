import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { AppButton } from '../../src/ui/components';
import { ConfirmationModal } from '../ConfirmationModal';

// Reinstall of a CoD4 server's game files, for when something got broken (CoD4X, main, zone, server.cfg).
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
  const [keepContent, setKeepContent] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const isRunning = ['running', 'starting', 'restarting'].includes(String(serverStatus ?? '').toLowerCase());

  return (
    <section className={`mb-4 rounded-xl border ${borderColor} ${contentBg} p-4 sm:p-5`}>
      <h3 className={`flex items-center gap-2 text-base font-semibold ${textPrimary}`}>
        <RotateCcw className="h-4 w-4 text-sky-300" /> Reinstall
      </h3>
      <p className={`mt-1 text-sm ${textSecondary}`}>
        Something broken? This puts the game files back as on a new server: CoD4X, main, zone and a fresh server.cfg. The command line (RCON
        password, slots, FastDL), B3, backups and FTP stay.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className={`flex items-center gap-2 text-sm ${textSecondary}`}>
          <input type="checkbox" checked={keepContent} onChange={(e) => setKeepContent(e.target.checked)} />
          Keep my mods and custom maps (mods/, usermaps/)
        </label>
        <AppButton tone="ghost" disabled={busy || isRunning} onClick={() => setConfirm(true)}>
          <span className="inline-flex items-center gap-2 text-red-300">
            <RotateCcw className="h-4 w-4" /> {busy ? 'Reinstalling…' : 'Reinstall'}
          </span>
        </AppButton>
      </div>
      {isRunning && <p className="mt-2 text-xs text-amber-300">Stop the server first.</p>}
      {result && <p className={`mt-2 text-sm ${result.ok ? 'text-emerald-300' : 'text-red-300'}`}>{result.text}</p>}
      <ConfirmationModal
        isOpen={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          setBusy(true);
          setResult(null);
          try {
            await apiClient.reinstallCod4(serverId, keepContent);
            setResult({ ok: true, text: `Reinstalled${keepContent ? ' (mods and maps kept)' : ''}. Start the server.` });
          } catch (e) {
            setResult({ ok: false, text: (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Reinstall failed.' });
          } finally {
            setBusy(false);
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
    </section>
  );
}
