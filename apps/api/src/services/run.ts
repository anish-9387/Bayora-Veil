import { query, getClient } from '../db/client.js';
import { tenantId, isolated, principals } from '../security/context.js';
import { callCell } from './cells.js';
import { z } from 'zod';
import {
  RunSchema,
  RunStatus,
  CreateRunSchema,
  CreateRunInput,
  PayloadCommitmentSchema,
  SubmitPayloadInput,
  ObservationSchema,
  TargetRequestSchema,
  TargetResponseSchema,
  BlueDefenseInputSchema,
  BlueDefenseOutputSchema,
  LeakageExperimentConfigSchema,
  EventType,
  ActorRole,
  Observation,
  Run,
  PayloadCommitment
} from '@bayora/schemas';
import { buildAndSignManifest, appendAuditEvent } from './audit.js';
import { hash, generateRequestId } from '@bayora/crypto-utils';
import { randomUUID as uuidv4 } from 'node:crypto';

const VALID_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  CREATED: ['COMMITTED'],
  COMMITTED: ['RUNNING'],
  RUNNING: ['EVALUATED'],
  EVALUATED: ['CLOSED'],
  CLOSED: ['VERIFIED'],
  VERIFIED: []
};

function mapRunRow(row: any): Run {
  return {
    id: row.id,
    status: row.status,
    policyVersion: row.policy_version,
    modelAdapter: row.model_adapter,
    createdBy: row.created_by,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    config: row.config
  };
}

export async function createRun(input: CreateRunInput): Promise<Run> {
  const runId = uuidv4();
  const now = new Date().toISOString();

  await query(
    `INSERT INTO runs (id, status, policy_version, model_adapter, created_by, created_at, config, tenant_id)
     VALUES ($1, 'CREATED', $2, $3, $4, $5, $6, $7)`,
    [runId, input.policyVersion, input.modelAdapter, principals.getStore()?.userId || input.createdBy, now, JSON.stringify(input.config || {}), tenantId()]
  );

  await appendAuditEvent(runId, 'run_created', 'orchestrator', {
    runId,
    policyVersion: input.policyVersion,
    modelAdapter: input.modelAdapter,
    createdBy: principals.getStore()?.userId || input.createdBy
  });

  const run = await getRun(runId);
  if (!run) throw new Error('Failed to create run');
  return run;
}

export async function getRun(runId: string): Promise<Run | null> {
  const result = await query('SELECT * FROM runs WHERE id = $1 AND tenant_id = $2', [runId, tenantId()]);
  if (result.rows.length === 0) return null;
  return mapRunRow(result.rows[0]);
}

export async function listRuns(status?: RunStatus, limit = 50, offset = 0): Promise<Run[]> {
  let sql = 'SELECT * FROM runs WHERE tenant_id = $1';
  const params: any[] = [tenantId()];

  if (status) {
    sql += ' AND status = $2';
    params.push(status);
    sql += ' ORDER BY created_at DESC LIMIT $3 OFFSET $4';
    params.push(limit, offset);
  } else {
    sql += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
    params.push(limit, offset);
  }

  const result = await query(sql, params);
  return result.rows.map(mapRunRow);
}

export async function transitionRun(runId: string, newStatus: RunStatus): Promise<boolean> {
  const run = await getRun(runId);
  if (!run) return false;

  const allowed = VALID_TRANSITIONS[run.status] || [];
  if (!allowed.includes(newStatus)) {
    throw Object.assign(new Error(`Invalid transition from ${run.status} to ${newStatus}`), { status: 409 });
  }

  const now = new Date().toISOString();
  const updates: string[] = ['status = $2'];
  const params: any[] = [runId, newStatus];

  if (newStatus === 'CLOSED') {
    updates.push('closed_at = $3');
    params.push(now);
  }

  params.push(run.status);
  const updated = await query(`UPDATE runs SET ${updates.join(', ')} WHERE id = $1 AND status = $${params.length}`, params);
  if (updated.rowCount !== 1) throw new Error('Run changed; reload before retrying');


  return true;
}

export async function commitPayload(runId: string, payload: string): Promise<string> {
  const run = await getRun(runId);
  if (!run || !['CREATED', 'COMMITTED'].includes(run.status)) {
    throw new Error('Run must be in CREATED state to commit payload');
  }

  let commitmentHash = hash(payload);
  const existing = await getPayloadCommitment(runId);
  if (!isolated() && existing && existing.commitmentHash !== commitmentHash) throw Object.assign(new Error('Payload already committed'), { status: 409 });
  if (isolated()) await appendAuditEvent(runId, 'run_created', 'orchestrator', { runId, policyVersion: run.policyVersion, modelAdapter: run.modelAdapter, createdBy: run.createdBy });
  if (isolated()) {
    const result = await callCell('red', '/commit', { runId, payload });
    commitmentHash = z.string().regex(/^sha256:[0-9a-f]{64}$/).parse(result.commitmentHash);
  }

  if (!existing) await query(
    `INSERT INTO payload_commitments (run_id, commitment_hash, reveal_after_close)
     VALUES ($1, $2, true)`,
    [runId, commitmentHash]
  );

  if (!isolated() && !existing) await storeRawPayload(runId, payload, `payload_${runId}`);
  if (run.status === 'CREATED') await transitionRun(runId, 'COMMITTED');
  await appendAuditEvent(runId, 'payload_committed', 'red', { runId, commitmentHash });

  return commitmentHash;
}

export async function getPayloadCommitment(runId: string): Promise<PayloadCommitment | null> {
  const result = await query('SELECT * FROM payload_commitments WHERE run_id = $1', [runId]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    runId: row.run_id,
    commitmentHash: row.commitment_hash,
    createdAt: row.created_at,
    revealAfterClose: row.reveal_after_close
  };
}

export async function storeRawPayload(runId: string, payload: string, storageKey: string) {
  const digest = hash(payload);
  await query(
    `INSERT INTO evidence_artifacts (run_id, artifact_type, storage_key, digest, access_class, content)
     VALUES ($1, 'prompt', $2, $3, 'red_private', $4)`,
    [runId, storageKey, digest, JSON.stringify({ payload })]
  );
}

export async function storeTargetResponse(response: z.infer<typeof TargetResponseSchema>) {
  const digest = hash(response.response);
  await query(
    `INSERT INTO evidence_artifacts (run_id, artifact_type, storage_key, digest, access_class, content)
     VALUES ($1, 'response', $2, $3, 'target_private', $4)`,
    [response.runId, `response_${response.caseId}`, digest, JSON.stringify(response)]
  );
}

export async function storeDefenseRule(runId: string, rule: string, storageKey: string) {
  const digest = hash(rule);
  await query(
    `INSERT INTO evidence_artifacts (run_id, artifact_type, storage_key, digest, access_class, content)
     VALUES ($1, 'defense_rule', $2, $3, 'blue_private', $4)`,
    [runId, storageKey, digest, JSON.stringify({ rule })]
  );
}

export async function releaseObservation(
  runId: string,
  caseId: string,
  outcome: string,
  severity: string,
  category: string,
  confidence: number
): Promise<Observation> {
  const run = await getRun(runId);
  if (run?.status !== 'EVALUATED') throw new Error('Observations can only be released after evaluation and before closure');
  const evidence = await query("SELECT digest FROM evidence_artifacts WHERE run_id = $1 AND artifact_type = 'response' ORDER BY created_at DESC LIMIT 1", [runId]);
  if (!evidence.rows[0]) throw new Error('No target evidence available');
  const observation: Observation = {
    id: uuidv4(),
    runId,
    caseId,
    outcome: outcome as any,
    severity: severity as any,
    category: category as any,
    confidence: Math.max(0, Math.min(1, confidence)),
    evidenceDigest: evidence.rows[0].digest,
    releasedAt: new Date().toISOString(),
    releasedAfterPhase: 'evaluation_closed'
  };

  await query(
    `INSERT INTO observations (id, run_id, case_id, outcome, severity, category, confidence, evidence_digest, released_at, released_after_phase)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [observation.id, observation.runId, observation.caseId, observation.outcome, observation.severity,
     observation.category, observation.confidence, observation.evidenceDigest, observation.releasedAt, observation.releasedAfterPhase]
  );

  await appendAuditEvent(observation.runId, 'observation_released', 'observation-firewall', {
    runId: observation.runId,
    caseId: observation.caseId,
    outcome: observation.outcome,
    evidenceDigest: observation.evidenceDigest
  });

  return observation;
}

export async function getObservations(runId: string): Promise<Observation[]> {
  const result = await query('SELECT * FROM observations WHERE run_id = $1 ORDER BY released_at', [runId]);
  return result.rows.map((row: any) => ({
    id: row.id,
    runId: row.run_id,
    caseId: row.case_id,
    outcome: row.outcome,
    severity: row.severity,
    category: row.category,
    confidence: Number(row.confidence),
    evidenceDigest: row.evidence_digest,
    releasedAt: row.released_at,
    releasedAfterPhase: row.released_after_phase
  }));
}

export async function getEvidenceArtifacts(runId: string, accessClass?: string) {
  let sql = 'SELECT * FROM evidence_artifacts WHERE run_id = $1';
  const params: any[] = [runId];

  if (accessClass) {
    sql += ' AND access_class = $2';
    params.push(accessClass);
  }

  const result = await query(sql, params);
  return result.rows.map((row: any) => ({
    id: row.id,
    runId: row.run_id,
    artifactType: row.artifact_type,
    storageKey: row.storage_key,
    digest: row.digest,
    accessClass: row.access_class,
    createdAt: row.created_at
  }));
}

export async function startExecution(runId: string) {
  const run = await getRun(runId);
  if (run?.status !== 'COMMITTED') throw new Error('Commit the payload before execution');
  if (isolated()) {
    const commitment = await getPayloadCommitment(runId);
    try {
      await appendAuditEvent(runId, 'payload_committed', 'red', { runId, commitmentHash: commitment?.commitmentHash });
      await appendAuditEvent(runId, 'execution_started', 'orchestrator', { runId });
      const view = await callCell('red', '/execute', { runId, commitmentHash: commitment?.commitmentHash, modelAdapter: run.modelAdapter });
      const allowed = z.object({ runId: z.literal(runId), caseId: z.literal('case-001'), outcome: z.literal('not_tested'), severity: z.literal('low'), category: z.literal('not_tested'), confidence: z.literal(0), evidenceDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict().parse(view);
      const defense = z.object({ action: z.literal('flag'), ruleDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict().parse(await callCell('blue', '/defend', { runId, observation: allowed }));
      await appendAuditEvent(runId, 'target_response', 'target', { digest: allowed.evidenceDigest });
      await appendAuditEvent(runId, 'defense_applied', 'blue', { action: defense.action, ruleDigest: defense.ruleDigest });
      await query(`INSERT INTO evidence_artifacts (run_id, artifact_type, storage_key, digest, access_class)
        SELECT $1, 'response', $2, $3, 'target_private' WHERE NOT EXISTS (SELECT 1 FROM evidence_artifacts WHERE run_id = $1 AND artifact_type = 'response')`, [runId, `red-cell:${runId}`, allowed.evidenceDigest]);
      await transitionRun(runId, 'RUNNING');
      return;
    } catch (error) {
      await query('UPDATE runs SET failure_count = failure_count + 1, timeout_count = timeout_count + $2 WHERE id = $1', [runId, Number((error as Error).name === 'TimeoutError')]);
      throw error;
    }
  }
  const stored = await query("SELECT content FROM evidence_artifacts WHERE run_id = $1 AND artifact_type = 'prompt' ORDER BY created_at DESC LIMIT 1", [runId]);
  const payload = stored.rows[0]?.content?.payload;
  if (typeof payload !== 'string') throw new Error('Payload unavailable; create a new run and commit again');
  const commitment = await getPayloadCommitment(runId);
  if (hash(payload) !== commitment?.commitmentHash) throw new Error('Payload commitment mismatch');
  const result = await fetch(`${process.env.TARGET_ADAPTER_URL || 'http://127.0.0.1:8000'}/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run_id: runId, case_id: 'case-001', prompt: payload, model_adapter: run.modelAdapter, timeout_ms: 30000 }),
    signal: AbortSignal.timeout(30000)
  });
  if (!result.ok) throw new Error(`Target adapter returned ${result.status}`);
  const raw = await result.json() as Record<string, unknown>;
  const response = TargetResponseSchema.parse({ runId: raw.run_id, caseId: raw.case_id, response: raw.response, tokensUsed: raw.tokens_used, latencyMs: raw.latency_ms, metadata: raw.metadata });
  if (response.runId !== runId || response.caseId !== 'case-001') throw new Error('Target response identity mismatch');
  await transitionRun(runId, 'RUNNING');
  await appendAuditEvent(runId, 'execution_started', 'orchestrator', { runId });
  await storeTargetResponse(response);
  await appendAuditEvent(runId, 'target_response', 'target', { digest: hash(response.response), latencyBucketMs: Math.floor(response.latencyMs / 100) * 100 });
  const rule = 'Flag unassessed outcomes; allow only a safe outcome';
  const sanitized = { outcome: 'not_tested', evidenceDigest: hash(response.response) };
  const action = sanitized.outcome === 'safe' ? 'allow' : 'flag';
  await storeDefenseRule(runId, rule, `defense_${runId}`);
  await appendAuditEvent(runId, 'defense_applied', 'blue', { action, ruleDigest: hash(rule), observation: sanitized });
}

export async function completeEvaluation(runId: string) {
  const run = await getRun(runId);
  if (run?.status === 'RUNNING') await transitionRun(runId, 'EVALUATED');
  else if (run?.status !== 'EVALUATED') throw new Error('Execute before evaluating');
  const observations = await getObservations(runId);
  if (!observations.length) await releaseObservation(runId, 'case-001', 'not_tested', 'low', 'not_tested', 0);
  else if (isolated()) await appendAuditEvent(runId, 'observation_released', 'observation-firewall', { runId, caseId: 'case-001', outcome: observations[0].outcome, evidenceDigest: observations[0].evidenceDigest });
}

export async function closeRun(runId: string) {
  const run = await getRun(runId);
  if (run && ['CLOSED', 'VERIFIED'].includes(run.status)) {
    const { getManifest } = await import('./audit.js');
    if (await getManifest(runId)) return;
  }
  if (!run || !['EVALUATED', 'CLOSED'].includes(run.status)) throw new Error('Evaluate before closing');
  if (isolated()) {
    await callCell('red', '/freeze', { runId });
    await callCell('blue', '/freeze', { runId });
  }
  if (run.status === 'EVALUATED') await transitionRun(runId, 'CLOSED');
  await appendAuditEvent(runId, 'run_closed', 'orchestrator', { runId });
  await buildAndSignManifest(runId);
}

export async function createLeakageExperiment(config: z.infer<typeof LeakageExperimentConfigSchema>) {
  const experimentId = uuidv4();
  await query(
    `INSERT INTO experiments (id, type, config, status, started_at, tenant_id, run_id)
     VALUES ($1, $2, $3, 'RUNNING', $4, $5, $6)`,
    [experimentId, config.type, JSON.stringify(config.config), new Date().toISOString(), tenantId(), config.runId]
  );
  return experimentId;
}

export async function completeLeakageExperiment(experimentId: string, results: Array<{ metricName: string; metricValue: number; sampleCount: number; method: string }>) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const result of results) {
      await client.query(`INSERT INTO experiment_results (experiment_id, metric_name, metric_value, sample_count, method)
        VALUES ($1, $2, $3, $4, $5)`, [experimentId, result.metricName, result.metricValue, result.sampleCount, result.method]);
    }
    await client.query("UPDATE experiments SET status = 'COMPLETED', finished_at = NOW() WHERE id = $1", [experimentId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function getExperimentResults(experimentId: string) {
  const result = await query('SELECT * FROM experiment_results WHERE experiment_id = $1', [experimentId]);
  return result.rows.map(row => ({ experimentId: row.experiment_id, metricName: row.metric_name,
    metricValue: Number(row.metric_value), sampleCount: Number(row.sample_count), method: row.method, createdAt: row.created_at }));
}
