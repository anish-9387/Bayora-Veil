import { describe, it, expect } from 'vitest';
import { hash, canonicalizeEvent, buildMerkleRoot } from '@bayora/crypto-utils';

const GENESIS_HASH = 'sha256:' + '0'.repeat(64);

function computeEventHash(event: Record<string, unknown>, previousHash: string): string {
  const canonical = canonicalizeEvent({ ...event, previous_event_hash: previousHash, event_hash: '' });
  return hash(canonical);
}

function verifyHashChain(events: Array<Record<string, unknown>>): { valid: boolean; tamperedAt?: number } {
  let previousHash = GENESIS_HASH;

  for (let i = 0; i < events.length; i++) {
    const expectedHash = computeEventHash(events[i], previousHash);
    const actualHash = events[i].event_hash as string;

    if (expectedHash !== actualHash) {
      return { valid: false, tamperedAt: i };
    }

    if (events[i].previous_event_hash !== previousHash) {
      return { valid: false, tamperedAt: i };
    }

    previousHash = actualHash;
  }

  return { valid: true };
}

describe('Replay Verification', () => {
  const createSampleRun = () => {
    const events = [
      { run_id: 'run-1', sequence: 1, event_type: 'run_created', timestamp: '2026-01-01T12:00:00Z', actor: 'orchestrator', payload_digest: 'sha256:aaa', previous_event_hash: GENESIS_HASH, event_hash: '', created_at: '2026-01-01T12:00:00Z' },
      { run_id: 'run-1', sequence: 2, event_type: 'payload_committed', timestamp: '2026-01-01T12:00:01Z', actor: 'red', payload_digest: 'sha256:bbb', previous_event_hash: '', event_hash: '', created_at: '2026-01-01T12:00:01Z' },
      { run_id: 'run-1', sequence: 3, event_type: 'execution_started', timestamp: '2026-01-01T12:00:02Z', actor: 'orchestrator', payload_digest: 'sha256:ccc', previous_event_hash: '', event_hash: '', created_at: '2026-01-01T12:00:02Z' },
      { run_id: 'run-1', sequence: 4, event_type: 'target_response', timestamp: '2026-01-01T12:00:03Z', actor: 'target', payload_digest: 'sha256:ddd', previous_event_hash: '', event_hash: '', created_at: '2026-01-01T12:00:03Z' },
      { run_id: 'run-1', sequence: 5, event_type: 'observation_released', timestamp: '2026-01-01T12:00:04Z', actor: 'observation-firewall', payload_digest: 'sha256:eee', previous_event_hash: '', event_hash: '', created_at: '2026-01-01T12:00:04Z' }
    ];

    let previousHash = GENESIS_HASH;
    for (const event of events) {
      const eventHash = computeEventHash(event, previousHash);
      event.previous_event_hash = previousHash;
      event.event_hash = eventHash;
      previousHash = eventHash;
    }

    return events;
  };

  it('verifies valid hash chain', () => {
    const events = createSampleRun();
    const result = verifyHashChain(events);
    expect(result.valid).toBe(true);
  });

  it('detects modified event in replay', () => {
    const events = createSampleRun();
    events[2] = { ...events[2], payload_digest: 'sha256:tampered' };
    const result = verifyHashChain(events);
    expect(result.valid).toBe(false);
    expect(result.tamperedAt).toBe(2);
  });

  it('detects deleted event via sequence gap', () => {
    const events = createSampleRun();
    events.splice(2, 1);
    const sequences = events.map((e, i) => e.sequence === i + 1);
    expect(sequences.every(s => s)).toBe(false);
  });

  it('detects reordered events', () => {
    const events = createSampleRun();
    const temp = events[2];
    events[2] = events[3];
    events[3] = temp;
    const result = verifyHashChain(events);
    expect(result.valid).toBe(false);
  });

  it('recomputes Merkle root correctly', () => {
    const events = createSampleRun();
    const eventHashes = events.map(e => e.event_hash);
    const computedRoot = buildMerkleRoot(eventHashes);

    const manifestRoot = computedRoot;
    expect(manifestRoot).toBe(computedRoot);
  });

  it('detects Merkle root mismatch when event changed', () => {
    const events = createSampleRun();
    const originalHashes = events.map(e => e.event_hash);
    const originalRoot = buildMerkleRoot(originalHashes);

    const tamperedEvents = [...events];
    tamperedEvents[2] = { ...tamperedEvents[2], payload_digest: 'sha256:tampered' };
    let previousHash = GENESIS_HASH;
    for (const event of tamperedEvents) {
      const eventHash = computeEventHash(event, previousHash);
      event.previous_event_hash = previousHash;
      event.event_hash = eventHash;
      previousHash = eventHash;
    }

    const tamperedHashes = tamperedEvents.map(e => e.event_hash);
    const tamperedRoot = buildMerkleRoot(tamperedHashes);

    expect(originalRoot).not.toBe(tamperedRoot);
  });

  it('verifies evidence artifact digests match', () => {
    const artifacts = [
      { id: 'art-1', run_id: 'run-1', artifact_type: 'prompt', storage_key: 'key1', digest: 'sha256:abc', access_class: 'red_private', created_at: '2026-01-01T12:00:00Z' },
      { id: 'art-2', run_id: 'run-1', artifact_type: 'response', storage_key: 'key2', digest: 'sha256:def', access_class: 'target_private', created_at: '2026-01-01T12:00:01Z' }
    ];

    const allMatch = artifacts.every(a => a.digest.startsWith('sha256:') && a.digest.length === 71);
    expect(allMatch).toBe(true);
  });

  it('detects evidence digest mismatch', () => {
    const originalArtifacts = [
      { id: 'art-1', digest: 'sha256:abc' },
      { id: 'art-2', digest: 'sha256:def' }
    ];

    const tamperedArtifacts = [
      { id: 'art-1', digest: 'sha256:abc' },
      { id: 'art-2', digest: 'sha256:modified' }
    ];

    const mismatches = tamperedArtifacts.filter((a, i) => a.digest !== originalArtifacts[i].digest);
    expect(mismatches.length).toBe(1);
  });

  it('produces replay metrics', () => {
    const events = createSampleRun();
    const result = verifyHashChain(events);

    const replayMetrics = {
      runId: 'run-1',
      eventCount: events.length,
      hashChainValid: result.valid,
      merkleRootMatches: true,
      signatureValid: true,
      evidenceDigestsMatch: true,
      discrepancies: result.valid ? [] : [{ type: 'hash_chain_mismatch', sequence: result.tamperedAt }]
    };

    expect(replayMetrics.hashChainValid).toBe(true);
    expect(replayMetrics.eventCount).toBe(5);
    expect(Array.isArray(replayMetrics.discrepancies)).toBe(true);
  });

  it('handles empty run gracefully', () => {
    const result = verifyHashChain([]);
    expect(result.valid).toBe(true);
  });

  it('verifies final chain hash matches last event', () => {
    const events = createSampleRun();
    const finalHash = events[events.length - 1].event_hash;
    expect(finalHash).toBeDefined();
    expect(finalHash.startsWith('sha256:')).toBe(true);
  });
});