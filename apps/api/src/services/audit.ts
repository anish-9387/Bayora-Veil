import { query, getClient } from '../db/client.js';
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
  verify
} from '@bayora/crypto-utils';
import { randomBytes } from '@noble/hashes/utils';

const GENESIS_HASH = 'sha256:' + '0'.repeat(64);
const SIGNING_KEY_ID = 'bayora-eval-key-001';
let signingKeyPair: { privateKey: string; publicKey: string } | null = null;

function getSigningKey() {
  if (!signingKeyPair) {
    const privateKey = Buffer.from(randomBytes(32)).toString('hex');
    const publicKey = (await import('@noble/ed25519')).ed25519.getPublicKey(Buffer.from(privateKey, 'hex'));
    signingKeyPair = {
      privateKey,
      publicKey: Buffer.from(publicKey).toString('hex')
    };
  }
  return signingKeyPair;
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

    const sequenceResult = await client.query(
      'SELECT COALESCE(MAX(sequence), 0) + 1 as next_sequence FROM audit_events WHERE run_id = $1',
      [runId]
    );
    const sequence = sequenceResult.rows[0].next_sequence;

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
  return result.rows;
}

export async function verifyHashChain(runId: string): Promise<z.infer<typeof VerifyResultSchema>> {
  const events = await getAuditEvents(runId);
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = [];
  const tamperedEvents: Array<{ sequence: number; expectedHash: string; actualHash: string }> = [];

  let previousHash = GENESIS_HASH;
  let allValid = true;

  for (const event of events) {
    const eventData = {
      run_id: event.run_id,
      sequence: event.sequence,
      event_type: event.event_type,
      timestamp: event.timestamp,
      actor: event.actor,
      payload_digest: event.payload_digest,
      previous_event_hash: event.previous_event_hash,
      event_hash: '',
      created_at: event.created_at
    };

    const canonicalEvent = canonicalizeEvent(eventData);
    const expectedHash = hash(canonicalEvent + previousHash);

    const hashMatches = expectedHash === event.event_hash;
    const chainMatches = event.previous_event_hash === previousHash;

    checks.push({
      name: `Event ${event.sequence} hash`,
      passed: hashMatches,
      detail: hashMatches ? undefined : `Expected ${expectedHash}, got ${event.event_hash}`
    });

    checks.push({
      name: `Event ${event.sequence} chain`,
      passed: chainMatches,
      detail: chainMatches ? undefined : `Expected previous ${previousHash}, got ${event.previous_event_hash}`
    });

    if (!hashMatches || !chainMatches) {
      allValid = false;
      tamperedEvents.push({
        sequence: event.sequence,
        expectedHash,
        actualHash: event.event_hash
      });
    }

    previousHash = event.event_hash;
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

  const eventHashes = events.map(e => e.event_hash);
  const merkleRoot = buildMerkleRoot(eventHashes);
  const finalChainHash = events.length > 0 ? events[events.length - 1].event_hash : GENESIS_HASH;

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

  return manifestData as z.infer<typeof RunManifestSchema>;
}

export async function verifyManifest(runId: string): Promise<z.infer<typeof VerifyResultSchema>> {
  const manifestResult = await query('SELECT * FROM run_manifests WHERE run_id = $1', [runId]);
  const manifest = manifestResult.rows[0];

  if (!manifest) {
    return {
      valid: false,
      runId,
      checks: [{ name: 'Manifest exists', passed: false, detail: 'No manifest found for run' }]
    };
  }

  const chainResult = await verifyHashChain(runId);
  const events = await getAuditEvents(runId);
  const eventHashes = events.map(e => e.event_hash);
  const computedMerkleRoot = buildMerkleRoot(eventHashes);
  const computedFinalHash = events.length > 0 ? events[events.length - 1].event_hash : GENESIS_HASH;

  const merkleMatches = computedMerkleRoot === manifest.merkle_root;
  const chainHashMatches = computedFinalHash === manifest.final_chain_hash;

  const { publicKey } = getSigningKey();
  const manifestData = {
    run_id: manifest.run_id,
    merkle_root: manifest.merkle_root,
    final_chain_hash: manifest.final_chain_hash,
    signature: '',
    public_key_id: manifest.public_key_id,
    event_count: manifest.event_count,
    policy_version: manifest.policy_version,
    model_adapter: manifest.model_adapter,
    created_at: manifest.created_at
  };
  const canonicalManifest = canonicalizeEvent(manifestData);
  const signatureValid = verify(manifest.signature, canonicalManifest, publicKey);

  const checks = [
    ...chainResult.checks,
    { name: 'Merkle root', passed: merkleMatches, detail: merkleMatches ? undefined : `Expected ${computedMerkleRoot}, got ${manifest.merkle_root}` },
    { name: 'Final chain hash', passed: chainHashMatches, detail: chainHashMatches ? undefined : `Expected ${computedFinalHash}, got ${manifest.final_chain_hash}` },
    { name: 'Signature valid', passed: signatureValid, detail: signatureValid ? undefined : 'Ed25519 signature verification failed' }
  ];

  const allValid = chainResult.valid && merkleMatches && chainHashMatches && signatureValid;

  return {
    valid: allValid,
    runId,
    checks,
    tamperedEvents: chainResult.tamperedEvents
  };
}

export async function getManifest(runId: string) {
  const result = await query('SELECT * FROM run_manifests WHERE run_id = $1', [runId]);
  return result.rows[0] || null;
}

export async function getSigningPublicKey(): Promise<string> {
  const { publicKey } = getSigningKey();
  return publicKey;
}