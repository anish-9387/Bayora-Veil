import { describe, expect, it } from 'vitest';
import { canonicalizeEvent, generateKeyPair, sign, verify } from '../src/index.js';

describe('manifest signatures', () => {
  it('signs and verifies canonical records after PostgreSQL date conversion', () => {
    const keys = generateKeyPair();
    const wire = { sequence: 1, timestamp: '2026-10-25T00:00:00.000Z' };
    const stored = { sequence: 1, timestamp: new Date(wire.timestamp) };
    const signature = sign(canonicalizeEvent(wire), keys.privateKey);
    expect(verify(signature, canonicalizeEvent(stored), keys.publicKey)).toBe(true);
    expect(verify(signature, canonicalizeEvent({ ...stored, sequence: 2 }), keys.publicKey)).toBe(false);
  });
});
