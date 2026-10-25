import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const db = vi.hoisted(() => ({ query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }));
vi.mock('../src/db/client.js', () => ({ query: vi.fn(), getClient: async () => db }));
import { lockRun } from '../src/security/limits.js';

it('unlocks the original run after Express restores route parameters and releases once', async () => {
  const req = { method: 'POST', params: { id: 'original-run' } } as unknown as Request;
  const res = Object.assign(new EventEmitter(), { locals: {} as Record<string, () => void> }) as unknown as Response;
  const next = vi.fn();
  await lockRun(req, res, next);
  expect(next).toHaveBeenCalledOnce();
  req.params = {};
  res.emit('finish');
  res.locals.releaseRun();
  await vi.waitFor(() => expect(db.release).toHaveBeenCalledOnce());
  expect(db.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock(hashtext($1))', ['run:original-run']);
});
