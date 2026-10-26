import { useEffect, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { apiClient } from '../utils/api';

// Install form (Super Admins): who the new server belongs to. Users only see the servers they were given, so every
// server gets an owner: an existing user, or a new one that is made right before the server.
export type OwnerValue = { mode: 'existing'; userId: string } | { mode: 'new'; username: string; password: string };

export const ownerInvalid = (owner: OwnerValue): boolean =>
  owner.mode === 'existing' ? !owner.userId : !owner.username.trim() || owner.username.trim().length > 12 || owner.password.length < 8;

export const ownerPayload = (owner: OwnerValue) =>
  owner.mode === 'existing' ? { ownerUserId: Number(owner.userId) } : { newOwner: { username: owner.username.trim(), password: owner.password } };

export function generateOwnerPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// whether the signed-in user is a Super Admin (only they choose an owner)
export function useIsSuperAdmin(): boolean {
  const [isRoot, setIsRoot] = useState(false);
  useEffect(() => {
    apiClient
      .getCurrentUser()
      .then((me) => setIsRoot(Boolean(me?.user?.isRoot)))
      .catch(() => setIsRoot(false));
  }, []);
  return isRoot;
}

export function OwnerPicker({ value, onChange, inputCls }: { value: OwnerValue; onChange: (v: OwnerValue) => void; inputCls: string }) {
  const [users, setUsers] = useState<Array<{ id: number; username: string; isRoot: boolean; isEnabled: boolean }> | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiClient
      .listUsers()
      .then((res) => setUsers(res.users))
      .catch(() => setUsers([]));
  }, []);

  const tab = (mode: OwnerValue['mode'], label: string) => (
    <button
      type="button"
      onClick={() => {
        if (value.mode === mode) return;
        onChange(mode === 'existing' ? { mode: 'existing', userId: '' } : { mode: 'new', username: '', password: generateOwnerPassword() });
      }}
      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
        value.mode === mode
          ? 'border-[var(--color-cyan-400)] bg-[var(--color-cyan-400)]/15 text-[var(--color-cyan-400)]'
          : 'border-gray-300 text-gray-500 hover:text-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:text-white'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Owner</label>
      <div className="mb-2 flex gap-2">
        {tab('new', 'New user')}
        {tab('existing', 'Existing user')}
      </div>
      {value.mode === 'existing' ? (
        <select className={inputCls} value={value.userId} onChange={(e) => onChange({ mode: 'existing', userId: e.target.value })}>
          <option value="">{users === null ? 'Loading users…' : 'Choose a user'}</option>
          {(users ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
              {u.isRoot ? ' (Super Admin)' : ''}
              {!u.isEnabled ? ' (disabled)' : ''}
            </option>
          ))}
        </select>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className={inputCls}
            value={value.username}
            maxLength={12}
            placeholder="Username (max 12)"
            autoComplete="off"
            onChange={(e) => onChange({ ...value, username: e.target.value })}
          />
          <div className="flex gap-1.5">
            <input
              className={`${inputCls} min-w-0 flex-1 font-mono`}
              value={value.password}
              placeholder="Password (min 8)"
              autoComplete="new-password"
              onChange={(e) => onChange({ ...value, password: e.target.value })}
            />
            <button
              type="button"
              title="New password"
              className="rounded-lg border border-gray-300 px-2 text-gray-500 hover:text-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:text-white"
              onClick={() => onChange({ ...value, password: generateOwnerPassword() })}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Copy username and password"
              className="rounded-lg border border-gray-300 px-2 text-gray-500 hover:text-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:text-white"
              onClick={() =>
                void navigator.clipboard?.writeText(`${value.username.trim()} / ${value.password}`).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}
      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
        {value.mode === 'new'
          ? 'The user is made first and gets only this server. Give them the username and password.'
          : 'The user gets this server (on top of the ones they have). Users only see their own servers.'}{' '}
        Permissions can be changed later in User Administration.
      </p>
    </div>
  );
}
