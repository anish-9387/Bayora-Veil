import { query, getClient } from '../db/client.js';
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
  LeakageExperimentConfigSchema
} from '@bayora/schemas';
import { appendAuditEvent, EventType, ActorRole } from './audit.js';
import { hash, generateRequestId } from '@bayora/crypto-utils';
import { v4 as uuidv4 } from 'uuid';

const VALID_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  CREATED: ['COMMITTED'],
  COMMITTED: ['RUNNING'],
  RUNNING: ['EVALUATED'],
  EVALUATED: ['CLOSED'],
  CLOSED: ['VERIFIED'],
  VERIFIED: []
};

export async function createRun(input: CreateRunInput) {
  const runId = uuidv4();
  const now = new Date().toISOString();

  await query(
    `INSERT INTO runs (id, status, policy_version, model_adapter, created_by, created_at, config)
     VALUES ($1, 'CREATED', $2, $3, $4, $5, $6)`,
    [runId, input.policyVersion, input.modelAdapter, input.createdBy, now, JSON.stringify(input.config || {})]
  );

  await appendAuditEvent(runId, 'run_created', 'orchestrator', {
    runId,
    policyVersion: input.policyVersion,
    modelAdapter: input.modelAdapter,
    createdBy: input.createdBy
  });

  return getRun(runId);
}

export async function getRun(runId: string) {
  const result = await query('SELECT * FROM runs WHERE id = $1', [runId]);
  return result.rows[0] ? RunSchema.parse(result.rows[0]) : null;
}

export async function listRuns(status?: RunStatus, limit = 50, offset = 0) {
  let sql = 'SELECT * FROM runs';
  const params: any[] = [];

  if (status) {
    sql += ' WHERE status = $1';
    params.push(status);
    sql += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
    params.push(limit, offset);
  } else {
    sql += ' ORDER BY created_at DESC LIMIT $1 OFFSET $2';
    params.push(limit, offset);
  }

  const result = await query(sql, params);
  return result.rows.map(r => RunSchema.parse(r));
}

export async function transitionRun(runId: string, newStatus: RunStatus): Promise<boolean> {
  const run = await getRun(runId);
  if (!run) return false;

  const allowed = VALID_TRANSITIONS[run.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid transition from ${run.status} to ${newStatus}`);
  }

  const now = new Date().toISOString();
  const updates: string[] = ['status = $2'];
  const params: any[] = [runId, newStatus];

  if (newStatus === 'CLOSED') {
    updates.push('closed_at = $3');
    params.push(now);
  }

  await query(`UPDATE runs SET ${updates.join(', ')} WHERE id = $1`, params);

  await appendAuditEvent(runId, 'run_closed', 'orchestrator', { runId, newStatus, previousStatus: run.status });
  return true;
}

export async function commitPayload(runId: string, payload: string): Promise<string> {
  const run = await getRun(runId);
  if (!run || run.status !== 'CREATED') {
    throw new Error('Run must be in CREATED state to commit payload');
  }

  const commitmentHash = hash(payload);

  await query(
    `INSERT INTO payload_commitments (run_id, commitment_hash, reveal_after_close)
     VALUES ($1, $2, true)`,
    [runId, commitmentHash]
  );

  await transitionRun(runId, 'COMMITTED');
  await appendAuditEvent(runId, 'payload_committed', 'red', { runId, commitmentHash });

  return commitmentHash;
}

export async function getPayloadCommitment(runId: string) {
  const result = await query('SELECT * FROM payload_commitments WHERE run_id = $1', [runId]);
  return result.rows[0] ? PayloadCommitmentSchema.parse(result.rows[0]) : null;
}

export async function storeRawPayload(runId: string, payload: string, storageKey: string) {
  const digest = hash(payload);
  await query(
    `INSERT INTO evidence_artifacts (run_id, artifact_type, storage_key, digest, access_class)
     VALUES ($1, 'prompt', $2, $3, 'red_private')`,
    [runId, storageKey, digest]
  );
}

export async function storeTargetResponse(response: z.infer<typeof TargetResponseSchema>) {
  const digest = hash(response.response);
  await query(
    `INSERT INTO evidence_artifacts (run_id, artifact_type, storage_key, digest, access_class)
     VALUES ($1, 'response', $2, $3, 'target_private')`,
    [response.runId, `response_${response.caseId}`, digest]
  );
}

export async function storeDefenseRule(runId: string, rule: string, storageKey: string) {
  const digest = hash(rule);
  await query(
    `INSERT INTO evidence_artifacts (run_id, artifact_type, storage_key, digest, access_class)
     VALUES ($1, 'defense_rule', $2, $3, 'blue_private')`,
    [runId, storageKey, digest]
  );
}

export async function releaseObservation(observation: z.infer<typeof ObservationSchema>) {
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
}

export async function getObservations(runId: string) {
  const result = await query('SELECT * FROM observations WHERE run_id = $1 ORDER BY released_at', [runId]);
  return result.rows.map(r => ObservationSchema.parse(r));
}

export async function getEvidenceArtifacts(runId: string, accessClass?: string) {
  let sql = 'SELECT * FROM evidence_artifacts WHERE run_id = $1';
  const params: any[] = [runId];

  if (accessClass) {
    sql += ' AND access_class = $2';
    params.push(accessClass);
  }

  const result = await query(sql, params);
  return result.rows;
}

export async function startExecution(runId: string) {
  await transitionRun(runId, 'RUNNING');
  await appendAuditEvent(runId, 'execution_started', 'orchestrator', { runId });
}

export async function completeEvaluation(runId: string) {
  await transitionRun(runId, 'EVALUATED');
  await appendAuditEvent(runId, 'evaluation_completed', 'orchestrator', { runId });
}

export async function closeRun(runId: string) {
  await transitionRun(runId, 'CLOSED');
  await appendAuditEvent(runId, 'run_closed', 'orchestrator', { runId });
}

export async function createLeakageExperiment(config: z.infer<typeof LeakageExperimentConfigSchema>) {
  const experimentId = uuidv4();
  await query(
    `INSERT INTO experiments (id, type, config, status, started_at)
     VALUES ($1, $2, $3, 'RUNNING', $4)`,
    [experimentId, config.type, JSON.stringify(config.config), new Date().toISOString()]
  );
  return experimentId;
}

export async function completeLeakageExperiment(experimentId: string, results: Array<{ metricName: string; metricValue: number; sampleCount: number; method: string }>) {
  await query('UPDATE experiments SET status = $1, finished_at = $2 WHERE id = $3', ['COMPLETED', new Date().toISOString(), experimentId]);

  for (const result of results) {
    await query(
      `INSERT INTO experiment_results (experiment_id, metric_name, metric_value, sample_count, method)
       VALUES ($1, $2, $3, $4, $5)`,
      [experimentId, result.metricName, result.metricValue, result.sampleCount, result.method]
    );
  }
}

export async function getExperimentResults(experimentId: string) {
  const result = await query('SELECT * FROM experiment_results WHERE experiment_id = $1', [experimentId]);
  return result.rows;
}