import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { adminApi, apiError, type ActivityEntry } from '../../utils/adminApi';
import { Note, Panel, SmallButton, inputCls, td, th } from './shared';

// Activity tab: who changed what through the panel (newest first).
function describe(entry: ActivityEntry): string {
  if (entry.detail) return entry.detail;
  const p = entry.path.replace(/^\/api/, '');
  const server = /^\/servers\/(\d+)\/(start|stop|restart)$/.exec(p);
  if (server) return `${server[2]} server ${server[1]}`;
  if (/^\/servers\/install/.test(p)) return 'installed a server';
  if (entry.method === 'DELETE' && /^\/servers\/\d+$/.test(p)) return `deleted server ${p.split('/')[2]}`;
  if (/\/files\//.test(p)) return `files: ${p.split('/files/')[1]}`;
  return `${entry.method} ${p}`;
}

export function AdminActivity() {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries((await adminApi.activity(500)).entries);
      setError(null);
    } catch (e) {
      setError(apiError(e, 'Could not read the activity log.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (entries ?? []).filter((e) => !f || `${e.user ?? ''} ${describe(e)} ${e.path}`.toLowerCase().includes(f));
  }, [entries, filter]);

  return (
    <div className="space-y-4">
      {error && <Note result={{ ok: false, text: error }} />}
      <Panel
        title="Activity"
        icon={<History className="h-4 w-4" />}
        actions={
          <>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter (user, server, action)" className={`${inputCls} py-1 text-xs`} />
            <SmallButton onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </SmallButton>
          </>
        }
      >
        {!entries ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing yet. Every change made through the panel shows up here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className={th}>Time</th>
                  <th className={th}>User</th>
                  <th className={th}>What</th>
                  <th className={th}>Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={`${e.time}-${i}`} className="border-b border-gray-800 last:border-0">
                    <td className={`${td} whitespace-nowrap text-xs`}>{new Date(e.time).toLocaleString()}</td>
                    <td className={`${td} font-semibold text-white`}>{e.user ?? '–'}</td>
                    <td className={td}>{describe(e)}</td>
                    <td className={td}>
                      <span className={e.status < 400 ? 'text-emerald-300' : 'text-red-300'}>{e.status < 400 ? 'ok' : `error ${e.status}`}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
