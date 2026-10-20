import express from 'express';
import { z } from 'zod';
import pg from 'pg';
const { Pool } = pg;
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import { hash, canonicalizeEvent, buildMerkleRoot, generateRequestId, sign, verify, getSigningKey } from '@bayora/crypto-utils';
import { AuditEventSchema, EventType, ActorRole, RunManifestSchema, VerifyResultSchema } from '@bayora/schemas';
import { randomBytes } from '@noble/hashes/utils';

const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });

const app = express();
const PORT = parseInt(process.env.PORT || '3005', 10);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'bayora_veil',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 10
});

const GENESIS_HASH = 'sha256:' + '0'.repeat(64);
const SIGNING_KEY_ID = 'bayora-eval-key-001';

let signingKeyPair: { privateKey: string; publicKey: string } | null = null;

function getSigningKeyPair() {
  if (!signingKeyPair) {
    const privateKey = Buffer.from(randomBytes(32)).toString('hex');
    const { ed25519 } = await import('@noble/ed25519');
    const publicKey = Buffer.from(ed25519.getPublicKey(Buffer.from(privateKey, 'hex'))).toString('hex');
    signingKeyPair = { privateKey, publicKey };
  }
  return signingKeyPair;
}

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  res.setHeader('x-request-id', requestId);
  (req as any).requestId = requestId;
  next();
});

app.use((req, res, next) => {
  const serviceId = req.headers['x-service-id'];
  const role = req.headers['x-service-role'] as ActorRole;
  if (!serviceId || !['audit-service', 'orchestrator', 'auditor', 'observation-firewall', 'red', 'blue', 'target'].includes(role)) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Audit service access only', requestId: (req as any).requestId }
    });
  }
  next();
});

const RunIdParamSchema = z.object({ id: z.string().uuid() });

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'audit-service', version: '0.1.0', timestamp: new Date().toISOString() });
});

app.post('/runs/:id/events', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const eventSchema = z.object({
    eventType: z.enum([
      'run_created', 'payload_committed', 'execution_started', 'target_response',
      'defense_applied', 'observation_released', 'evidence_stored', 'run_closed',
      'manifest_signed', 'verification_requested', 'verification_completed',
      'access_denied', 'leakage_experiment_started', 'leakage_experiment_completed'
    ]),
    actor: z.enum(['red', 'blue', 'target', 'orchestrator', 'auditor', 'observation-firewall', 'audit-service']),
    payload: z.record(z.unknown())
  });

  const bodyResult = eventSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid event', details: bodyResult.error.flatten(), requestId: (req as any).requestId } });
  }

  const runId = parseResult.data.id;
  const { eventType, actor, payload } = bodyResult.data;

  const client = await pool.connect();
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

    logger.info('event_appended', { runId, sequence, eventType, eventHash });

    res.json({ success: true, data: { eventHash, sequence }, requestId: (req as any).requestId });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('event_append_failed', { error: String(error) });
    res.status(500).json({ success: false, error: { code: 'APPEND_FAILED', message: String(error), requestId: (req as any).requestId } });
  } finally {
    client.release();
  }
});

app.get('/runs/:id/events', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const result = await pool.query(
    'SELECT * FROM audit_events WHERE run_id = $1 ORDER BY sequence ASC',
    [parseResult.data.id]
  );

  res.json({ success: true, data: result.rows, requestId: (req as any).requestId });
});

app.post('/runs/:id/verify', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const runId = parseResult.data.id;
  const eventsResult = await pool.query('SELECT * FROM audit_events WHERE run_id = $1 ORDER BY sequence ASC', [runId]);
  const events = eventsResult.rows;

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
    passed: events.every((e: any, i: number) => e.sequence === i + 1),
    detail: events.some((e: any, i: number) => e.sequence !== i + 1) ? 'Sequence gap detected' : undefined
  });

  if (events.some((e: any, i: number) => e.sequence !== i + 1)) {
    allValid = false;
  }

  res.json({
    success: true,
    data: { valid: allValid, runId, checks, tamperedEvents: tamperedEvents.length > 0 ? tamperedEvents : undefined },
    requestId: (req as any).requestId
  });
});

app.post('/runs/:id/manifest', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const runId = parseResult.data.id;
  const eventsResult = await pool.query('SELECT * FROM audit_events WHERE run_id = $1 ORDER BY sequence ASC', [runId]);
  const events = eventsResult.rows;

  const runResult = await pool.query('SELECT * FROM runs WHERE id = $1', [runId]);
  const run = runResult.rows[0];

  if (!run) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Run not found', requestId: (req as any).requestId } });
  }

  const eventHashes = events.map((e: any) => e.event_hash);
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
  const { privateKey } = getSigningKeyPair();
  const signature = sign(canonicalManifest, privateKey);
  manifestData.signature = signature;

  await pool.query(
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

  logger.info('manifest_signed', { runId, merkleRoot, finalChainHash });

  res.json({ success: true, data: manifestData, requestId: (req as any).requestId });
});

app.get('/runs/:id/manifest', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const result = await pool.query('SELECT * FROM run_manifests WHERE run_id = $1', [parseResult.data.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Manifest not found', requestId: (req as any).requestId } });
  }

  res.json({ success: true, data: result.rows[0], requestId: (req as any).requestId });
});

app.post('/runs/:id/manifest/verify', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const runId = parseResult.data.id;
  const manifestResult = await pool.query('SELECT * FROM run_manifests WHERE run_id = $1', [runId]);
  const manifest = manifestResult.rows[0];

  if (!manifest) {
    return res.json({ success: true, data: { valid: false, runId, checks: [{ name: 'Manifest exists', passed: false, detail: 'No manifest found' }] }, requestId: (req as any).requestId });
  }

  const chainResult = await fetch(`http://localhost:${PORT}/runs/${runId}/verify`).then(r => r.json());
  const eventsResult = await pool.query('SELECT * FROM audit_events WHERE run_id = $1 ORDER BY sequence ASC', [runId]);
  const events = eventsResult.rows;

  const eventHashes = events.map((e: any) => e.event_hash);
  const computedMerkleRoot = buildMerkleRoot(eventHashes);
  const computedFinalHash = events.length > 0 ? events[events.length - 1].event_hash : GENESIS_HASH;

  const merkleMatches = computedMerkleRoot === manifest.merkle_root;
  const chainHashMatches = computedFinalHash === manifest.final_chain_hash;

  const { publicKey } = getSigningKeyPair();
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
    ...(chainResult.data?.checks || []),
    { name: 'Merkle root', passed: merkleMatches, detail: merkleMatches ? undefined : `Expected ${computedMerkleRoot}, got ${manifest.merkle_root}` },
    { name: 'Final chain hash', passed: chainHashMatches, detail: chainHashMatches ? undefined : `Expected ${computedFinalHash}, got ${manifest.final_chain_hash}` },
    { name: 'Signature valid', passed: signatureValid, detail: signatureValid ? undefined : 'Ed25519 signature verification failed' }
  ];

  const allValid = (chainResult.data?.valid ?? false) && merkleMatches && chainHashMatches && signatureValid;

  res.json({
    success: true,
    data: { valid: allValid, runId, checks, tamperedEvents: chainResult.data?.tamperedEvents },
    requestId: (req as any).requestId
  });
});

app.get('/manifest/public-key', async (req, res) => {
  const { publicKey } = getSigningKeyPair();
  res.json({ success: true, data: { publicKey, keyId: SIGNING_KEY_ID }, requestId: (req as any).requestId });
});

app.listen(PORT, () => {
  logger.info(`Audit service listening on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});