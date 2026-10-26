import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, FolderOpen, Package, RefreshCw, Trash2, Upload } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { adminApi, apiError, type ContentItem } from '../../utils/adminApi';
import { ConfirmationModal } from '../ConfirmationModal';
import { Note, Panel, SmallButton, formatBytes, inputCls, td, th, type Cod4Choice } from './shared';

// Content tab: a server's mods and custom maps on disk: upload a .zip, copy a folder to another CoD4 server
// (big files as hard links), delete. FastDL picks the changes up by itself.
type Section = 'mods' | 'usermaps';

const LABEL: Record<Section, string> = { mods: 'Mods', usermaps: 'Custom maps' };

export function AdminContent({ serverId, servers }: { serverId: string; servers: Cod4Choice[] }) {
  const [content, setContent] = useState<Record<Section, ContentItem[]> | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<{ section: Section; name: string } | null>(null);
  const [copyTarget, setCopyTarget] = useState<Record<string, string>>({});
  const fileInputs = useRef<Record<Section, HTMLInputElement | null>>({ mods: null, usermaps: null });

  const load = useCallback(async () => {
    try {
      setContent(await adminApi.content(serverId));
    } catch (e) {
      setResult({ ok: false, text: apiError(e, 'Could not read the mods and maps.') });
    }
  }, [serverId]);

  useEffect(() => {
    setContent(null);
    setResult(null);
    void load();
  }, [load]);

  const others = servers.filter((s) => s.id !== serverId);

  // upload a .zip into serverfiles/<section>/ and unpack it there (the zip holds the mod / map folder)
  const upload = async (section: Section, file: File) => {
    const id = Number(serverId);
    const dir = `serverfiles/${section}`;
    setBusy(true);
    setResult(null);
    setProgress(0);
    try {
      await apiClient.uploadServerFile(id, dir, file.name, file, (p) => setProgress(p));
      if (/\.(zip|rar|7z|tar|tar\.gz|tgz)$/i.test(file.name)) {
        let job = await apiClient.extractServerArchive(id, `${dir}/${file.name}`);
        while (job.status === 'pending' || job.status === 'running') {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          job = await apiClient.getFileTransfer(id, job.id);
        }
        if (job.status === 'failed') throw new Error(job.errorMessage ?? 'Unpacking failed');
        await apiClient.deleteServerPaths(id, [`${dir}/${file.name}`]).catch(() => undefined);
        setResult({ ok: true, text: `${file.name} uploaded and unpacked into ${section}/.` });
      } else {
        setResult({ ok: true, text: `${file.name} uploaded into ${section}/.` });
      }
      await load();
    } catch (e) {
      setResult({ ok: false, text: apiError(e, 'Upload failed.') });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const copy = async (section: Section, name: string) => {
    const target = copyTarget[`${section}/${name}`] ?? others[0]?.id;
    if (!target) return;
    setBusy(true);
    setResult(null);
    try {
      await adminApi.copyContent(serverId, section, name, target);
      setResult({ ok: true, text: `${section}/${name} copied to ${servers.find((s) => s.id === target)?.name ?? target}.` });
    } catch (e) {
      setResult({ ok: false, text: apiError(e, 'Copy failed.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Note result={result} />
      {progress !== null && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700">
          <div className="h-full bg-[var(--color-cyan-400)] transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}
      {(['mods', 'usermaps'] as Section[]).map((section) => (
        <Panel
          key={section}
          title={LABEL[section]}
          icon={section === 'mods' ? <Package className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />}
          actions={
            <>
              <input
                ref={(el) => {
                  fileInputs.current[section] = el;
                }}
                type="file"
                accept=".zip,.rar,.7z,.tar,.gz,.tgz,.iwd,.ff"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void upload(section, file);
                }}
              />
              <SmallButton onClick={() => fileInputs.current[section]?.click()} disabled={busy}>
                <Upload className="h-3.5 w-3.5" /> Upload .zip
              </SmallButton>
              <SmallButton onClick={() => void load()} disabled={busy}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </SmallButton>
            </>
          }
        >
          {!content ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : content[section].length === 0 ? (
            <p className="text-sm text-gray-400">
              None yet. Upload a .zip that holds the {section === 'mods' ? 'mod folder (with mod.ff and the .iwd files)' : 'map folder (mp_name with its .ff files)'}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className={th}>Folder</th>
                    <th className={th}>Size</th>
                    <th className={th}>Files</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {content[section].map((item) => (
                    <tr key={item.name} className="border-b border-gray-800 last:border-0">
                      <td className={`${td} font-semibold text-white`}>{item.name}</td>
                      <td className={td}>{formatBytes(item.size)}</td>
                      <td className={td}>{item.files}</td>
                      <td className={`${td} text-right`}>
                        <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          {others.length > 0 && (
                            <>
                              <select
                                value={copyTarget[`${section}/${item.name}`] ?? others[0].id}
                                onChange={(e) => setCopyTarget((t) => ({ ...t, [`${section}/${item.name}`]: e.target.value }))}
                                className={`${inputCls} py-1 text-xs`}
                              >
                                {others.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name} #{s.id}
                                  </option>
                                ))}
                              </select>
                              <SmallButton onClick={() => void copy(section, item.name)} disabled={busy} title="Copy to that server">
                                <Copy className="h-3.5 w-3.5" /> Copy
                              </SmallButton>
                            </>
                          )}
                          <SmallButton tone="danger" onClick={() => setToDelete({ section, name: item.name })} disabled={busy}>
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </SmallButton>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ))}
      <ConfirmationModal
        isOpen={toDelete !== null}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await adminApi.deleteContent(serverId, toDelete.section, toDelete.name);
          setResult({ ok: true, text: `${toDelete.section}/${toDelete.name} deleted.` });
          await load();
        }}
        title="Delete folder"
        message={toDelete ? `Delete ${toDelete.section}/${toDelete.name} on this server? Other servers keep their copy.` : ''}
        confirmText="Delete"
        confirmButtonClass="bg-red-600 hover:bg-red-700"
        requiredText={toDelete?.name}
      />
    </div>
  );
}
