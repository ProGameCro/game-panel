import { useEffect, useMemo, useState } from 'react';
import { DownloadCloud, Image, Trash2, Upload } from 'lucide-react';
import { AppCard } from '../../src/ui/components';
import { apiClient } from '../../utils/api';
import { API_BASE_URL } from '../../utils/api/runtime';
import type { GameServer } from '../../types/gameServer';
import { apiError } from '../../utils/adminApi';
import { GameIcon, gameKeyOf, reloadGameIcons, useGameIcons } from '../gameServersTable/GameIcon';
import { ActionButton } from './shared';

type SteamStatus = { running: boolean; finishedAt: number | null; done: number; total: number; added: string[]; failed: string[] };

// Admin > Panel: your own icon for each game, shown left of the server names (PNG, JPG, WEBP or GIF, max 512 KB)
export function AdminGameIcons({ gameServers, gameNamesByKey }: { gameServers: GameServer[]; gameNamesByKey: Record<string, string> }) {
  const icons = useGameIcons();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [steam, setSteam] = useState<SteamStatus | null>(null);

  // the download from Steam runs on the panel server: follow it while it runs
  useEffect(() => {
    void apiClient.adminRequest<SteamStatus>('get', '/game-icons/steam').then(setSteam).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!steam?.running) return;
    const timer = window.setInterval(() => {
      void apiClient
        .adminRequest<SteamStatus>('get', '/game-icons/steam')
        .then((next) => {
          setSteam(next);
          if (!next.running) void reloadGameIcons();
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [steam?.running]);

  const getFromSteam = () => {
    setResult(null);
    apiClient
      .adminRequest<SteamStatus>('post', '/game-icons/steam')
      .then(setSteam)
      .catch((e) => setResult({ ok: false, text: apiError(e, 'Could not start the download.') }));
  };

  // the games of the servers there are, and games that already have an icon
  const games = useMemo(() => {
    const keys = new Map<string, GameServer | null>();
    for (const s of gameServers) if (gameKeyOf(s)) keys.set(gameKeyOf(s), s);
    for (const key of Object.keys(icons)) if (!keys.has(key)) keys.set(key, null);
    return [...keys.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [gameServers, icons]);

  const upload = (key: string, file: File | undefined) => {
    if (!file) return;
    if (file.size > 512 * 1024) {
      setResult({ ok: false, text: 'The picture can be at most 512 KB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setBusy(key);
      setResult(null);
      apiClient
        .adminRequest('put', `/game-icons/${encodeURIComponent(key)}`, { dataUrl: reader.result })
        .then(() => reloadGameIcons())
        .then(() => setResult({ ok: true, text: `Icon for ${gameNamesByKey[key] ?? key} saved.` }))
        .catch((e) => setResult({ ok: false, text: apiError(e, 'Could not save the icon.') }))
        .finally(() => setBusy(null));
    };
    reader.readAsDataURL(file);
  };

  const remove = (key: string) => {
    setBusy(key);
    setResult(null);
    apiClient
      .adminRequest('delete', `/game-icons/${encodeURIComponent(key)}`)
      .then(() => reloadGameIcons())
      .then(() => setResult({ ok: true, text: `Icon for ${gameNamesByKey[key] ?? key} removed.` }))
      .catch((e) => setResult({ ok: false, text: apiError(e, 'Could not remove the icon.') }))
      .finally(() => setBusy(null));
  };

  return (
    <AppCard className="p-5 lg:col-span-2">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-400">
        <Image className="h-4 w-4" /> Game icons
      </h2>
      <p className="mb-3 text-sm text-gray-400">
        The icon of each game, shown left of the server names. The panel gets the official icons from Steam by itself (once after an update; again
        with the button below) for every game that has none; games that are not on Steam show a coloured badge. Your own icon: Upload (PNG, JPG,
        WEBP or GIF, at most 512 KB, square looks best) — it is never replaced by the Steam download.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ActionButton tone="primary" disabled={steam?.running} onClick={getFromSteam}>
          <DownloadCloud className={steam?.running ? 'animate-pulse' : ''} /> {steam?.running ? 'Getting icons from Steam…' : 'Get icons from Steam'}
        </ActionButton>
        {steam?.running && (
          <span className="text-sm text-gray-300">
            {steam.done} / {steam.total} games
          </span>
        )}
        {steam && !steam.running && steam.finishedAt && (
          <span className="text-sm text-gray-400">
            Last download: {new Date(steam.finishedAt).toLocaleString()} · {steam.added.length} icon(s) added
            {steam.failed.length > 0 ? ` · ${steam.failed.length} not found on Steam` : ''}
          </span>
        )}
      </div>
      {games.length === 0 ? (
        <p className="text-sm text-gray-400">No servers yet.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {games.map(([key, server]) => (
            <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-gray-700 px-3 py-2">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center">
                  {icons[key] ? (
                    <img src={`${API_BASE_URL}${icons[key]}`} alt="" className="h-8 w-8 rounded object-cover" />
                  ) : server ? (
                    <GameIcon server={server} className="h-8 w-8" />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-white">{gameNamesByKey[key] ?? key}</span>
                  <span className="block text-xs text-gray-400">{icons[key] ? 'icon set' : key === 'cod4' ? "the panel's icon" : 'badge (no icon)'}</span>
                </span>
              </span>
              <span className="flex shrink-0 gap-1.5">
                <label
                  className={`inline-flex min-h-[2rem] cursor-pointer items-center gap-2 rounded-lg border border-gray-600 bg-white/5 px-3 py-1.5 text-[0.8125rem] font-semibold text-gray-200 transition-colors hover:border-[var(--color-cyan-400)] hover:bg-[var(--color-cyan-400)]/10 hover:text-[var(--color-cyan-400)] ${busy === key ? 'pointer-events-none opacity-50' : ''}`}
                >
                  <Upload className="h-4 w-4" /> {busy === key ? 'Saving…' : 'Upload'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      upload(key, e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
                {icons[key] && (
                  <button
                    type="button"
                    disabled={busy === key}
                    onClick={() => remove(key)}
                    className="inline-flex min-h-[2rem] items-center rounded-lg border border-red-500/60 bg-red-500/15 px-2.5 py-1.5 text-red-300 transition-colors hover:bg-red-500/25"
                    aria-label="Remove icon"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {result && <p className={`mt-3 text-sm ${result.ok ? 'text-emerald-300' : 'text-red-300'}`}>{result.text}</p>}
    </AppCard>
  );
}
