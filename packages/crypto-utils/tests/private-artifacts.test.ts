import { expect, it } from 'vitest';
import { hashPrivateArtifact } from '../src/index';

it('uses private nonces and separate domains for commitments and response evidence', () => {
  const first = hashPrivateArtifact('payload', 'predictable prompt', 'a'.repeat(64));
  expect(hashPrivateArtifact('payload', 'predictable prompt', 'b'.repeat(64))).not.toBe(first);
  expect(hashPrivateArtifact('response', 'predictable prompt', 'a'.repeat(64))).not.toBe(first);
  expect(hashPrivateArtifact('payload', 'predictable prompt', 'a'.repeat(64))).toBe(first);
  expect(() => hashPrivateArtifact('payload', 'prompt', 'short')).toThrow();
});
