import { useCallback, useEffect, useState } from 'react';
import { Activity, Check, Copy, Download, Eye, EyeOff, HardDriveUpload, KeyRound, Plug, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { adminApi, apiError, type FtpConnection, type FtpEvent, type FtpOverview } from '../../utils/adminApi';
import { ConfirmationModal } from '../ConfirmationModal';
import { Note, Panel, SmallButton, formatBytes, inputCls, td, th } from './shared';

// FTP tab (gp-ftp.sh): how to connect, every server's account (open, new password, close), who is connected now
// (disconnect) and what the accounts did: uploads, downloads, deletes, renames, new folders.

function Copyable({ value, secret }: { value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span>{shown ? value : '••••••••••••'}</span>
      {secret && (
        <button type="button" className="text-gray-400 hover:text-white" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide' : 'Show'}>
          {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
      <button
        type="button"
        className="text-gray-400 hover:text-white"
        aria-label="Copy"
        onClick={() =>
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}

const ACTION_LABEL: Record<string, { text: string; cls: string }> = {
  upload: { text: 'Upload', cls: 'text-emerald-300' },
  download: { text: 'Download', cls: 'text-sky-300' },
  delete: { text: 'Delete', cls: 'text-red-300' },
  rename: { text: 'Rename', cls: 'text-amber-300' },
  mkdir: { text: 'New folder', cls: 'text-gray-300' },
  rmdir: { text: 'Folder deleted', cls: 'text-red-300' },
};

const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

export function AdminFtp() {
  const [data, setData] = useState<FtpOverview | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'reset' | 'close'; id: number; name: string } | { kind: 'kick'; conn: FtpConnection } | null>(null);
  const [connections, setConnections] = useState<FtpConnection[] | null>(null);
  const [events, setEvents] = useState<FtpEvent[] | null>(null);
  const [filterServer, setFilterServer] = useState('');
  const [uploadsOnly, setUploadsOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await adminApi.ftp());
    } catch (e) {
      setResult({ ok: false, text: apiError(e, 'Could not read the FTP accounts.') });
    }
  }, []);

  const loadConnections = useCallback(async () => {
    try {
      setConnections((await adminApi.ftpConnections()).connections);
    } catch {
      setConnections(null);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      setEvents((await adminApi.ftpEvents(filterServer ? Number(filterServer) : undefined, uploadsOnly)).events);
    } catch {
      setEvents([]);
    }
  }, [filterServer, uploadsOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data?.installed) return;
    void loadConnections();
    void loadEvents();
    // live view: who is connected and what they do
    const timer = window.setInterval(() => {
      void loadConnections();
      void loadEvents();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [data?.installed, loadConnections, loadEvents]);

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

  const serverName = (id: number | null) => (id === null ? '–' : (data?.servers.find((s) => s.id === id)?.name ?? `#${id}`));

  const download = (e: FtpEvent) => {
    if (e.serverId === null) return;
    void apiClient
      .getServerDownloadUrl(e.serverId, `serverfiles${e.path}`)
      .then((url) => window.open(url, '_blank'))
      .catch((err) => setResult({ ok: false, text: apiError(err, 'The file is not there any more.') }));
  };

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  if (!data.installed) {
    return (
      <Panel title="FTP / SFTP" icon={<HardDriveUpload className="h-4 w-4" />}>
        <p className="text-sm text-amber-300">
          FTP is not installed. On the panel server: <code>bash gp-ftp.sh</code> (FTP and FTPS on port 21, SFTP on port 2022).
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Note result={result} />

      <Panel title="How to connect" icon={<HardDriveUpload className="h-4 w-4" />}>
        <p className="mb-3 text-sm">
          {data.running ? <span className="text-emerald-300">Running</span> : <span className="text-red-300">Not running: bash gp-ftp.sh</span>}
          <span className="text-gray-400"> · one account per server; it sees the server's serverfiles folder.</span>
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr>
                <th className={th}>Protocol</th>
                <th className={th}>Host</th>
                <th className={th}>Port</th>
                <th className={th}>FileZilla</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-800">
                <td className={td}>FTPS (FTP over TLS)</td>
                <td className={td}>{data.host && <Copyable value={data.host} />}</td>
                <td className={td}>{data.ftpPort !== null && <Copyable value={String(data.ftpPort)} />}</td>
                <td className={`${td} text-xs text-gray-400`}>Protocol FTP, Encryption "Require explicit FTP over TLS"</td>
              </tr>
              <tr className="border-t border-gray-800">
                <td className={td}>SFTP</td>
                <td className={td}>{data.host && <Copyable value={data.host} />}</td>
                <td className={td}>{data.sftpPort !== null && <Copyable value={String(data.sftpPort)} />}</td>
                <td className={`${td} text-xs text-gray-400`}>Protocol SFTP</td>
              </tr>
              <tr className="border-t border-gray-800">
                <td className={td}>FTP (unencrypted)</td>
                <td className={td}>{data.host && <Copyable value={data.host} />}</td>
                <td className={td}>{data.ftpPort !== null && <Copyable value={String(data.ftpPort)} />}</td>
                <td className={`${td} text-xs text-gray-400`}>Encryption "Only use plain FTP": the password is sent readable</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Accounts" icon={<KeyRound className="h-4 w-4" />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr>
                <th className={th}>Server</th>
                <th className={th}>Username</th>
                <th className={th}>Password</th>
                <th className={th}>Online</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {data.servers.map((s) => {
                const online = (connections ?? []).filter((c) => c.serverId === s.id).length;
                return (
                  <tr key={s.id} className="border-t border-gray-800">
                    <td className={td}>
                      {s.name} <span className="text-xs text-gray-500">#{s.id}</span>
                    </td>
                    <td className={td}>{s.username ? <Copyable value={s.username} /> : <span className="font-mono text-xs text-gray-500">no account</span>}</td>
                    <td className={td}>{s.password && <Copyable value={s.password} secret />}</td>
                    <td className={td}>{online > 0 ? <span className="text-emerald-300">{online} connected</span> : <span className="text-gray-500">–</span>}</td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title={`Connected now${connections ? ` · ${connections.length}` : ''}`}
        icon={<Plug className="h-4 w-4" />}
        actions={
          <SmallButton onClick={() => void loadConnections()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </SmallButton>
        }
      >
        {connections === null ? (
          <p className="text-sm text-gray-400">{data.running ? 'Loading…' : 'The FTP service is not running.'}</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-gray-400">Nobody is connected.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr>
                  <th className={th}>Server</th>
                  <th className={th}>Protocol</th>
                  <th className={th}>Address</th>
                  <th className={th}>Connected</th>
                  <th className={th}>Doing</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => (
                  <tr key={c.id} className="border-t border-gray-800">
                    <td className={td}>
                      {serverName(c.serverId)} <span className="font-mono text-xs text-gray-500">{c.username}</span>
                    </td>
                    <td className={td}>{c.protocol}</td>
                    <td className={`${td} font-mono text-xs`}>{c.address}</td>
                    <td className={td}>{ago(c.since)}</td>
                    <td className={`${td} text-xs`}>
                      {c.transfers.length > 0
                        ? c.transfers.map((t) => (
                            <div key={`${t.path}-${t.since}`}>
                              <span className={ACTION_LABEL[t.type]?.cls ?? ''}>{ACTION_LABEL[t.type]?.text ?? t.type}</span>{' '}
                              <span className="font-mono">{t.path}</span> <span className="text-gray-400">({formatBytes(t.size)})</span>
                            </div>
                          ))
                        : <span className="text-gray-400">{c.command || 'idle'} · last activity {ago(c.lastActivity)} ago</span>}
                    </td>
                    <td className={`${td} text-right`}>
                      <SmallButton tone="danger" onClick={() => setConfirm({ kind: 'kick', conn: c })}>
                        <Unplug className="h-3.5 w-3.5" /> Disconnect
                      </SmallButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Activity"
        icon={<Activity className="h-4 w-4" />}
        actions={
          <>
            <select className={inputCls} value={filterServer} onChange={(e) => setFilterServer(e.target.value)}>
              <option value="">All servers</option>
              {data.servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} #{s.id}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-gray-300">
              <input type="checkbox" checked={uploadsOnly} onChange={(e) => setUploadsOnly(e.target.checked)} /> Uploads only
            </label>
            <SmallButton onClick={() => void loadEvents()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </SmallButton>
          </>
        }
      >
        {events === null ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing yet. Every upload, download, delete, rename and new folder over FTP / SFTP shows up here.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[860px]">
              <thead className="sticky top-0 bg-[#0b1324]">
                <tr>
                  <th className={th}>Time</th>
                  <th className={th}>Server</th>
                  <th className={th}>What</th>
                  <th className={th}>File</th>
                  <th className={th}>Size</th>
                  <th className={th}>Protocol</th>
                  <th className={th}>Address</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={`${e.time}-${i}`} className="border-t border-gray-800">
                    <td className={`${td} whitespace-nowrap text-xs`}>{new Date(e.time).toLocaleString()}</td>
                    <td className={td}>{serverName(e.serverId)}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      <span className={ACTION_LABEL[e.action]?.cls ?? ''}>{ACTION_LABEL[e.action]?.text ?? e.action}</span>
                      {!e.ok && <span className="ml-1 text-xs text-red-300">(failed)</span>}
                    </td>
                    <td className={`${td} break-all font-mono text-xs`}>
                      {e.path}
                      {e.target && <span className="text-gray-400"> → {e.target}</span>}
                    </td>
                    <td className={td}>{e.size !== undefined ? formatBytes(e.size) : '–'}</td>
                    <td className={td}>{e.protocol}</td>
                    <td className={`${td} font-mono text-xs`}>{e.ip}</td>
                    <td className={`${td} text-right`}>
                      {e.action === 'upload' && e.ok && e.serverId !== null && (
                        <SmallButton title="Download this file" onClick={() => download(e)}>
                          <Download className="h-3.5 w-3.5" />
                        </SmallButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            if (c.kind === 'kick') {
              await adminApi.ftpKick(c.conn.id);
              await loadConnections();
              return `${c.conn.username} (${c.conn.address}) disconnected. To keep them out, give the account a new password.`;
            }
            if (c.kind === 'reset') {
              const account = await adminApi.ftpOpen(c.id, true);
              return `New password for ${account.username}.`;
            }
            await adminApi.ftpClose(c.id);
            return `FTP account of ${c.name} closed.`;
          });
        }}
        title={confirm?.kind === 'kick' ? 'Disconnect' : confirm?.kind === 'reset' ? 'New FTP password' : 'Close the FTP account'}
        message={
          confirm?.kind === 'kick'
            ? `Disconnect ${confirm.conn.username} (${confirm.conn.address})? A running transfer stops. They can connect again unless the account gets a new password.`
            : confirm?.kind === 'reset'
              ? `Make a new FTP password for ${confirm.name}? The old one stops working at once.`
              : `Close the FTP account of ${confirm?.kind === 'close' ? confirm.name : ''}? The server's files stay.`
        }
        confirmText={confirm?.kind === 'kick' ? 'Disconnect' : confirm?.kind === 'reset' ? 'New password' : 'Close account'}
        icon="danger"
        confirmButtonClass={confirm?.kind === 'reset' ? undefined : 'bg-red-600 hover:bg-red-700'}
      />
    </div>
  );
}
