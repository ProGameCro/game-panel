import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Loader2, Trash2, X, XCircle } from 'lucide-react';

// A small window for slow server actions (deleting a server: stopping it and removing its files can take a while),
// so the user sees that something happens and how it ended. Opened from anywhere with showServerTask().
type Task = { title: string; text: string; state: 'working' | 'done' | 'error' };

let current: Task | null = null;
const listeners = new Set<(task: Task | null) => void>();
const emit = () => listeners.forEach((fn) => fn(current));

export function showServerTask(title: string, text: string): void {
  current = { title, text, state: 'working' };
  emit();
}

export function finishServerTask(ok: boolean, text: string): void {
  if (!current) return;
  current = { ...current, state: ok ? 'done' : 'error', text };
  emit();
}

export function ServerTaskPopup() {
  const [task, setTask] = useState<Task | null>(current);
  useEffect(() => {
    listeners.add(setTask);
    return () => {
      listeners.delete(setTask);
    };
  }, []);
  // a finished task closes by itself after a moment
  useEffect(() => {
    if (task?.state !== 'done') return;
    const timer = window.setTimeout(() => {
      current = null;
      emit();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [task]);

  if (!task) return null;
  const close = () => {
    current = null;
    emit();
  };
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        className="gp-themed-dialog w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 text-gray-900 shadow-2xl dark:border-[#27364d] dark:bg-[#0f172a] dark:text-white"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Trash2 className="h-4 w-4 text-red-400" /> {task.title}
          </h3>
          {task.state !== 'working' && (
            <button type="button" className="rounded p-1 text-gray-400 hover:text-white" onClick={close} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <p
          className={`mt-3 flex items-center gap-2 text-sm ${
            task.state === 'done' ? 'text-emerald-400' : task.state === 'error' ? 'text-red-400' : 'text-gray-600 dark:text-gray-300'
          }`}
        >
          {task.state === 'working' && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
          {task.state === 'done' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {task.state === 'error' && <XCircle className="h-4 w-4 shrink-0" />}
          {task.text}
        </p>
        {task.state === 'working' && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-300 dark:bg-gray-700">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-red-400" />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
