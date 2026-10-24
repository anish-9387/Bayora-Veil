import { sha512 } from '@noble/hashes/sha512';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { sha256 } from '@noble/hashes/sha256';
import * as ed25519 from '@noble/ed25519';
import { randomBytes } from '@noble/hashes/utils';
import { z } from 'zod';

ed25519.etc.sha512Sync = (...messages) => sha512(ed25519.etc.concatBytes(...messages));

export const KeyPairSchema = z.object({
  publicKey: z.string(),
  privateKey: z.string()
});
export type KeyPair = z.infer<typeof KeyPairSchema>;

export const SignedManifestSchema = z.object({
  manifest: z.string(),
  signature: z.string(),
  publicKey: z.string()
});
export type SignedManifest = z.infer<typeof SignedManifestSchema>;

export function generateKeyPair(): KeyPair {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    privateKey: Buffer.from(privateKey).toString('hex'),
    publicKey: Buffer.from(publicKey).toString('hex')
  };
}

export function sign(data: string | Uint8Array, privateKeyHex: string): string {
  const message = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const privateKey = Buffer.from(privateKeyHex, 'hex');
  const signature = ed25519.sign(message, privateKey);
  return Buffer.from(signature).toString('hex');
}

export function verify(signatureHex: string, data: string | Uint8Array, publicKeyHex: string): boolean {
  try {
    const message = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const signature = Buffer.from(signatureHex, 'hex');
    const publicKey = Buffer.from(publicKeyHex, 'hex');
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function hash(data: string | Uint8Array): string {
  const message = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = sha256(message);
  return `sha256:${Buffer.from(digest).toString('hex')}`;
}

export function hashRaw(data: string | Uint8Array): Uint8Array {
  const message = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return sha256(message);
}

export function hashCommitment(payload: string): string {
  return hash(payload);
}

export function buildHashChain(events: Array<{ canonicalPayload: string; previousHash: string }>): Array<{ eventHash: string; previousHash: string }> {
  const results: Array<{ eventHash: string; previousHash: string }> = [];
  let previousHash = 'sha256:' + '0'.repeat(64);

  for (const event of events) {
    const canonical = event.canonicalPayload + event.previousHash;
    const eventHash = hash(canonical);
    results.push({ eventHash, previousHash: event.previousHash });
    previousHash = eventHash;
  }

  return results;
}

export function buildMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) {
    return 'sha256:' + '0'.repeat(64);
  }

  let currentLevel: Uint8Array[] = hashes.map(h => Buffer.from(h.replace('sha256:', ''), 'hex'));

  while (currentLevel.length > 1) {
    const nextLevel: Uint8Array[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      const combined = Buffer.concat([left, right]);
      nextLevel.push(sha256(combined));
    }
    currentLevel = nextLevel;
  }

  return `sha256:${Buffer.from(currentLevel[0]).toString('hex')}`;
}

function canonicalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalizeValue((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function canonicalizeEvent(event: Record<string, unknown>): string {
  return JSON.stringify(canonicalizeValue(event));
}

export function generateRequestId(): string {
  const bytes = randomBytes(16);
  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    '8' + hex.slice(17, 20),
    hex.slice(20, 32)
  ].join('-');
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function bucketDuration(ms: number, bucketSizeMs = 100): number {
  return Math.floor(ms / bucketSizeMs) * bucketSizeMs;
}

export function addTimingNoise(ms: number, maxNoiseMs = 50): number {
  const noise = (Math.random() - 0.5) * 2 * maxNoiseMs;
  return Math.max(0, Math.round(ms + noise));
}

let signingKeyPair: { privateKey: string; publicKey: string } | null = null;

export function getSigningKey(): { privateKey: string; publicKey: string } {
  if (!signingKeyPair) {
    const path = resolve(process.env.SIGNING_KEY_FILE || '.bayora/signing-key.json');
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, JSON.stringify(generateKeyPair()), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    signingKeyPair = KeyPairSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  }
  return signingKeyPair;
}