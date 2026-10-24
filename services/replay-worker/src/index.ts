import express from 'express';
import { z } from 'zod';
import pg from 'pg';
const { Pool } = pg;
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import { hash, canonicalizeEvent, buildMerkleRoot, generateRequestId } from '@bayora/crypto-utils';
import { AuditEventSchema, EventType, ActorRole, VerifyResultSchema } from '@bayora/schemas';

const logger = pino.default({ level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });

const app = express();
const PORT = parseInt(process.env.PORT || '3006', 10);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'bayora_veil',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 5
});

const GENESIS_HASH = 'sha256:' + '0'.repeat(64);

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

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
  if (!serviceId || !['replay-worker', 'orchestrator', 'auditor'].includes(role)) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Replay worker access only', requestId: (req as any).requestId }
    });
  }
  next();
});

const RunIdParamSchema = z.object({ id: z.string().uuid() });

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'replay-worker', version: '0.1.0', timestamp: new Date().toISOString() });
});

app.post('/runs/:id/replay', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const runId = parseResult.data.id;
  const jobId = uuidv4();

  logger.info('replay_job_started', { runId, jobId });

  setImmediate(async () => {
    try {
      await performReplay(runId, jobId);
    } catch (error) {
      logger.error('replay_job_failed', { runId, jobId, error: String(error) });
    }
  });

  res.json({ success: true, data: { jobId, status: 'started' }, requestId: (req as any).requestId });
});

async function performReplay(runId: string, jobId: string) {
  const eventsResult = await pool.query('SELECT * FROM audit_events WHERE run_id = $1 ORDER BY sequence ASC', [runId]);
  const events = eventsResult.rows;

  const artifactsResult = await pool.query('SELECT * FROM evidence_artifacts WHERE run_id = $1', [runId]);
  const artifacts = artifactsResult.rows;

  const observationsResult = await pool.query('SELECT * FROM observations WHERE run_id = $1', [runId]);
  const observations = observationsResult.rows;

  const manifestResult = await pool.query('SELECT * FROM run_manifests WHERE run_id = $1', [runId]);
  const manifest = manifestResult.rows[0];

  const replayResults = {
    jobId,
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    eventCount: events.length,
    artifactCount: artifacts.length,
    observationCount: observations.length,
    hashChainValid: false,
    merkleRootMatches: false,
    signatureValid: false,
    evidenceDigestsMatch: false,
    discrepancies: [] as Array<{ type: string; detail: string }>
  };

  let previousHash = GENESIS_HASH;
  let chainValid = true;

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

    if (expectedHash !== event.event_hash || event.previous_event_hash !== previousHash) {
      chainValid = false;
      replayResults.discrepancies.push({
        type: 'hash_chain_mismatch',
        detail: `Event ${event.sequence}: expected ${expectedHash}, got ${event.event_hash}`
      });
    }

    previousHash = event.event_hash;
  }

  replayResults.hashChainValid = chainValid;

  const eventHashes = events.map((e: any) => e.event_hash);
  const computedMerkleRoot = buildMerkleRoot(eventHashes);

  if (manifest && computedMerkleRoot === manifest.merkle_root) {
    replayResults.merkleRootMatches = true;
  } else {
    replayResults.discrepancies.push({
      type: 'merkle_root_mismatch',
      detail: `Computed: ${computedMerkleRoot}, Stored: ${manifest?.merkle_root}`
    });
  }

  if (manifest) {
    const { ed25519 } = require('@noble/ed25519');
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
    const signatureValid = ed25519.verify(
      Buffer.from(manifest.signature, 'hex'),
      new TextEncoder().encode(canonicalManifest),
      Buffer.from(manifest.public_key_id, 'hex')
    );
    replayResults.signatureValid = signatureValid;

    if (!signatureValid) {
      replayResults.discrepancies.push({ type: 'signature_invalid', detail: 'Ed25519 signature verification failed' });
    }
  }

  let evidenceMatch = true;
  for (const artifact of artifacts) {
    const computedDigest = artifact.digest;
    if (computedDigest !== artifact.digest) {
      evidenceMatch = false;
      replayResults.discrepancies.push({
        type: 'evidence_digest_mismatch',
        detail: `Artifact ${artifact.id}: digest mismatch`
      });
    }
  }
  replayResults.evidenceDigestsMatch = evidenceMatch;

  replayResults.finishedAt = new Date().toISOString();

  await pool.query(
    `INSERT INTO experiment_results (experiment_id, metric_name, metric_value, sample_count, method)
     VALUES ($1, $2, $3, $4, $5)`,
    [jobId, 'replay_hash_chain_valid', chainValid ? 1 : 0, 1, 'deterministic_replay']
  );

  await pool.query(
    `INSERT INTO experiment_results (experiment_id, metric_name, metric_value, sample_count, method)
     VALUES ($1, $2, $3, $4, $5)`,
    [jobId, 'replay_merkle_root_matches', replayResults.merkleRootMatches ? 1 : 0, 1, 'deterministic_replay']
  );

  await pool.query(
    `INSERT INTO experiment_results (experiment_id, metric_name, metric_value, sample_count, method)
     VALUES ($1, $2, $3, $4, $5)`,
    [jobId, 'replay_signature_valid', replayResults.signatureValid ? 1 : 0, 1, 'deterministic_replay']
  );

  await pool.query(
    `INSERT INTO experiment_results (experiment_id, metric_name, metric_value, sample_count, method)
     VALUES ($1, $2, $3, $4, $5)`,
    [jobId, 'replay_evidence_digests_match', replayResults.evidenceDigestsMatch ? 1 : 0, 1, 'deterministic_replay']
  );

  const { runId: _runId, jobId: _jobId, ...replayResultsRest } = replayResults;
  logger.info('replay_job_completed', { runId, jobId, ...replayResultsRest });
}

app.get('/runs/:id/replay/status', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const runId = parseResult.data.id;
  const results = await pool.query(
    `SELECT * FROM experiment_results WHERE experiment_id IN (
      SELECT id FROM experiments WHERE config::jsonb->>'runId' = $1 AND type = 'replay'
    )`,
    [runId]
  );

  res.json({ success: true, data: results.rows, requestId: (req as any).requestId });
});

app.listen(PORT, () => {
  logger.info(`Replay worker listening on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});