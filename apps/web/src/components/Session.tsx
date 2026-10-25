import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { API_BASE } from '../api/client';

export function Session({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const mode = await fetch(`${API_BASE}/auth/mode`).then(r => { if (!r.ok) throw new Error(); return r.json(); });
        sessionStorage.setItem('bayora-demo', String(mode.demo));
        if (mode.demo) return setReady(true);
        const response = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${sessionStorage.getItem('bayora-token') || ''}` } });
        if (response.ok) {
          const { user } = await response.json();
          sessionStorage.setItem('bayora-role', user.role); setReady(true);
        }
      } catch { setError('Cannot reach the server. Check the API address and try again.'); }
    })();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${API_BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: data.get('email'), password: data.get('password') }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || 'Sign-in failed');
      sessionStorage.setItem('bayora-token', result.token);
      sessionStorage.setItem('bayora-role', result.user.role);
      sessionStorage.setItem('bayora-name', result.user.name); setReady(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); }
    finally { setBusy(false); }
  }
  if (ready) return <>{children}</>;
  return <main className="min-h-screen flex items-center justify-center p-6"><form onSubmit={submit} className="glass-card p-8 w-full max-w-md space-y-5">
    <div><p className="text-sm text-bayora-text-muted">BAYORA VEIL</p><h1 className="text-3xl font-semibold mt-2">Sign in</h1><p className="text-sm text-bayora-text-muted mt-2">Use your assigned workspace account.</p></div>
    <label className="block">Email<input className="w-full mt-2" name="email" type="email" autoComplete="username" required /></label>
    <label className="block">Password<input className="w-full mt-2" name="password" type="password" autoComplete="current-password" maxLength={256} required /></label>
    {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
    <button disabled={busy} className="w-full rounded-xl bg-bayora-primary text-white py-3 disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
  </form></main>;
}
