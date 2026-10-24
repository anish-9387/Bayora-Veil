import { query, getClient } from '../db/client.js';
import { z } from 'zod';
import {
  AuditEventSchema,
  EventType,
  ActorRole,
  RunStatus,
  RunManifestSchema,
  VerifyResultSchema
} from '@bayora/schemas';
import {
  hash,
  canonicalizeEvent,
  buildMerkleRoot,
  generateRequestId,
  sign,
  verify,
  getSigningKey
} from '@bayora/crypto-utils';

const GENESIS_HASH = 'sha256:' + '0'.repeat(64);
const SIGNING_KEY_ID = 'bayora-eval-key-001';

interface AuditEventRow {
  id: string;
  run_id: string;
  sequence: number;
  event_type: EventType;
  timestamp: string;
  actor: ActorRole;
  payload_digest: string;
  previous_event_hash: string;
  event_hash: string;
  created_at: string;
}

interface ManifestRow {
  run_id: string;
  merkle_root: string;
  final_chain_hash: string;
  signature: string;
  public_key_id: string;
  event_count: number;
  policy_version: string;
  model_adapter: string;
  created_at: string;
}

export async function appendAuditEvent(
  runId: string,
  eventType: EventType,
  actor: ActorRole,
  payload: Record<string, unknown>
): Promise<string> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [runId]);

    const sequenceResult = await client.query(
      'SELECT COALESCE(MAX(sequence), 0) + 1 as next_sequence FROM audit_events WHERE run_id = $1',
      [runId]
    );
    const sequence = Number(sequenceResult.rows[0].next_sequence);

    const previousHashResult = await client.query(
      'SELECT event_hash FROM audit_events WHERE run_id = $1 ORDER BY sequence DESC LIMIT 1',
      [runId]
    );
    const previousEventHash = previousHashResult.rows[0]?.event_hash || GENESIS_HASH;

    const canonicalPayload = canonicalizeEvent(payload);
    const payloadDigest = hash(canonicalPayload);

    const eventData = {
      run_id: runId,
      sequence,
      event_type: eventType,
      timestamp: new Date().toISOString(),
      actor,
      payload_digest: payloadDigest,
      previous_event_hash: previousEventHash,
      event_hash: '',
      created_at: new Date().toISOString()
    };

    const canonicalEvent = canonicalizeEvent(eventData);
    const eventHash = hash(canonicalEvent + previousEventHash);
    eventData.event_hash = eventHash;

    await client.query(
      `INSERT INTO audit_events (run_id, sequence, event_type, timestamp, actor, payload_digest, previous_event_hash, event_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [runId, sequence, eventType, eventData.timestamp, actor, payloadDigest, previousEventHash, eventHash, eventData.created_at]
    );

    await client.query('COMMIT');
    return eventHash;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getAuditEvents(runId: string): Promise<z.infer<typeof AuditEventSchema>[]> {
  const result = await query(
    'SELECT * FROM audit_events WHERE run_id = $1 ORDER BY sequence ASC',
    [runId]
  );
  return result.rows.map((row: AuditEventRow) => ({
    id: row.id,
    runId: row.run_id,
    sequence: Number(row.sequence),
    eventType: row.event_type,
    timestamp: row.timestamp,
    actor: row.actor,
    payloadDigest: row.payload_digest,
    previousEventHash: row.previous_event_hash,
    eventHash: row.event_hash,
    createdAt: row.created_at
  }));
}

export async function verifyHashChain(runId: string): Promise<z.infer<typeof VerifyResultSchema>> {
  return verifyEventCopy(runId, await getAuditEvents(runId));
}

export function verifyEventCopy(runId: string, events: Awaited<ReturnType<typeof getAuditEvents>>) {
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = [];
  const tamperedEvents: Array<{ sequence: number; expectedHash: string; actualHash: string }> = [];

  let previousHash = GENESIS_HASH;
  let allValid = true;

  for (const event of events) {
    const eventData = {
      run_id: event.runId,
      sequence: event.sequence,
      event_type: event.eventType,
      timestamp: event.timestamp,
      actor: event.actor,
      payload_digest: event.payloadDigest,
      previous_event_hash: event.previousEventHash,
      event_hash: '',
      created_at: event.createdAt
    };

    const canonicalEvent = canonicalizeEvent(eventData);
    const expectedHash = hash(canonicalEvent + previousHash);

    const hashMatches = expectedHash === event.eventHash;
    const chainMatches = event.previousEventHash === previousHash;

    checks.push({
      name: `Event ${event.sequence} hash`,
      passed: hashMatches,
      detail: hashMatches ? undefined : `Expected ${expectedHash}, got ${event.eventHash}`
    });

    checks.push({
      name: `Event ${event.sequence} chain`,
      passed: chainMatches,
      detail: chainMatches ? undefined : `Expected previous ${previousHash}, got ${event.previousEventHash}`
    });

    if (!hashMatches || !chainMatches) {
      allValid = false;
      tamperedEvents.push({
        sequence: event.sequence,
        expectedHash,
        actualHash: event.eventHash
      });
    }

    previousHash = event.eventHash;
  }

  checks.push({
    name: 'Sequence continuity',
    passed: events.every((e, i) => e.sequence === i + 1),
    detail: events.some((e, i) => e.sequence !== i + 1) ? 'Sequence gap detected' : undefined
  });

  if (events.some((e, i) => e.sequence !== i + 1)) {
    allValid = false;
  }

  return {
    valid: allValid,
    runId,
    checks,
    tamperedEvents: tamperedEvents.length > 0 ? tamperedEvents : undefined
  };
}

export async function buildAndSignManifest(runId: string): Promise<z.infer<typeof RunManifestSchema>> {
  const events = await getAuditEvents(runId);
  const runResult = await query('SELECT * FROM runs WHERE id = $1', [runId]);
  const run = runResult.rows[0];

  if (!run) {
    throw new Error('Run not found');
  }

  if (!['CLOSED', 'VERIFIED'].includes(run.status)) throw new Error('Close the run before signing');
  const existing = await getManifest(runId);
  if (existing) return existing;
  const chain = await verifyHashChain(runId);
  if (!chain.valid) throw new Error('Cannot sign an invalid event chain');
  const eventHashes = events.map(e => e.eventHash);
  const merkleRoot = buildMerkleRoot(eventHashes);
  const finalChainHash = events.length > 0 ? events[events.length - 1].eventHash : GENESIS_HASH;

  const manifestData = {
    run_id: runId,
    merkle_root: merkleRoot,
    final_chain_hash: finalChainHash,
    signature: '',
    public_key_id: SIGNING_KEY_ID,
    event_count: events.length,
    policy_version: run.policy_version,
    model_adapter: run.model_adapter,
    created_at: new Date().toISOString()
  };

  const canonicalManifest = canonicalizeEvent(manifestData);
  const { privateKey } = getSigningKey();
  const signature = sign(canonicalManifest, privateKey);
  manifestData.signature = signature;

  await query(
    `INSERT INTO run_manifests (run_id, merkle_root, final_chain_hash, signature, public_key_id, event_count, policy_version, model_adapter, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (run_id) DO UPDATE SET
       merkle_root = EXCLUDED.merkle_root,
       final_chain_hash = EXCLUDED.final_chain_hash,
       signature = EXCLUDED.signature,
       public_key_id = EXCLUDED.public_key_id,
       event_count = EXCLUDED.event_count,
       policy_version = EXCLUDED.policy_version,
       model_adapter = EXCLUDED.model_adapter,
       created_at = EXCLUDED.created_at`,
    [runId, merkleRoot, finalChainHash, signature, SIGNING_KEY_ID, events.length, run.policy_version, run.model_adapter, manifestData.created_at]
  );

  return {
    runId: manifestData.run_id,
    merkleRoot: manifestData.merkle_root,
    finalChainHash: manifestData.final_chain_hash,
    signature: manifestData.signature,
    publicKeyId: manifestData.public_key_id,
    eventCount: manifestData.event_count,
    policyVersion: manifestData.policy_version,
    modelAdapter: manifestData.model_adapter,
    createdAt: manifestData.created_at
  };
}

export async function verifyManifest(runId: string): Promise<z.infer<typeof VerifyResultSchema>> {
  const manifestResult = await query('SELECT * FROM run_manifests WHERE run_id = $1', [runId]);
  const manifestRow = manifestResult.rows[0] as ManifestRow | undefined;

  if (!manifestRow) {
    return {
      valid: false,
      runId,
      checks: [{ name: 'Manifest exists', passed: false, detail: 'No manifest found for run' }]
    };
  }

  const chainResult = await verifyHashChain(runId);
  const events = await getAuditEvents(runId);
  const eventHashes = events.map(e => e.eventHash);
  const computedMerkleRoot = buildMerkleRoot(eventHashes);
  const computedFinalHash = events.length > 0 ? events[events.length - 1].eventHash : GENESIS_HASH;

  const merkleMatches = computedMerkleRoot === manifestRow.merkle_root;
  const chainHashMatches = computedFinalHash === manifestRow.final_chain_hash;

  const { publicKey } = getSigningKey();
  const manifestData = {
    run_id: manifestRow.run_id,
    merkle_root: manifestRow.merkle_root,
    final_chain_hash: manifestRow.final_chain_hash,
    signature: '',
    public_key_id: manifestRow.public_key_id,
    event_count: Number(manifestRow.event_count),
    policy_version: manifestRow.policy_version,
    model_adapter: manifestRow.model_adapter,
    created_at: manifestRow.created_at
  };
  const canonicalManifest = canonicalizeEvent(manifestData);
  const signatureValid = verify(manifestRow.signature, canonicalManifest, publicKey);

  const checks = [
    ...chainResult.checks,
    { name: 'Merkle root', passed: merkleMatches, detail: merkleMatches ? undefined : `Expected ${computedMerkleRoot}, got ${manifestRow.merkle_root}` },
    { name: 'Final chain hash', passed: chainHashMatches, detail: chainHashMatches ? undefined : `Expected ${computedFinalHash}, got ${manifestRow.final_chain_hash}` },
    { name: 'Signature valid', passed: signatureValid, detail: signatureValid ? undefined : 'Ed25519 signature verification failed' }
  ];

  checks.push({ name: 'Event count', passed: Number(manifestRow.event_count) === events.length });
  const allValid = checks.every(check => check.passed);
  if (allValid) await query("UPDATE runs SET status = 'VERIFIED' WHERE id = $1 AND status = 'CLOSED'", [runId]);

  return {
    valid: allValid,
    runId,
    checks,
    tamperedEvents: chainResult.tamperedEvents
  };
}

export async function getManifest(runId: string) {
  const result = await query('SELECT * FROM run_manifests WHERE run_id = $1', [runId]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as ManifestRow;
  return {
    runId: row.run_id,
    merkleRoot: row.merkle_root,
    finalChainHash: row.final_chain_hash,
    signature: row.signature,
    publicKeyId: row.public_key_id,
    eventCount: row.event_count,
    policyVersion: row.policy_version,
    modelAdapter: row.model_adapter,
    createdAt: row.created_at
  };
}

export async function getSigningPublicKey(): Promise<string> {
  const { publicKey } = getSigningKey();
  return publicKey;
}