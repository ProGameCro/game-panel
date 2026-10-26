import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, HardDriveUpload, KeyRound, Plus, Trash2 } from 'lucide-react';
import { adminApi, apiError, type FtpOverview } from '../../utils/adminApi';
import { ConfirmationModal } from '../ConfirmationModal';
import { Note, Panel, SmallButton, td, th } from './shared';

// FTP tab: every server's FTP / SFTP account (gp-ftp.sh): open, new password, close.
export function AdminFtp() {
  const [data, setData] = useState<FtpOverview | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<{ kind: 'reset' | 'close'; id: number; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await adminApi.ftp());
    } catch (e) {
      setResult({ ok: false, text: apiError(e, 'Could not read the FTP accounts.') });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setResult(null);
    try {
      setResult({ ok: true, text: await fn() });
      await load();
    } catch (e) {
      setResult({ ok: false, text: apiError(e, 'That did not work.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Note result={result} />
      <Panel title="FTP / SFTP" icon={<HardDriveUpload className="h-4 w-4" />}>
        {!data ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : !data.installed ? (
          <p className="text-sm text-amber-300">
            FTP is not installed. On the panel server: <code>bash gp-ftp.sh</code> (FTP and FTPS on port 21, SFTP on port 2022).
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-400">
              {data.running ? <span className="text-emerald-300">Running</span> : <span className="text-red-300">Not running (bash gp-ftp.sh)</span>} ·{' '}
              <code>{data.host}</code> · FTP / FTPS port {data.ftpPort} · SFTP port {data.sftpPort}. One account per server; it sees the server's
              serverfiles folder.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px]">
                <thead>
                  <tr>
                    <th className={th}>Server</th>
                    <th className={th}>Username</th>
                    <th className={th}>Password</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {data.servers.map((s) => (
                    <tr key={s.id} className="border-t border-gray-800">
                      <td className={td}>
                        {s.name} <span className="text-xs text-gray-500">#{s.id}</span>
                      </td>
                      <td className={`${td} font-mono text-xs`}>{s.username ?? <span className="text-gray-500">no account</span>}</td>
                      <td className={`${td} font-mono text-xs`}>
                        {s.password && (
                          <span className="inline-flex items-center gap-2">
                            {shown.has(s.id) ? s.password : '••••••••••••'}
                            <button
                              type="button"
                              className="text-gray-400 hover:text-white"
                              aria-label={shown.has(s.id) ? 'Hide password' : 'Show password'}
                              onClick={() =>
                                setShown((cur) => {
                                  const next = new Set(cur);
                                  if (next.has(s.id)) next.delete(s.id);
                                  else next.add(s.id);
                                  return next;
                                })
                              }
                            >
                              {shown.has(s.id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </span>
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap text-right`}>
                        {s.username ? (
                          <span className="inline-flex gap-1.5">
                            <SmallButton disabled={busy} onClick={() => setConfirm({ kind: 'reset', id: s.id, name: s.name })}>
                              <KeyRound className="h-3.5 w-3.5" /> New password
                            </SmallButton>
                            <SmallButton tone="danger" disabled={busy} onClick={() => setConfirm({ kind: 'close', id: s.id, name: s.name })}>
                              <Trash2 className="h-3.5 w-3.5" /> Close
                            </SmallButton>
                          </span>
                        ) : (
                          <SmallButton
                            tone="good"
                            disabled={busy || !data.running}
                            onClick={() =>
                              void act(async () => {
                                const account = await adminApi.ftpOpen(s.id);
                                return `FTP account ${account.username} opened for ${s.name}.`;
                              })
                            }
                          >
                            <Plus className="h-3.5 w-3.5" /> Open account
                          </SmallButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
      <ConfirmationModal
        isOpen={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const c = confirm;
          setConfirm(null);
          if (!c) return;
          await act(async () => {
            if (c.kind === 'reset') {
              const account = await adminApi.ftpOpen(c.id, true);
              setShown((cur) => new Set(cur).add(c.id));
              return `New password for ${account.username}.`;
            }
            await adminApi.ftpClose(c.id);
            return `FTP account of ${c.name} closed.`;
          });
        }}
        title={confirm?.kind === 'reset' ? 'New FTP password' : 'Close the FTP account'}
        message={
          confirm?.kind === 'reset'
            ? `Make a new FTP password for ${confirm.name}? The old one stops working at once.`
            : `Close the FTP account of ${confirm?.name ?? ''}? The server's files stay.`
        }
        confirmText={confirm?.kind === 'reset' ? 'New password' : 'Close account'}
        icon="danger"
        confirmButtonClass={confirm?.kind === 'close' ? 'bg-red-600 hover:bg-red-700' : undefined}
      />
    </div>
  );
}
