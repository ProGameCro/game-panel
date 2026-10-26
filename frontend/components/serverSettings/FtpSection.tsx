import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Eye, EyeOff, HardDriveUpload, KeyRound, Trash2 } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { AppButton } from '../../src/ui/components';
import { ConfirmationModal } from '../ConfirmationModal';

// FTP / FTPS / SFTP access to this server's files (gp-ftp.sh): one account per server, its home is serverfiles.
export type FtpInfo = {
  installed: boolean;
  running: boolean;
  host: string | null;
  ftpPort: number | null;
  sftpPort: number | null;
  account: { username: string; password: string } | null;
};

const errorText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (e instanceof Error ? e.message : fallback);

function CopyField({ label, value, secret, textSecondary }: { label: string; value: string; secret?: boolean; textSecondary: string }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <div className={`mb-1 text-xs ${textSecondary}`}>{label}</div>
      <div className="flex items-center gap-1.5 rounded-lg border border-gray-600 bg-black/20 px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-sm text-white">{shown ? value : '•'.repeat(Math.min(value.length, 12))}</code>
        {secret && (
          <button type="button" className="text-gray-400 hover:text-white" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide' : 'Show'}>
            {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
        <button
          type="button"
          className="text-gray-400 hover:text-white"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export function FtpSection({
  serverId,
  canWrite,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
}: {
  serverId: number;
  canWrite?: boolean;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}) {
  const [info, setInfo] = useState<FtpInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'reset' | 'close' | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await apiClient.ftpRequest<FtpInfo>('get', serverId));
      setError(null);
    } catch (e) {
      setError(errorText(e, 'Could not read the FTP access.'));
    }
  }, [serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<FtpInfo>) => {
    setBusy(true);
    setError(null);
    try {
      setInfo(await fn());
    } catch (e) {
      setError(errorText(e, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  const account = info?.account ?? null;

  return (
    <section className={`mb-4 rounded-xl border ${borderColor} ${contentBg} p-4 sm:p-5`}>
      <h3 className={`flex items-center gap-2 text-base font-semibold ${textPrimary}`}>
        <HardDriveUpload className="h-4 w-4 text-sky-300" /> FTP access
      </h3>
      <p className={`mt-1 text-sm ${textSecondary}`}>
        Upload mods, maps and configs with FileZilla or any FTP / SFTP program. The account sees this server's files (serverfiles), like the File
        Manager.
      </p>

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      {!info && !error && <p className={`mt-3 text-sm ${textSecondary}`}>Loading…</p>}

      {info && !info.installed && (
        <p className="mt-3 text-sm text-amber-300">
          FTP is not set up on the panel server yet. A Super Admin runs there: <code>bash gp-ftp.sh</code>
        </p>
      )}
      {info?.installed && !info.running && (
        <p className="mt-3 text-sm text-amber-300">The FTP service is not running (container gamepanel-ftp). On the panel server: <code>bash gp-ftp.sh</code></p>
      )}

      {info?.installed && !account && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className={`text-sm ${textSecondary}`}>This server has no FTP account yet.</p>
          {canWrite && (
            <AppButton tone="primary" disabled={busy} onClick={() => void run(() => apiClient.ftpRequest<FtpInfo>('post', serverId))}>
              {busy ? 'Opening…' : 'Open FTP account'}
            </AppButton>
          )}
        </div>
      )}

      {info?.installed && account && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
            <CopyField label="Host" value={info.host ?? ''} textSecondary={textSecondary} />
            <CopyField label="FTP / FTPS port" value={String(info.ftpPort ?? '')} textSecondary={textSecondary} />
            <CopyField label="SFTP port" value={String(info.sftpPort ?? '')} textSecondary={textSecondary} />
            <CopyField label="Username" value={account.username} textSecondary={textSecondary} />
            <CopyField label="Password" value={account.password} secret textSecondary={textSecondary} />
          </div>
          <p className={`mt-3 text-xs ${textSecondary}`}>
            FileZilla: Protocol <b>FTP</b> with Encryption <b>Require explicit FTP over TLS</b> (port {info.ftpPort}), or <b>SFTP</b> (port {info.sftpPort}).
            Plain FTP works too, but sends the password unencrypted. Files uploaded here are the server's own: restart the server (or change the
            map) to use new mods.
          </p>
          {canWrite && (
            <div className="mt-3 flex flex-wrap gap-2">
              <AppButton tone="ghost" disabled={busy} onClick={() => setConfirm('reset')}>
                <span className="inline-flex items-center gap-2">
                  <KeyRound className="h-4 w-4" /> New password
                </span>
              </AppButton>
              <AppButton tone="ghost" disabled={busy} onClick={() => setConfirm('close')}>
                <span className="inline-flex items-center gap-2 text-red-300">
                  <Trash2 className="h-4 w-4" /> Close account
                </span>
              </AppButton>
            </div>
          )}
        </>
      )}

      <ConfirmationModal
        isOpen={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const action = confirm;
          setConfirm(null);
          if (action === 'reset') await run(() => apiClient.ftpRequest<FtpInfo>('post', serverId, { reset: true }));
          if (action === 'close') await run(() => apiClient.ftpRequest<FtpInfo>('delete', serverId));
        }}
        title={confirm === 'reset' ? 'New FTP password' : 'Close the FTP account'}
        message={
          confirm === 'reset'
            ? 'Make a new password? The old one stops working at once (also for anyone who has it).'
            : 'Close this server\'s FTP account? Nobody can log in with it any more. The server\'s files stay.'
        }
        confirmText={confirm === 'reset' ? 'New password' : 'Close account'}
        icon={confirm === 'close' ? 'danger' : 'warning'}
        confirmButtonClass={confirm === 'close' ? 'bg-red-600 hover:bg-red-700' : undefined}
      />
    </section>
  );
}
