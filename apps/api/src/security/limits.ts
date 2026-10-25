import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';
import { query, getClient } from '../db/client.js';

export function rateLimit(limit: number, scope: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = createHash('sha256').update(`${scope}:${req.identity?.userId || req.ip}`).digest('hex');
      const result = await query(`INSERT INTO rate_limits (key, window_start, count) VALUES ($1, date_trunc('minute', NOW()), 1)
        ON CONFLICT (key) DO UPDATE SET count = CASE WHEN rate_limits.window_start = date_trunc('minute', NOW()) THEN rate_limits.count + 1 ELSE 1 END,
        window_start = date_trunc('minute', NOW()) RETURNING count`, [key]);
      if (result.rows[0].count > limit) { res.setHeader('Retry-After', '60'); return res.status(429).json({ success: false, error: { message: 'Request limit exceeded' } }); }
      next();
    } catch (error) { next(error); }
  };
}

export async function lockRun(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'POST') return next();
  const lockKey = 'run:' + req.params.id;
  const client = await getClient();
  try {
    // Let a sequential request wait briefly for the preceding response's lock cleanup.
    await client.query("SET lock_timeout = '500ms'");
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      void client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey])
        .then(() => client.query('SET lock_timeout = 0')).then(() => client.release(), error => client.release(error));
    };
    res.locals.releaseRun = release;
    res.once('finish', release);
    next();
  } catch (error) {
    const reset = await client.query('SET lock_timeout = 0').then(() => true, () => false);
    client.release(reset ? undefined : error as Error);
    if ((error as { code?: string }).code === '55P03') return res.status(409).json({ success: false, error: { message: 'Run operation already in progress' } });
    next(error);
  }
}

export async function workBudget(req: Request, res: Response, next: NextFunction) {
  const client = await getClient();
  const tenant = req.identity!.tenantId;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['work-budgets']);
    await client.query('DELETE FROM work_leases WHERE expires_at < NOW()');
    const active = await client.query('SELECT count(*)::int AS count FROM work_leases WHERE tenant_id = $1', [tenant]);
    const workCount = await client.query('SELECT count(*)::int AS count FROM work_leases');
    if (active.rows[0].count >= 2 || workCount.rows[0].count >= 20) { await client.query('ROLLBACK'); return res.status(429).json({ success: false, error: { message: 'Work budget exhausted; retry shortly' } }); }
    await client.query("INSERT INTO work_leases (id, tenant_id, expires_at) VALUES ($1, $2, NOW() + interval '90 seconds')", [req.requestId, tenant]);
    await client.query('COMMIT');
    res.once('finish', () => { void query('DELETE FROM work_leases WHERE id = $1', [req.requestId]).catch(() => {}); });
    next();
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
}
