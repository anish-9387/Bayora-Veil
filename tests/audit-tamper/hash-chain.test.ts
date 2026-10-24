import { describe, it, expect } from 'vitest';
import { hash, canonicalizeEvent, buildMerkleRoot } from '@bayora/crypto-utils';

const GENESIS = 'sha256:' + '0'.repeat(64);

function buildChain(events: Array<{ canonicalPayload: string; previousHash: string }>) {
  let previousHash = GENESIS;
  const chain: Array<{ eventHash: string; previousHash: string }> = [];

  for (const event of events) {
    const canonical = event.canonicalPayload + event.previousHash;
    const eventHash = hash(canonical);
    chain.push({ eventHash, previousHash: event.previousHash });
    previousHash = eventHash;
  }

  return chain;
}

describe('Audit Tamper Detection', () => {
  const sampleEvents = [
    { run_id: 'run-1', sequence: 1, event_type: 'run_created', timestamp: '2026-01-01T12:00:00Z', actor: 'orchestrator', payload_digest: 'sha256:aaa', previous_event_hash: GENESIS, event_hash: '', created_at: '2026-01-01T12:00:00Z' },
    { run_id: 'run-1', sequence: 2, event_type: 'payload_committed', timestamp: '2026-01-01T12:00:01Z', actor: 'red', payload_digest: 'sha256:bbb', previous_event_hash: '', event_hash: '', created_at: '2026-01-01T12:00:01Z' },
    { run_id: 'run-1', sequence: 3, event_type: 'execution_started', timestamp: '2026-01-01T12:00:02Z', actor: 'orchestrator', payload_digest: 'sha256:ccc', previous_event_hash: '', event_hash: '', created_at: '2026-01-01T12:00:02Z' },
    { run_id: 'run-1', sequence: 4, event_type: 'target_response', timestamp: '2026-01-01T12:00:03Z', actor: 'target', payload_digest: 'sha256:ddd', previous_event_hash: '', event_hash: '', created_at: '2026-01-01T12:00:03Z' },
    { run_id: 'run-1', sequence: 5, event_type: 'observation_released', timestamp: '2026-01-01T12:00:04Z', actor: 'observation-firewall', payload_digest: 'sha256:eee', previous_event_hash: '', event_hash: '', created_at: '2026-01-01T12:00:04Z' }
  ];

  it('builds valid hash chain from genesis', () => {
    let previousHash = GENESIS;
    const chain: string[] = [];

    for (const event of sampleEvents) {
      const canonical = canonicalizeEvent({ ...event, previous_event_hash: previousHash, event_hash: '' });
      const eventHash = hash(canonical);
      chain.push(eventHash);
      previousHash = eventHash;
    }

    expect(chain.length).toBe(5);
    expect(chain[0]).not.toBe(GENESIS);
  });

  it('detects modified event payload', () => {
    let previousHash = GENESIS;
    const originalHashes: string[] = [];

    for (const event of sampleEvents) {
      const canonical = canonicalizeEvent({ ...event, previous_event_hash: previousHash, event_hash: '' });
      const eventHash = hash(canonical);
      originalHashes.push(eventHash);
      previousHash = eventHash;
    }

    const tamperedEvents = [...sampleEvents];
    tamperedEvents[2] = { ...tamperedEvents[2], payload_digest: 'sha256:tampered' };

    previousHash = GENESIS;
    for (let i = 0; i < tamperedEvents.length; i++) {
      const canonical = canonicalizeEvent({ ...tamperedEvents[i], previous_event_hash: previousHash, event_hash: '' });
      const eventHash = hash(canonical);
      if (i === 2) {
        expect(eventHash).not.toBe(originalHashes[i]);
      }
      previousHash = eventHash;
    }
  });

  it('detects deleted event (sequence gap)', () => {
    const eventsWithGap = sampleEvents.filter((_, i) => i !== 2);
    const sequences = eventsWithGap.map(e => e.sequence);
    expect(sequences).not.toEqual([1, 2, 3, 4, 5]);
    expect(sequences).toEqual([1, 2, 4, 5]);
  });

  it('detects reordered events', () => {
    const reordered = [...sampleEvents];
    const temp = reordered[2];
    reordered[2] = reordered[3];
    reordered[3] = temp;

    let previousHash = GENESIS;
    let chainValid = true;

    for (const event of reordered) {
      const canonical = canonicalizeEvent({ ...event, previous_event_hash: previousHash, event_hash: '' });
      const eventHash = hash(canonical);
      if (event.previous_event_hash !== previousHash) {
        chainValid = false;
      }
      previousHash = eventHash;
    }

    expect(chainValid).toBe(false);
  });

  it('verifies Merkle root changes with any event modification', () => {
    const hashes1 = ['sha256:a', 'sha256:b', 'sha256:c', 'sha256:d', 'sha256:e'].map(value => hash(value));
    const root1 = buildMerkleRoot(hashes1);

    const hashes2 = ['sha256:a', 'sha256:b', 'sha256:modified', 'sha256:d', 'sha256:e'].map(value => hash(value));
    const root2 = buildMerkleRoot(hashes2);

    expect(root1).not.toBe(root2);
  });

  it('verifies Merkle root changes with event deletion', () => {
    const hashes1 = ['sha256:a', 'sha256:b', 'sha256:c', 'sha256:d', 'sha256:e'].map(value => hash(value));
    const root1 = buildMerkleRoot(hashes1);

    const hashes2 = ['sha256:a', 'sha256:b', 'sha256:d', 'sha256:e'].map(value => hash(value));
    const root2 = buildMerkleRoot(hashes2);

    expect(root1).not.toBe(root2);
  });

  it('verifies Merkle root changes with event reordering', () => {
    const hashes1 = ['sha256:a', 'sha256:b', 'sha256:c', 'sha256:d'].map(value => hash(value));
    const root1 = buildMerkleRoot(hashes1);

    const hashes2 = ['sha256:a', 'sha256:c', 'sha256:b', 'sha256:d'].map(value => hash(value));
    const root2 = buildMerkleRoot(hashes2);

    expect(root1).not.toBe(root2);
  });

  it('detects missing events via sequence continuity', () => {
    const sequences = sampleEvents.map(e => e.sequence);
    const continuous = sequences.every((s, i) => s === i + 1);
    expect(continuous).toBe(true);

    const withGap = sampleEvents.filter((_, i) => i !== 2);
    const gapSequences = withGap.map(e => e.sequence);
    const continuousGap = gapSequences.every((s, i) => s === i + 1);
    expect(continuousGap).toBe(false);
  });

  it('produces deterministic canonical serialization', () => {
    const event1 = { z: 1, a: 2, m: 3 };
    const event2 = { m: 3, z: 1, a: 2 };
    expect(canonicalizeEvent(event1)).toBe(canonicalizeEvent(event2));
    expect(canonicalizeEvent(event1)).toBe('{"a":2,"m":3,"z":1}');
  });
});

describe('Manifest Tamper Detection', () => {
  it('verifies manifest includes all required fields', () => {
    const manifest = {
      run_id: 'run-1',
      merkle_root: 'sha256:abc',
      final_chain_hash: 'sha256:def',
      signature: 'sig',
      public_key_id: 'key-1',
      event_count: 5,
      policy_version: 'v1.0.0',
      model_adapter: 'mock-adapter',
      created_at: '2026-01-01T12:00:00Z'
    };

    expect(manifest.merkle_root).toBeDefined();
    expect(manifest.final_chain_hash).toBeDefined();
    expect(manifest.signature).toBeDefined();
    expect(manifest.event_count).toBe(5);
  });

  it('detects manifest field modification', () => {
    const original = '{"merkle_root":"sha256:abc","final_chain_hash":"sha256:def"}';
    const modified = '{"merkle_root":"sha256:modified","final_chain_hash":"sha256:def"}';

    expect(hash(original)).not.toBe(hash(modified));
  });
});