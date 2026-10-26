import type { ReactNode } from 'react';
import { AppCard } from '../../src/ui/components';

// small building blocks of the Admin page tabs

export type Cod4Choice = { id: string; name: string; status: string };

export function ServerPicker({ servers, value, onChange }: { servers: Cod4Choice[]; value: string; onChange: (id: string) => void }) {
  if (servers.length === 0) return <p className="text-sm text-gray-400">No Call of Duty 4 servers.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {servers.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onChange(s.id)}
          className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
            value === s.id
              ? 'border-[var(--color-cyan-400)] bg-[var(--color-cyan-400)]/15 text-[var(--color-cyan-400)]'
              : 'border-gray-700 text-gray-300 hover:border-[var(--color-cyan-400)]/60 hover:text-white'
          }`}
        >
          <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${s.status === 'running' ? 'bg-emerald-400' : 'bg-red-400'}`} />
          {s.name} <span className="text-xs font-normal text-gray-400">#{s.id}</span>
        </button>
      ))}
    </div>
  );
}

export function Panel({ title, icon, actions, children }: { title: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <AppCard className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-400">
          {icon}
          {title}
        </h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </AppCard>
  );
}

export function Note({ result }: { result: { ok: boolean; text: string } | null }) {
  if (!result) return null;
  return (
    <div className={`rounded-lg border p-3 text-sm whitespace-pre-wrap ${result.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
      {result.text}
    </div>
  );
}

export function SmallButton({
  onClick,
  disabled,
  tone = 'default',
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger' | 'good';
  title?: string;
  children: ReactNode;
}) {
  const colors =
    tone === 'danger'
      ? 'border-red-500/40 text-red-300 hover:border-red-400 hover:bg-red-500/10'
      : tone === 'good'
        ? 'border-emerald-500/40 text-emerald-300 hover:border-emerald-400 hover:bg-emerald-500/10'
        : 'border-gray-600 text-gray-200 hover:border-[var(--color-cyan-400)] hover:text-[var(--color-cyan-400)]';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${colors}`}
    >
      {children}
    </button>
  );
}

export const inputCls =
  'rounded-lg border border-gray-600 bg-[#0b1324] px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-cyan-400)]';
export const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400';
export const td = 'px-3 py-2 text-sm text-gray-200';

export const formatBytes = (bytes: number | null | undefined): string => {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '–';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};
