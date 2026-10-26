import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ListOrdered, Map as MapIcon, Plus, Save, SkipForward, Trash2 } from 'lucide-react';
import { adminApi, apiError, type MapsInfo } from '../../utils/adminApi';
import { Note, Panel, SmallButton, inputCls } from './shared';

// Maps tab: change the map now, and the map rotation (sv_mapRotation in main/cod4server.cfg) as an editable list.
type Entry = { gametype: string; map: string };

// "gametype war map mp_crash map mp_strike gametype sd map mp_vacant" -> entries
function parseRotation(text: string): Entry[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const entries: Entry[] = [];
  let gametype = '';
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] === 'gametype') gametype = words[++i];
    else if (words[i] === 'map') entries.push({ gametype, map: words[++i] });
  }
  return entries;
}

export function AdminMaps({ serverId }: { serverId: string }) {
  const [info, setInfo] = useState<MapsInfo | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [nowMap, setNowMap] = useState('');
  const [nowType, setNowType] = useState('');
  const [addMap, setAddMap] = useState('');
  const [addType, setAddType] = useState('war');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await adminApi.maps(serverId);
      setInfo(data);
      setEntries(parseRotation(data.rotation));
      setNowMap(data.usermaps[0] ?? data.stock[0] ?? '');
      setAddMap(data.usermaps[0] ?? data.stock[0] ?? '');
    } catch (e) {
      setResult({ ok: false, text: apiError(e, 'Could not read the maps.') });
    }
  }, [serverId]);

  useEffect(() => {
    setInfo(null);
    setResult(null);
    void load();
  }, [load]);

  const allMaps = useMemo(() => (info ? [...info.usermaps.map((m) => ({ m, custom: true })), ...info.stock.map((m) => ({ m, custom: false }))] : []), [info]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setResult(null);
    try {
      await fn();
      setResult({ ok: true, text: ok });
    } catch (e) {
      setResult({ ok: false, text: apiError(e, 'That did not work.') });
    } finally {
      setBusy(false);
    }
  };

  const move = (i: number, by: number) =>
    setEntries((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item);
      return next;
    });

  const mapOptions = allMaps.map(({ m, custom }) => (
    <option key={m} value={m}>
      {m}
      {custom ? ' (custom)' : ''}
    </option>
  ));

  return (
    <div className="space-y-4">
      <Note result={result} />
      <Panel title="Change the map now" icon={<MapIcon className="h-4 w-4" />}>
        {!info ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select value={nowMap} onChange={(e) => setNowMap(e.target.value)} className={inputCls}>
              {mapOptions}
            </select>
            <select value={nowType} onChange={(e) => setNowType(e.target.value)} className={inputCls}>
              <option value="">same game type</option>
              {info.gametypes.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <SmallButton disabled={busy || !nowMap} onClick={() => void act(() => adminApi.changeMap(serverId, nowMap, nowType || undefined), `Loading ${nowMap}…`)}>
              <MapIcon className="h-3.5 w-3.5" /> Load map
            </SmallButton>
            <SmallButton disabled={busy} onClick={() => void act(() => adminApi.nextMap(serverId), 'Next map of the rotation…')}>
              <SkipForward className="h-3.5 w-3.5" /> Next in rotation
            </SmallButton>
          </div>
        )}
      </Panel>

      <Panel
        title="Map rotation"
        icon={<ListOrdered className="h-4 w-4" />}
        actions={
          <SmallButton
            tone="good"
            disabled={busy || entries.length === 0}
            onClick={() =>
              void act(async () => {
                await adminApi.saveRotation(serverId, entries);
                await load();
              }, 'Rotation saved to main/cod4server.cfg (the running server uses it from the next map).')
            }
          >
            <Save className="h-3.5 w-3.5" /> Save rotation
          </SmallButton>
        }
      >
        {!info ? null : (
          <>
            <ol className="mb-3 space-y-1.5">
              {entries.length === 0 && <li className="text-sm text-gray-400">No rotation yet: add maps below.</li>}
              {entries.map((e, i) => (
                <li key={`${i}-${e.map}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5">
                  <span className="w-6 text-xs text-gray-400">{i + 1}.</span>
                  <select value={e.map} onChange={(ev) => setEntries((l) => l.map((x, j) => (j === i ? { ...x, map: ev.target.value } : x)))} className={`${inputCls} py-1`}>
                    {allMaps.some((x) => x.m === e.map) ? null : <option value={e.map}>{e.map}</option>}
                    {mapOptions}
                  </select>
                  <select
                    value={e.gametype}
                    onChange={(ev) => setEntries((l) => l.map((x, j) => (j === i ? { ...x, gametype: ev.target.value } : x)))}
                    className={`${inputCls} py-1`}
                  >
                    <option value="">(as before)</option>
                    {info.gametypes.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <span className="ml-auto inline-flex gap-1">
                    <SmallButton onClick={() => move(i, -1)} disabled={i === 0} title="Up">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </SmallButton>
                    <SmallButton onClick={() => move(i, 1)} disabled={i === entries.length - 1} title="Down">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </SmallButton>
                    <SmallButton tone="danger" onClick={() => setEntries((l) => l.filter((_, j) => j !== i))} title="Remove">
                      <Trash2 className="h-3.5 w-3.5" />
                    </SmallButton>
                  </span>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <select value={addMap} onChange={(e) => setAddMap(e.target.value)} className={inputCls}>
                {mapOptions}
              </select>
              <select value={addType} onChange={(e) => setAddType(e.target.value)} className={inputCls}>
                {info.gametypes.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <SmallButton onClick={() => addMap && setEntries((l) => [...l, { map: addMap, gametype: addType }])} disabled={!addMap}>
                <Plus className="h-3.5 w-3.5" /> Add
              </SmallButton>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Custom maps are the folders in <code>usermaps</code>. Game types: war = TDM, dm = FFA, sd = S&amp;D, dom = Domination, koth = HQ, sab = Sabotage.
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
