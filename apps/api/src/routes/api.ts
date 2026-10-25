import { query } from '../db/client.js';
import { isolated, tenantId } from '../security/context.js';
import { callCell } from '../services/cells.js';
import { lockRun, rateLimit, workBudget } from '../security/limits.js';
import { runLeakageExperiment } from '../services/experiments.js';
import { Router, Request, Response, NextFunction } from 'express';
import { validateBody, validateParams } from '../middleware/validate.js';
import { requireCapability, requireRole } from '../middleware/auth.js';
import { z } from 'zod';
import {
  CreateRunSchema,
  RunStatus,
  SubmitPayloadSchema,
  TargetRequestSchema,
  BlueDefenseInputSchema,
  LeakageExperimentConfigSchema,
  ObservationSchema,
  RunSchema,
  ActorRole
} from '@bayora/schemas';
import {
  createRun,
  getRun,
  listRuns,
  transitionRun,
  commitPayload,
  getPayloadCommitment,
  startExecution,
  completeEvaluation,
  closeRun,
  releaseObservation,
  getObservations,
  getEvidenceArtifacts,
  storeTargetResponse,
  storeDefenseRule,
  createLeakageExperiment,
  completeLeakageExperiment,
  getExperimentResults
} from '../services/run.js';
import { buildAndSignManifest, verifyManifest, getSigningPublicKey, appendAuditEvent, getManifest, getAuditEvents, verifyEventCopy } from '../services/audit.js';
import { observationFirewall } from '../services/firewall.js';
import { randomUUID as uuidv4 } from 'node:crypto';

const router: Router = Router();

const RunIdParamSchema = z.object({ id: z.string().uuid() });

// Type-safe role arrays
const orchestratorRoles: ActorRole[] = ['orchestrator'];
const auditorRoles: ActorRole[] = ['auditor', 'orchestrator'];
const allRoles: ActorRole[] = ['orchestrator', 'auditor', 'red', 'blue', 'target', 'observation-firewall', 'audit-service'];

// Helper to wrap async handlers with proper error handling
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => 
  (req: Request, res: Response, next: NextFunction) => {
    let delegated = false;
    Promise.resolve(fn(req, res, error => { delegated = true; next(error); })).catch(next)
      .finally(() => { if (!delegated) res.locals.releaseRun?.(); });
  };
router.use(['/runs/:id/execute', '/runs/:id/replay', '/experiments/leakage'], (req, res, next) => {
  if (req.method === 'POST') void workBudget(req, res, next).catch(next); else next();
});

router.use('/runs/:id', validateParams(RunIdParamSchema), asyncHandler(async (req, res, next) => {
  if (!await getRun(req.params.id)) {
    await query('INSERT INTO access_denials (run_id, actor, route, tenant_id) VALUES ($1, $2, $3, $4)', [null, req.identity?.role || 'unknown', 'tenant_scope', tenantId()]);
    return res.status(403).json({ success: false, error: { message: 'Access denied' } });
  }
  next();
}), (req, res, next) => { void lockRun(req, res, next).catch(next); });

router.get('/metrics', requireRole(['orchestrator', 'auditor']), asyncHandler(async (_req, res) => {
  const runs = await query('SELECT status, count(*)::int AS count FROM runs WHERE tenant_id = $1 GROUP BY status', [tenantId()]);
  const failures = await query('SELECT COALESCE(sum(failure_count), 0)::int AS failures, COALESCE(sum(timeout_count), 0)::int AS timeouts FROM runs WHERE tenant_id = $1', [tenantId()]);
  const denials = await query('SELECT count(*)::int AS count FROM access_denials WHERE tenant_id = $1', [tenantId()]);
  const latency = await query("SELECT count(*)::int AS samples, percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95 FROM request_metrics WHERE tenant_id = $1 AND created_at > NOW() - interval '24 hours'", [tenantId()]);
  const evidence = await query("SELECT count(*)::int AS attempts, count(*) FILTER (WHERE granted AND phase NOT IN ('CLOSED', 'VERIFIED'))::int AS premature FROM evidence_access WHERE tenant_id = $1", [tenantId()]);
  res.json({ success: true, data: { runs: runs.rows, ...failures.rows[0], denied: denials.rows[0].count, latency: latency.rows[0], evidence: evidence.rows[0] } });
}));

router.use('/runs/:id', asyncHandler(async (req, res, next) => {
  if (req.method !== 'POST' || ['/verify', '/tamper-check', '/manifest/sign', '/replay', '/close'].includes(req.path)) return next();
  const parsed = RunIdParamSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ success: false, error: { message: 'Invalid run ID' } });
  const run = await getRun(parsed.data.id);
  if (!run) return res.status(404).json({ success: false, error: { message: 'Run not found' } });
  if (['CLOSED', 'VERIFIED'].includes(run.status)) return res.status(409).json({ success: false, error: { message: 'Closed runs are immutable' } });
  next();
}));

router.get('/runs/:id/commitment', requireRole(allRoles), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getPayloadCommitment(req.params.id) });
}));
router.get('/runs/:id/red-payload', requireRole('red'), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  if (isolated()) return res.json({ success: true, data: await callCell('red', '/payload', { runId: req.params.id }) });
  const result = await query("SELECT content FROM evidence_artifacts WHERE run_id = $1 AND artifact_type = 'prompt'", [req.params.id]);
  res.json({ success: true, data: result.rows.map(row => row.content) });
}));
router.get('/runs/:id/blue-rules', requireRole('blue'), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  if (isolated()) return res.json({ success: true, data: await callCell('blue', '/rules', { runId: req.params.id }) });
  const result = await query("SELECT content FROM evidence_artifacts WHERE run_id = $1 AND artifact_type = 'defense_rule'", [req.params.id]);
  res.json({ success: true, data: result.rows.map(row => row.content) });
}));
router.get('/runs/:id/audit', requireRole(auditorRoles), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getAuditEvents(req.params.id) });
}));
router.get('/runs/:id/bundle', requireRole(auditorRoles), asyncHandler(async (req, res) => {
  const manifest = await getManifest(req.params.id);
  if (!manifest) return res.status(409).json({ success: false, error: { message: 'Close and seal the run before export' } });
  res.json({ success: true, data: { manifest, events: await getAuditEvents(req.params.id), publicKey: await getSigningPublicKey() } });
}));
router.post('/runs/:id/tamper-check', requireRole(auditorRoles), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  const events = await getAuditEvents(req.params.id);
  if (!events.length) return res.status(400).json({ success: false, error: { message: 'No events to verify' } });
  const original = verifyEventCopy(req.params.id, events);
  const copy = events.map(event => ({ ...event }));
  copy[0].payloadDigest = 'sha256:' + 'f'.repeat(64);
  res.json({ success: true, data: { original, tampered: verifyEventCopy(req.params.id, copy), deleted: verifyEventCopy(req.params.id, events.filter((_, i) => i !== 1)), reordered: verifyEventCopy(req.params.id, events.slice().reverse()) } });
}));

router.post('/runs', requireRole(orchestratorRoles), validateBody(CreateRunSchema), asyncHandler(async (req, res) => {
  const run = await createRun(req.body);
  res.status(201).json({ success: true, data: run, requestId: req.requestId });
}));

router.get('/runs', requireRole(['orchestrator', 'auditor', 'red', 'blue']), asyncHandler(async (req, res) => {
  const { status, limit, offset } = z.object({ status: z.enum(['CREATED', 'COMMITTED', 'RUNNING', 'EVALUATED', 'CLOSED', 'VERIFIED']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(100000).default(0) }).parse(req.query);
  const runs = await listRuns(status, limit, offset);
  res.json({ success: true, data: runs, requestId: req.requestId });
}));

router.get('/runs/:id', requireRole(allRoles), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  const run = await getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Run not found', requestId: req.requestId }, requestId: req.requestId });
  }
  res.json({ success: true, data: run, requestId: req.requestId });
}));

router.post('/runs/:id/commit', requireRole('red'), validateParams(RunIdParamSchema), validateBody(SubmitPayloadSchema), asyncHandler(async (req, res) => {
  const { payload } = req.body;
  const commitmentHash = await commitPayload(req.params.id, payload);
  res.json({ success: true, data: { commitmentHash }, requestId: req.requestId });
}));

router.post('/runs/:id/execute', requireRole('orchestrator'), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  await startExecution(req.params.id);
  res.json({ success: true, data: { status: 'RUNNING' }, requestId: req.requestId });
}));

router.post('/runs/:id/evaluate', requireRole('orchestrator'), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  await completeEvaluation(req.params.id);
  observationFirewall.setRunPhase(req.params.id, 'evaluation_closed');
  res.json({ success: true, data: { status: 'EVALUATED' }, requestId: req.requestId });
}));

router.post('/runs/:id/close', requireRole('orchestrator'), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  await closeRun(req.params.id);
  observationFirewall.setRunPhase(req.params.id, 'closed');
  res.json({ success: true, data: { status: 'CLOSED' }, requestId: req.requestId });
}));

router.get('/runs/:id/observations', requireRole(['orchestrator', 'auditor', 'blue']), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  const observations = await getObservations(req.params.id);
  res.json({ success: true, data: observations, requestId: req.requestId });
}));

router.get('/runs/:id/evidence', requireRole('auditor'), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  const run = await getRun(req.params.id);
  await query('INSERT INTO evidence_access (tenant_id, run_id, phase, granted) VALUES ($1, $2, $3, $4)', [tenantId(), req.params.id, run?.status || 'UNKNOWN', !!run && ['CLOSED', 'VERIFIED'].includes(run.status)]);
  if (!run || (run.status !== 'CLOSED' && run.status !== 'VERIFIED')) {
    await query('INSERT INTO access_denials (run_id, actor, route, tenant_id) VALUES ($1, $2, $3, $4)', [req.params.id, 'auditor', 'premature_evidence', tenantId()]);
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Evidence only accessible after run closure', requestId: req.requestId }, requestId: req.requestId });
  }

  if (isolated()) {
    const red = await callCell<any[]>('red', '/evidence', { runId: req.params.id });
    const blue = await callCell<any[]>('blue', '/evidence', { runId: req.params.id });
    return res.json({ success: true, data: [...red, ...blue], requestId: req.requestId });
  }

  const records = await query('SELECT * FROM evidence_artifacts WHERE run_id = $1', [req.params.id]);
  const artifacts = records.rows.map(row => ({ id: row.id, runId: row.run_id, artifactType: row.artifact_type, storageKey: row.storage_key, digest: row.digest, accessClass: row.access_class, createdAt: row.created_at, content: row.content }));
  res.json({ success: true, data: artifacts, requestId: req.requestId });
}));

router.get('/runs/:id/manifest', requireRole(['auditor', 'orchestrator']), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  const manifest = await getManifest(req.params.id);
  if (!manifest) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Manifest not found', requestId: req.requestId }, requestId: req.requestId });
  }
  res.json({ success: true, data: manifest, requestId: req.requestId });
}));

router.post('/runs/:id/verify', requireRole(['auditor', 'orchestrator']), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  const result = await verifyManifest(req.params.id);
  res.json({ success: true, data: result, requestId: req.requestId });
}));

router.post('/runs/:id/manifest/sign', requireRole('orchestrator'), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  const manifest = await buildAndSignManifest(req.params.id);
  res.json({ success: true, data: manifest, requestId: req.requestId });
}));

router.get('/manifest/public-key', asyncHandler(async (req, res) => {
  const publicKey = await getSigningPublicKey();
  res.json({ success: true, data: { publicKey, keyId: 'bayora-eval-key-001' }, requestId: req.requestId });
}));

router.post('/experiments/leakage', requireRole('orchestrator'), validateBody(LeakageExperimentConfigSchema), asyncHandler(async (req, res) => {
  const experimentId = await runLeakageExperiment(req.body);
  res.status(201).json({ success: true, data: { experimentId }, requestId: req.requestId });
}));

router.get('/experiments/:id/results', requireRole(['orchestrator', 'auditor']), validateParams(z.object({ id: z.string().uuid() })), asyncHandler(async (req, res) => {
  const scoped = await query('SELECT id FROM experiments WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId()]);
  if (!scoped.rowCount) return res.status(403).json({ success: false, error: { message: 'Access denied' } });
  const results = await getExperimentResults(req.params.id);
  res.json({ success: true, data: results, requestId: req.requestId });
}));

router.get('/experiments', requireRole(['orchestrator', 'auditor']), asyncHandler(async (_req, res) => {
  const result = await query('SELECT id, type, status, started_at, finished_at, run_id, config FROM experiments WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 100', [tenantId()]);
  res.json({ success: true, data: result.rows });
}));

router.post('/runs/:id/replay', requireRole('auditor'), rateLimit(5, 'replay'), asyncHandler(async (req, res) => {
  const run = await getRun(req.params.id);
  if (!run || !['CLOSED', 'VERIFIED'].includes(run.status)) return res.status(409).json({ success: false, error: { message: 'Close the run before replay' } });
  if (!isolated()) return res.status(409).json({ success: false, error: { message: 'Replay requires isolated execution services' } });
  res.json({ success: true, data: await callCell('replay', '/replay', { runId: req.params.id }) });
}));

export default router;
