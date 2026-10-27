import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, Eye, EyeOff, HardDriveUpload, KeyRound, Trash2, UserPlus } from 'lucide-react';
import { apiClient } from '../../utils/api';
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

// the card's buttons: tinted, with an icon, like Start / Stop / Reinstall
const BUTTON_TONES = {
  good: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200',
  neutral: 'border-sky-500/50 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 hover:text-sky-200',
  danger: 'border-red-500/60 bg-red-500/15 text-red-300 hover:bg-red-500/25 hover:text-red-200',
} as const;

function CardButton({
  tone,
  icon: Icon,
  disabled,
  onClick,
  children,
}: {
  tone: keyof typeof BUTTON_TONES;
  icon: typeof KeyRound;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_TONES[tone]}`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

export function FtpSection({
  serverId,
  canWrite,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
  collapsible = false,
}: {
  serverId: number;
  canWrite?: boolean;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
  // above the File Manager: folded to one line unless opened (the files need the room)
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    if (!collapsible) return true;
    try {
      return localStorage.getItem('gp-ftp-card-open') === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem('gp-ftp-card-open', next ? '1' : '0');
    } catch {
      // not remembered
    }
  };
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
    <section className={`${collapsible ? 'mb-3 p-3 sm:p-4' : 'mb-4 p-4 sm:p-5'} rounded-xl border ${borderColor} ${contentBg}`}>
      {collapsible ? (
        <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={open}>
          <span className={`flex min-w-0 items-center gap-2 text-base font-semibold ${textPrimary}`}>
            <HardDriveUpload className="h-4 w-4 shrink-0 text-sky-300" /> FTP access
            {!open && account && (
              <span className={`truncate font-mono text-xs font-normal ${textSecondary}`}>
                {account.username} @ {info?.host} · FTP {info?.ftpPort} · SFTP {info?.sftpPort}
              </span>
            )}
            {!open && info?.installed && !account && <span className={`text-xs font-normal ${textSecondary}`}>no account yet</span>}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${textSecondary} ${open ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <h3 className={`flex items-center gap-2 text-base font-semibold ${textPrimary}`}>
          <HardDriveUpload className="h-4 w-4 text-sky-300" /> FTP access
        </h3>
      )}
      {open && (
      <>
      <p className={`mt-1 text-sm ${textSecondary}`}>
        Upload mods, maps and configs with FileZilla or any FTP / SFTP program. The account sees this server's files, the same as the File
        Manager below.
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
            <CardButton tone="good" icon={UserPlus} disabled={busy} onClick={() => void run(() => apiClient.ftpRequest<FtpInfo>('post', serverId))}>
              {busy ? 'Opening…' : 'Open FTP account'}
            </CardButton>
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
              <CardButton tone="neutral" icon={KeyRound} disabled={busy} onClick={() => setConfirm('reset')}>
                New password
              </CardButton>
              <CardButton tone="danger" icon={Trash2} disabled={busy} onClick={() => setConfirm('close')}>
                Close account
              </CardButton>
            </div>
          )}
        </>
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
