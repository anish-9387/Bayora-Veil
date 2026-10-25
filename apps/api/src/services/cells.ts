import { tenantId, principals } from '../security/context.js';

export async function callCell<T = any>(cell: 'red' | 'blue' | 'audit' | 'replay', path: string, body: unknown = {}, actorRole?: string): Promise<T> {
  const prefix = cell.toUpperCase();
  const base = process.env[`${prefix}_CELL_URL`];
  const key = process.env[`${prefix}_CELL_TOKEN`];
  if (!base || !key) throw new Error(`Missing ${cell} cell configuration`);
  const response = await fetch(new URL(path, base.includes('://') ? base : `http://${base}`), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(45000, (principals.getStore()?.deadline || Date.now() + 45000) - Date.now()))),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`,
      'X-Tenant-ID': tenantId(), 'X-Actor-Role': actorRole || principals.getStore()?.role || 'orchestrator' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw Object.assign(new Error('Private service operation failed'), { status: response.status === 409 ? 409 : 502 });
  return await response.json() as T;
}
