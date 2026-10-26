import { useEffect, useState } from 'react';
import { adminApi } from '../../utils/adminApi';

// Super Admins: who each server belongs to (its users), shown in the Game Servers list. One request shared by the
// table and every card, refreshed now and then (a new owner appears without reloading the page).
type Owners = Record<number, string[]>;
let cache: { at: number; owners: Owners } | null = null;
let pending: Promise<Owners> | null = null;
const listeners = new Set<(owners: Owners) => void>();

function load(): Promise<Owners> {
  if (cache && Date.now() - cache.at < 20_000) return Promise.resolve(cache.owners);
  pending ??= adminApi
    .owners()
    .then((res) => {
      cache = { at: Date.now(), owners: res.owners };
      listeners.forEach((fn) => fn(res.owners));
      return res.owners;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function useServerOwners(enabled: boolean): Owners | null {
  const [owners, setOwners] = useState<Owners | null>(enabled ? (cache?.owners ?? null) : null);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setOwners);
    void load().catch(() => undefined);
    const timer = window.setInterval(() => void load().catch(() => undefined), 30_000);
    return () => {
      listeners.delete(setOwners);
      window.clearInterval(timer);
    };
  }, [enabled]);
  return enabled ? owners : null;
}

export const ownerText = (owners: Owners | null, serverId: number | string): string => {
  const names = owners?.[Number(serverId)];
  return names && names.length > 0 ? names.join(', ') : '–';
};
