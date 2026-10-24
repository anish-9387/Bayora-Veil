import { describe, it, expect } from 'vitest';
import { hash, hashCommitment, buildMerkleRoot, canonicalizeEvent, generateRequestId, constantTimeEqual, bucketDuration, addTimingNoise } from '../src/index.js';

describe('crypto-utils', () => {
  describe('hash', () => {
    it('produces consistent SHA-256 hashes', () => {
      const h1 = hash('test');
      const h2 = hash('test');
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('produces different hashes for different inputs', () => {
      expect(hash('a')).not.toBe(hash('b'));
    });

    it('handles Uint8Array input', () => {
      const input = new TextEncoder().encode('test');
      const h = hash(input);
      expect(h).toMatch(/^sha256:[a-f0-9]{64}$/);
    });
  });

  describe('hashCommitment', () => {
    it('returns sha256-prefixed hash', () => {
      const commitment = hashCommitment('payload');
      expect(commitment).toMatch(/^sha256:[a-f0-9]{64}$/);
    });
  });

  describe('buildMerkleRoot', () => {
    it('returns genesis for empty array', () => {
      const root = buildMerkleRoot([]);
      expect(root).toBe('sha256:' + '0'.repeat(64));
    });

    it('returns hash for single element', () => {
      const leaf = 'sha256:' + 'a'.repeat(64);
      const root = buildMerkleRoot([leaf]);
      expect(root).toBe(leaf);
    });

    it('produces deterministic root for same inputs', () => {
      const leaves = [
        'sha256:' + 'a'.repeat(64),
        'sha256:' + 'b'.repeat(64),
        'sha256:' + 'c'.repeat(64)
      ];
      const r1 = buildMerkleRoot(leaves);
      const r2 = buildMerkleRoot(leaves);
      expect(r1).toBe(r2);
    });

    it('changes when leaf changes', () => {
      const leaves1 = ['sha256:' + 'a'.repeat(64), 'sha256:' + 'b'.repeat(64)];
      const leaves2 = ['sha256:' + 'a'.repeat(64), 'sha256:' + 'c'.repeat(64)];
      expect(buildMerkleRoot(leaves1)).not.toBe(buildMerkleRoot(leaves2));
    });
  });

  describe('canonicalizeEvent', () => {
    it('produces deterministic JSON with sorted keys', () => {
      const event = { z: 1, a: 2, m: 3 };
      const c1 = canonicalizeEvent(event);
      const c2 = canonicalizeEvent({ m: 3, z: 1, a: 2 });
      expect(c1).toBe(c2);
      expect(c1).toBe('{"a":2,"m":3,"z":1}');
    });

    it('handles nested objects', () => {
      const event = { b: { z: 1, a: 2 }, a: 3 };
      const c = canonicalizeEvent(event);
      expect(c).toBe('{"a":3,"b":{"a":2,"z":1}}');
    });
  });

  describe('generateRequestId', () => {
    it('generates valid UUID v4', () => {
      const id = generateRequestId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('generates unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 1000; i++) {
        ids.add(generateRequestId());
      }
      expect(ids.size).toBe(1000);
    });
  });

  describe('constantTimeEqual', () => {
    it('returns true for equal strings', () => {
      expect(constantTimeEqual('abc', 'abc')).toBe(true);
    });

    it('returns false for different strings', () => {
      expect(constantTimeEqual('abc', 'abd')).toBe(false);
    });

    it('returns false for different lengths', () => {
      expect(constantTimeEqual('ab', 'abc')).toBe(false);
    });
  });

  describe('bucketDuration', () => {
    it('buckets to nearest bucket size', () => {
      expect(bucketDuration(150, 100)).toBe(100);
      expect(bucketDuration(250, 100)).toBe(200);
      expect(bucketDuration(99, 100)).toBe(0);
    });

    it('handles custom bucket sizes', () => {
      expect(bucketDuration(550, 1000)).toBe(0);
      expect(bucketDuration(1500, 1000)).toBe(1000);
    });
  });

  describe('addTimingNoise', () => {
    it('adds noise within range', () => {
      for (let i = 0; i < 100; i++) {
        const noisy = addTimingNoise(1000, 50);
        expect(noisy).toBeGreaterThanOrEqual(950);
        expect(noisy).toBeLessThanOrEqual(1050);
      }
    });

    it('never returns negative', () => {
      for (let i = 0; i < 100; i++) {
        expect(addTimingNoise(10, 50)).toBeGreaterThanOrEqual(0);
      }
    });
  });
});