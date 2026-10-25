import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { principals } from '../src/security/context.js';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/db/client.js', () => ({ query: db.query }));
import { hashPassword, verifyPassword, authenticate } from '../src/security/accounts.js';
import { requireAuth, requestIdMiddleware } from '../src/middleware/auth.js';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('account authentication', () => {
  it('salts password hashes and rejects incorrect passwords', async () => {
    const password = 'a-long-test-password-7';
    const first = hashPassword(password);
    expect(hashPassword(password)).not.toBe(first);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword('incorrect', first)).toBe(false);
    expect(() => hashPassword('short')).toThrow();
  });
  it('rejects malformed bearer credentials without a database lookup', async () => {
    expect(await authenticate('chosen-by-client')).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });
  it('ignores role headers in production, even when demo mode is requested', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('AUTH_MODE', 'demo');
    const app = express(); app.use(requestIdMiddleware, requireAuth); app.get('/', (_req, res) => res.sendStatus(200));
    const response = await request(app).get('/').set('X-Service-ID', 'attacker').set('X-Service-Role', 'orchestrator');
    expect(response.status).toBe(401);
  });
  it('takes role and tenant from the server session and propagates request context', async () => {
    vi.stubEnv('AUTH_MODE', 'accounts');
    db.query.mockResolvedValue({ rows: [{ id: 'user-1', tenant_id: 'tenant-1', role: 'blue' }] });
    const app = express(); app.use(requestIdMiddleware, requireAuth);
    app.get('/', (req, res) => res.json({ role: req.identity?.role, principal: principals.getStore() }));
    const response = await request(app).get('/').set('Authorization', 'Bearer ' + 'a'.repeat(43)).set('X-Service-Role', 'auditor');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ role: 'blue', principal: { userId: 'user-1', tenantId: 'tenant-1', role: 'blue' } });
  });
});
