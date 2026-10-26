import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, MessageSquare, RefreshCw, Send, Terminal, UserX, Users } from 'lucide-react';
import { adminApi, apiError, type LiveStatus, type LivePlayer } from '../../utils/adminApi';
import { createPortal } from 'react-dom';
import { Note, Panel, SmallButton, inputCls, td, th } from './shared';

// Live tab: one CoD4 server's players (kick / ban), a message to everybody and an RCON console.
type Pending = { player: LivePlayer; action: 'kick' | 'tempban' | 'ban' } | null;

const QUICK = ['status', 'serverinfo', 'map_restart', 'fast_restart', 'map_rotate', 'dumpuser', 'say'];

export function AdminLive({ serverId }: { serverId: string }) {
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [message, setMessage] = useState('');
  const [command, setCommand] = useState('');
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const consoleRef = useRef<HTMLPreElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLive(await adminApi.live(serverId));
    } catch (e) {
      setResult({ ok: false, text: apiError(e, 'Could not read the server.') });
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    setLive(null);
    setConsoleLines([]);
    setResult(null);
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [consoleLines]);

  const runCommand = async (text: string) => {
    const cmd = text.trim();
    if (!cmd) return;
    setConsoleLines((lines) => [...lines, `> ${cmd}`]);
    setCommand('');
    try {
      const res = await adminApi.rcon(serverId, cmd);
      setConsoleLines((lines) => [...lines, res.output.trimEnd() || '(no answer)']);
    } catch (e) {
      setConsoleLines((lines) => [...lines, `! ${apiError(e, 'RCON failed')}`]);
    }
  };

  const doPlayerAction = async () => {
    if (!pending) return;
    const { player, action } = pending;
    const res = await adminApi.player(serverId, player.slot, action, reason, action === 'tempban' ? Number(minutes) : undefined);
    setResult({ ok: true, text: `${action === 'kick' ? 'Kicked' : 'Banned'} ${player.name}. ${res.output.trim()}` });
    setReason('');
    window.setTimeout(() => void load(), 1500);
  };

  const sendMessage = async () => {
    if (!message.trim()) return;
    try {
      await adminApi.say(serverId, message);
      setResult({ ok: true, text: `Sent: ${message}` });
      setMessage('');
    } catch (e) {
      setResult({ ok: false, text: apiError(e, 'Could not send the message.') });
    }
  };

  return (
    <div className="space-y-4">
      <Note result={result} />
      <Panel
        title={live ? `${live.hostname ?? 'Players'} · ${live.map ?? '?'} · ${live.gametype ?? ''}` : 'Players'}
        icon={<Users className="h-4 w-4" />}
        actions={
          <SmallButton onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </SmallButton>
        }
      >
        {!live ? (
          <p className="text-sm text-gray-400">{loading ? 'Loading…' : '–'}</p>
        ) : !live.online ? (
          <p className="text-sm text-red-300">The server does not answer (is it running?).</p>
        ) : (
          <>
            {!live.rcon && (
              <p className="mb-2 text-xs text-amber-300">
                Without RCON only names are shown, no kick or ban: {live.rconError}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className={th}>#</th>
                    <th className={th}>Name</th>
                    <th className={th}>Score</th>
                    <th className={th}>Ping</th>
                    <th className={th}>GUID</th>
                    <th className={th}>IP</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {live.players.length === 0 && (
                    <tr>
                      <td className={td} colSpan={7}>
                        No players ({live.maxPlayers ?? '?'} slots).
                      </td>
                    </tr>
                  )}
                  {live.players.map((p) => (
                    <tr key={`${p.slot}-${p.guid}`} className="border-b border-gray-800 last:border-0">
                      <td className={td}>{p.slot}</td>
                      <td className={`${td} font-semibold text-white`}>{p.name}</td>
                      <td className={td}>{p.score}</td>
                      <td className={td}>{p.ping}</td>
                      <td className={`${td} font-mono text-xs`}>{p.guid || '–'}</td>
                      <td className={`${td} font-mono text-xs`}>{p.ip ?? '–'}</td>
                      <td className={`${td} text-right`}>
                        {live.rcon && (
                          <span className="inline-flex gap-1.5">
                            <SmallButton onClick={() => setPending({ player: p, action: 'kick' })}>
                              <UserX className="h-3.5 w-3.5" /> Kick
                            </SmallButton>
                            <SmallButton onClick={() => setPending({ player: p, action: 'tempban' })}>
                              <Ban className="h-3.5 w-3.5" /> Temp ban
                            </SmallButton>
                            <SmallButton tone="danger" onClick={() => setPending({ player: p, action: 'ban' })}>
                              <Ban className="h-3.5 w-3.5" /> Ban
                            </SmallButton>
                          </span>
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

      <Panel title="Message to everybody" icon={<MessageSquare className="h-4 w-4" />}>
        <div className="flex flex-wrap gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void sendMessage()}
            maxLength={150}
            placeholder="Shown in the game chat (colours like ^1red work)"
            className={`${inputCls} min-w-0 flex-1`}
          />
          <SmallButton onClick={() => void sendMessage()} disabled={!message.trim()}>
            <Send className="h-3.5 w-3.5" /> Send
          </SmallButton>
        </div>
      </Panel>

      <Panel title="RCON console" icon={<Terminal className="h-4 w-4" />}>
        <pre ref={consoleRef} className="mb-2 h-64 overflow-y-auto rounded-lg border border-gray-700 bg-black/40 p-3 font-mono text-xs text-gray-200">
          {consoleLines.length === 0 ? 'Commands go straight to the server (rcon). Try: status' : consoleLines.join('\n')}
        </pre>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <SmallButton key={q} onClick={() => (q === 'say' ? setCommand('say ') : void runCommand(q))}>
              {q}
            </SmallButton>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void runCommand(command)}
            placeholder="rcon command, e.g. map mp_crash"
            className={`${inputCls} min-w-0 flex-1 font-mono`}
          />
          <SmallButton onClick={() => void runCommand(command)} disabled={!command.trim()}>
            <Send className="h-3.5 w-3.5" /> Run
          </SmallButton>
        </div>
      </Panel>

      {pending && (
        <PlayerActionDialog
          pending={pending}
          reason={reason}
          setReason={setReason}
          minutes={minutes}
          setMinutes={setMinutes}
          onClose={() => setPending(null)}
          onConfirm={doPlayerAction}
        />
      )}
    </div>
  );
}

const BAN_TIMES: Array<[string, string]> = [
  ['10', '10 minutes'],
  ['60', '1 hour'],
  ['360', '6 hours'],
  ['1440', '1 day'],
  ['10080', '1 week'],
  ['43200', '30 days'],
];

function PlayerActionDialog({
  pending,
  reason,
  setReason,
  minutes,
  setMinutes,
  onClose,
  onConfirm,
}: {
  pending: NonNullable<Pending>;
  reason: string;
  setReason: (v: string) => void;
  minutes: string;
  setMinutes: (v: string) => void;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = pending.action === 'kick' ? 'Kick' : pending.action === 'tempban' ? 'Temporary ban' : 'Permanent ban';
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(apiError(e, 'Could not do that.'));
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-xl border border-white/10 bg-[#0f1a2b] p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-white">
          {title}: {pending.player.name}
        </h3>
        <p className="mt-1 text-xs text-gray-400">
          Slot {pending.player.slot}
          {pending.player.guid ? ` · GUID ${pending.player.guid}` : ''}
        </p>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void confirm()}
          maxLength={100}
          placeholder="Reason (shown to the player)"
          className={`${inputCls} mt-4 w-full`}
        />
        {pending.action === 'tempban' && (
          <select value={minutes} onChange={(e) => setMinutes(e.target.value)} className={`${inputCls} mt-2 w-full`}>
            {BAN_TIMES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        )}
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-medium text-gray-300 hover:bg-white/10">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? '…' : pending.action === 'kick' ? 'Kick' : 'Ban'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
