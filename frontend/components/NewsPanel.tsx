import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  PenLine,
  Plus,
  Trash2,
  X,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Info,
  Pause,
  Play,
  RotateCw,
  Server,
  Settings,
  Shield,
  Sparkles,
} from 'lucide-react';
import { apiClient, type CatalogNewsItem } from '../utils/api';
import { AppBadge, AppButton, AppCard } from '../src/ui/components';

const NEWS_ICON_KEYS = [
  'server',
  'restart',
  'warning',
  'news',
  'update',
  'maintenance',
  'security',
  'event',
  'info',
  'success',
] as const;

type NewsIconKey = (typeof NEWS_ICON_KEYS)[number];
const NEWS_ICON_KEY_SET = new Set<string>(NEWS_ICON_KEYS);

const NEWS_ICON_ALIASES: Record<string, string> = {
  reboot: 'restart',
  alert: 'warning',
  announcement: 'news',
  announce: 'news',
};

const normalizeNewsIconKey = (iconKey: string | null | undefined): NewsIconKey => {
  const raw = String(iconKey ?? '')
    .trim()
    .toLowerCase();
  const normalized = NEWS_ICON_ALIASES[raw] || raw || 'news';
  return NEWS_ICON_KEY_SET.has(normalized) ? (normalized as NewsIconKey) : 'news';
};

const formatNewsDate = (timestamp: number): string => {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed)) return '-';
  return new Date(parsed).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

function renderDescriptionWithLinks(text: string) {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) =>
    URL_REGEX.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--color-cyan-400)] underline-offset-2 hover:underline"
      >
        {part}
      </a>
    ) : (
      part
    )
  );
}

type NewsDraft = { title: string; description: string; iconKey: string; date: string };

const toDateInput = (timestamp: number): string => {
  const d = Number.isFinite(Number(timestamp)) ? new Date(Number(timestamp)) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fromDateInput = (value: string): number => {
  const [y, m, d] = value.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d, 12).getTime() : Date.now();
};

// Editor for the panel's own news (Super Admins). Saves the whole list at once.
export function NewsEditor({ items, onClose, onSaved }: { items: CatalogNewsItem[]; onClose: () => void; onSaved: (news: CatalogNewsItem[]) => void }) {
  const [drafts, setDrafts] = useState<NewsDraft[]>(() =>
    items.map((n) => ({ title: n.title, description: n.description, iconKey: normalizeNewsIconKey(n.iconKey), date: toDateInput(n.date) }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (index: number, patch: Partial<NewsDraft>) =>
    setDrafts((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const move = (index: number, by: number) =>
    setDrafts((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.savePanelNews(
        drafts.map((d) => ({ title: d.title, description: d.description, iconKey: d.iconKey, date: fromDateInput(d.date) }))
      );
      onSaved(res.news);
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not save the news.');
    } finally {
      setSaving(false);
    }
  };
  const field = 'w-full rounded-lg border border-white/10 bg-[#0b1324] px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-cyan-400)]';

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => !saving && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gp-news-editor-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-white/10 bg-[#0f1a2b] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h3 id="gp-news-editor-title" className="text-base font-semibold text-white">News</h3>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="rounded p-1 text-gray-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {drafts.length === 0 && <p className="text-sm text-gray-400">No news yet. The bar is hidden for users while there is none.</p>}
          {drafts.map((d, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-white/10 p-3">
              <div className="flex gap-2">
                <input
                  value={d.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  maxLength={120}
                  placeholder="Title"
                  className={field}
                />
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Up" className="rounded-lg border border-white/10 px-2 text-gray-300 disabled:opacity-30">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === drafts.length - 1} title="Down" className="rounded-lg border border-white/10 px-2 text-gray-300 disabled:opacity-30">
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setDrafts((list) => list.filter((_, j) => j !== i))} title="Delete" className="rounded-lg border border-red-500/40 px-2 text-red-300 hover:text-red-200">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <textarea
                value={d.description}
                onChange={(e) => update(i, { description: e.target.value })}
                maxLength={1000}
                rows={2}
                placeholder="Text (links work)"
                className={field}
              />
              <div className="flex gap-2">
                <select value={d.iconKey} onChange={(e) => update(i, { iconKey: e.target.value })} className={`${field} max-w-[12rem]`}>
                  {NEWS_ICON_KEYS.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
                <input type="date" value={d.date} onChange={(e) => update(i, { date: e.target.value })} className={`${field} max-w-[11rem]`} />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDrafts((list) => [...list, { title: '', description: '', iconKey: 'news', date: toDateInput(Date.now()) }])}
            disabled={drafts.length >= 30}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-white/10 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Add news
          </button>
        </div>
        {error && <p className="px-5 pb-2 text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-3 py-2 text-sm font-medium text-gray-300 hover:bg-white/10">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="gp-app-button--primary rounded-lg bg-[#0050d7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#157eea] disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function NewsPanel() {
  const [newsItems, setNewsItems] = useState<CatalogNewsItem[]>([]);
  const [currentNewsIndex, setCurrentNewsIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);

  // this panel's own news (not OVHcloud's); Super Admins can edit them
  const loadNews = useCallback(async () => {
    try {
      const response = await apiClient.getPanelNews();
      setNewsItems(Array.isArray(response.news) ? response.news : []);
    } catch (error) {
      console.error('Failed to load news:', error);
      setNewsItems([]);
    } finally {
      setCurrentNewsIndex(0);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadNews();
    apiClient
      .getCurrentUser()
      .then((me) => setCanEdit(Boolean(me.user?.isRoot)))
      .catch(() => setCanEdit(false));
  }, [loadNews]);

  useEffect(() => {
    if (newsItems.length <= 1 || isPaused) return;

    const interval = window.setInterval(() => {
      setCurrentNewsIndex((prev) => (prev + 1) % newsItems.length);
    }, 15000);

    return () => window.clearInterval(interval);
  }, [newsItems.length, isPaused]);

  useEffect(() => {
    if (newsItems.length === 0) {
      setCurrentNewsIndex(0);
      return;
    }

    if (currentNewsIndex >= newsItems.length) {
      setCurrentNewsIndex(0);
    }
  }, [currentNewsIndex, newsItems.length]);

  const nextNews = () => {
    if (newsItems.length === 0) return;
    setCurrentNewsIndex((prev) => (prev + 1) % newsItems.length);
  };

  const prevNews = () => {
    if (newsItems.length === 0) return;
    setCurrentNewsIndex((prev) => (prev - 1 + newsItems.length) % newsItems.length);
  };

  const currentNews = newsItems[currentNewsIndex] ?? null;
  const currentNewsIconKey = normalizeNewsIconKey(currentNews?.iconKey);

  const getNewsIcon = (iconType: string) => {
    const normalized = normalizeNewsIconKey(iconType);
    switch (normalized) {
      case 'success':
        return <CheckCircle className="w-5 h-5" />;
      case 'maintenance':
        return <Settings className="w-5 h-5" />;
      case 'restart':
      case 'update':
        return <RotateCw className="w-5 h-5" />;
      case 'server':
        return <Server className="w-5 h-5" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5" />;
      case 'news':
      case 'info':
        return <Info className="w-5 h-5" />;
      case 'security':
        return <Shield className="w-5 h-5" />;
      case 'event':
        return <Sparkles className="w-5 h-5" />;
      default:
        return <Sparkles className="w-5 h-5" />;
    }
  };

  // users see nothing while there is no news; Super Admins see the bar with its edit button
  if (!loaded || (newsItems.length === 0 && !canEdit)) return null;

  const editButton = canEdit ? (
    <AppButton
      onClick={() => setEditing(true)}
      tone="ghost"
      className="h-7 rounded border-none bg-transparent px-2 text-xs text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
      aria-label="Edit news"
      title="Edit news"
    >
      <span className="inline-flex items-center gap-1"><PenLine className="h-3.5 w-3.5" /> Edit</span>
    </AppButton>
  ) : null;

  return (
    <>
    {editing && (
      <NewsEditor
        items={newsItems}
        onClose={() => setEditing(false)}
        onSaved={(news) => {
          setNewsItems(news);
          setCurrentNewsIndex(0);
          setEditing(false);
        }}
      />
    )}
    <AppCard
      className="w-full overflow-hidden rounded-lg border border-gray-800 shadow-[0_4px_20px_rgba(2,6,23,0.5),0_1px_4px_rgba(2,6,23,0.25)]"
      role="region"
      aria-label="News carousel"
      aria-roledescription="carousel"
    >
      <div className="relative flex flex-col sm:flex-row sm:items-center gap-3 p-4 pb-6 sm:pb-4 bg-gradient-to-r from-[var(--gp-ods-accent-secondary)]/10 to-transparent">
        {currentNews ? (
          <>
            <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-[var(--gp-ods-accent-primary)]/20 text-[var(--color-cyan-400)]">
              {getNewsIcon(currentNews.iconKey)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Sparkles className="w-4 h-4 text-[var(--color-cyan-400)]" />
                <h3 className="font-semibold text-white text-sm md:text-base">
                  {currentNews.title}
                </h3>
                <AppBadge
                  tone="07"
                  className="whitespace-nowrap border border-slate-500/30 bg-slate-700/35 px-2 py-0.5 text-xs text-slate-200"
                >
                  {currentNewsIconKey}
                </AppBadge>
              </div>
              <p className="text-xs md:text-sm text-gray-400">{renderDescriptionWithLinks(currentNews.description)}</p>
            </div>

            <div className="flex items-center gap-3 flex-shrink-0 w-full sm:w-auto justify-between sm:justify-start">
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {formatNewsDate(currentNews.date)}
              </span>
              {editButton}
              {newsItems.length > 1 && (
                <div className="flex items-center gap-1">
                  <AppButton
                    onClick={prevNews}
                    tone="ghost"
                    className="h-7 w-7 rounded border-none bg-transparent p-1.5 transition-colors hover:bg-gray-700"
                    aria-label="Previous news"
                  >
                    <ChevronLeft className="w-4 h-4 text-gray-400" />
                  </AppButton>
                  <span className="text-xs text-gray-400 min-w-[2rem] text-center">
                    {currentNewsIndex + 1}/{newsItems.length}
                  </span>
                  <AppButton
                    onClick={nextNews}
                    tone="ghost"
                    className="h-7 w-7 rounded border-none bg-transparent p-1.5 transition-colors hover:bg-gray-700"
                    aria-label="Next news"
                  >
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </AppButton>
                  <AppButton
                    onClick={() => setIsPaused((v) => !v)}
                    tone="ghost"
                    className="h-7 w-7 rounded border-none bg-transparent p-1.5 transition-colors hover:bg-gray-700"
                    aria-label={isPaused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
                    title={isPaused ? 'Resume' : 'Pause'}
                  >
                    {isPaused ? <Play className="w-3.5 h-3.5 text-gray-400" /> : <Pause className="w-3.5 h-3.5 text-gray-400" />}
                  </AppButton>
                </div>
              )}
            </div>

            {newsItems.length > 1 && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5" role="tablist" aria-label="News slides">
                {newsItems.map((item, index) => (
                  <button
                    type="button"
                    key={item.id}
                    role="tab"
                    aria-selected={index === currentNewsIndex}
                    aria-label={`Go to news ${index + 1}: ${item.title}`}
                    onClick={() => setCurrentNewsIndex(index)}
                    className={`h-1.5 rounded-full transition-all border-0 p-0 cursor-pointer ${
                      index === currentNewsIndex ? 'bg-[var(--gp-ods-accent-primary)] w-6' : 'bg-gray-600 w-1.5'
                    }`}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-[var(--gp-ods-accent-primary)]/20 text-[var(--color-cyan-400)]">
              <Info className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-[var(--color-cyan-400)]" />
                <h3 className="font-semibold text-white text-sm md:text-base">No news published</h3>
              </div>
              <p className="text-xs md:text-sm text-gray-400">
                Only you see this. Add news with Edit; users see the bar once there is news.
              </p>
            </div>
            {editButton}
          </>
        )}
      </div>
    </AppCard>
    </>
  );
}


