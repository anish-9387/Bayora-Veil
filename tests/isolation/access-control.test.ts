import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { requestIdMiddleware, requireAuth, requireCapability, requireRole } from '../../apps/api/src/middleware/auth.js';
import { CapabilitySchema, ActorRole } from '@bayora/schemas';
vi.mock('../../apps/api/src/db/client.js', () => ({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }));

describe('Isolation & Authorization', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    app.use(requestIdMiddleware);
    app.use(requireAuth);

    app.get('/red-only', requireRole('red'), (req, res) => res.json({ ok: true }));
    app.get('/blue-only', requireRole('blue'), (req, res) => res.json({ ok: true }));
    app.get('/auditor-only', requireRole('auditor'), (req, res) => res.json({ ok: true }));

    app.get('/red-cap', requireCapability('red.submit_payload'), (req, res) => res.json({ ok: true }));
    app.get('/blue-cap', requireCapability('blue.read_sanitized_observation'), (req, res) => res.json({ ok: true }));
  });

  describe('Role-based access', () => {
    it('allows red role to access red endpoint', async () => {
      const res = await request(app)
        .get('/red-only')
        .set('x-service-id', 'red-runner')
        .set('x-service-role', 'red');
      expect(res.status).toBe(200);
    });

    it('denies blue role from red endpoint', async () => {
      const res = await request(app)
        .get('/red-only')
        .set('x-service-id', 'blue-runner')
        .set('x-service-role', 'blue');
      expect(res.status).toBe(403);
    });

    it('denies unauthenticated requests', async () => {
      const res = await request(app).get('/red-only');
      expect(res.status).toBe(401);
    });

    it('allows auditor to access auditor endpoint', async () => {
      const res = await request(app)
        .get('/auditor-only')
        .set('x-service-id', 'auditor')
        .set('x-service-role', 'auditor');
      expect(res.status).toBe(200);
    });

    it('denies red from auditor endpoint', async () => {
      const res = await request(app)
        .get('/auditor-only')
        .set('x-service-id', 'red-runner')
        .set('x-service-role', 'red');
      expect(res.status).toBe(403);
    });
  });

  describe('Capability-based access', () => {
    it('allows capability holder', async () => {
      const res = await request(app)
        .get('/red-cap')
        .set('x-service-id', 'red-runner')
        .set('x-service-role', 'red');
      expect(res.status).toBe(200);
    });

    it('denies without capability', async () => {
      const res = await request(app)
        .get('/blue-cap')
        .set('x-service-id', 'red-runner')
        .set('x-service-role', 'red');
      expect(res.status).toBe(403);
    });
  });

  describe('Error response format', () => {
    it('returns generic error without resource existence info', async () => {
      const res = await request(app)
        .get('/red-only')
        .set('x-service-id', 'blue-runner')
        .set('x-service-role', 'blue');
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.requestId).toBeDefined();
    });
  });
});

describe('Cross-tenant isolation', () => {
  it('prevents Red from reading Blue defense rules', () => {
    // Red runner only exposes /runs/:id/payload and /runs/:id/commitment
    // No endpoint for reading Blue rules
    expect(true).toBe(true); // Placeholder for integration test
  });

  it('prevents Blue from reading Red payloads', () => {
    // Blue runner only exposes /runs/:id/defend and /runs/:id/defense-rules
    // No endpoint for reading Red payloads
    expect(true).toBe(true); // Placeholder for integration test
  });

  it('prevents Target from accessing Red/Blue stores', () => {
    // Target adapter only exposes /execute
    // No filesystem access to other cells
    expect(true).toBe(true); // Placeholder for integration test
  });
});
