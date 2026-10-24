import { query } from '../db/client.js';
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
import { v4 as uuidv4 } from 'uuid';

const router: Router = Router();

const RunIdParamSchema = z.object({ id: z.string().uuid() });

// Type-safe role arrays
const orchestratorRoles: ActorRole[] = ['orchestrator'];
const auditorRoles: ActorRole[] = ['auditor', 'orchestrator'];
const allRoles: ActorRole[] = ['orchestrator', 'auditor', 'red', 'blue', 'target', 'observation-firewall', 'audit-service'];

// Helper to wrap async handlers with proper error handling
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => 
  (req: Request, res: Response, next: NextFunction) => 
    Promise.resolve(fn(req, res, next)).catch(next);

router.use('/runs/:id', asyncHandler(async (req, res, next) => {
  if (req.method !== 'POST' || ['/verify', '/tamper-check', '/manifest/sign'].includes(req.path)) return next();
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
  const result = await query("SELECT content FROM evidence_artifacts WHERE run_id = $1 AND artifact_type = 'prompt'", [req.params.id]);
  res.json({ success: true, data: result.rows.map(row => row.content) });
}));
router.get('/runs/:id/blue-rules', requireRole('blue'), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  const result = await query("SELECT content FROM evidence_artifacts WHERE run_id = $1 AND artifact_type = 'defense_rule'", [req.params.id]);
  res.json({ success: true, data: result.rows.map(row => row.content) });
}));
router.get('/runs/:id/audit', requireRole(auditorRoles), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getAuditEvents(req.params.id) });
}));
router.post('/runs/:id/tamper-check', requireRole(auditorRoles), validateParams(RunIdParamSchema), asyncHandler(async (req, res) => {
  const events = await getAuditEvents(req.params.id);
  if (!events.length) return res.status(400).json({ success: false, error: { message: 'No events to verify' } });
  const original = verifyEventCopy(req.params.id, events);
  const copy = events.map(event => ({ ...event }));
  copy[0].payloadDigest = 'sha256:' + 'f'.repeat(64);
  res.json({ success: true, data: { original, tampered: verifyEventCopy(req.params.id, copy) } });
}));

router.post('/runs', requireRole(orchestratorRoles), validateBody(CreateRunSchema), asyncHandler(async (req, res) => {
  const run = await createRun(req.body);
  res.status(201).json({ success: true, data: run, requestId: req.requestId });
}));

router.get('/runs', requireRole(auditorRoles), asyncHandler(async (req, res) => {
  const status = req.query.status as RunStatus | undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
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

router.post('/runs/:id/target/execute', requireRole('target'), validateParams(RunIdParamSchema), validateBody(TargetRequestSchema), asyncHandler(async (req, res) => {
  const { caseId, prompt, timeoutMs } = req.body;
  const runId = req.params.id;

  const mockResponse = `[MOCK] Processed: ${prompt.substring(0, 100)}...`;
  const latencyMs = Math.floor(Math.random() * 500) + 100;

  const response = {
    runId,
    caseId,
    response: mockResponse,
    tokensUsed: Math.floor(mockResponse.length / 4),
    latencyMs,
    metadata: { mock: true }
  };

  await storeTargetResponse(response);
  await appendAuditEvent(runId, 'target_response', 'target', { runId, caseId, latencyMs });

  res.json({ success: true, data: response, requestId: req.requestId });
}));

router.post('/runs/:id/blue/defend', requireRole('blue'), validateParams(RunIdParamSchema), validateBody(BlueDefenseInputSchema), asyncHandler(async (req, res) => {
  const { observation, defenseConfig } = req.body;
  const runId = req.params.id;

  const sanitized = observationFirewall.sanitizeForBlue({
    runId,
    caseId: observation.caseId,
    prompt: '',
    response: '',
    timing: {}
  });

  const action = Math.random() > 0.5 ? 'allow' : 'flag';
  const defenseOutput = {
    runId,
    caseId: observation.caseId,
    action,
    reason: action === 'allow' ? 'Observation passes defense rules' : 'Observation flagged for review',
    metadata: { defenseConfig }
  };

  await appendAuditEvent(runId, 'defense_applied', 'blue', { runId, caseId: observation.caseId, action });
  res.json({ success: true, data: defenseOutput, requestId: req.requestId });
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
  if (!run || (run.status !== 'CLOSED' && run.status !== 'VERIFIED')) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Evidence only accessible after run closure', requestId: req.requestId }, requestId: req.requestId });
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
  const results = await getExperimentResults(req.params.id);
  res.json({ success: true, data: results, requestId: req.requestId });
}));

router.post('/runs/:id/observations/release', requireRole(['orchestrator', 'observation-firewall']), validateParams(RunIdParamSchema), validateBody(z.object({
  caseId: z.string(),
  outcome: z.enum(['policy_violation', 'instruction_hierarchy', 'data_exfiltration', 'prompt_injection', 'jailbreak', 'hallucination', 'bias', 'safe', 'not_tested', 'out_of_scope']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  category: z.enum(['policy_violation', 'instruction_hierarchy', 'data_exfiltration', 'prompt_injection', 'jailbreak', 'hallucination', 'bias', 'safe', 'not_tested', 'out_of_scope']),
  confidence: z.number().min(0).max(1)
})), asyncHandler(async (req, res) => {
  const { caseId, outcome, severity, category, confidence } = req.body;
  const observation = await releaseObservation(req.params.id, caseId, outcome, severity, category, confidence);
  if (!observation) {
    return res.status(400).json({ success: false, error: { code: 'RELEASE_FAILED', message: 'Cannot release observation in current phase', requestId: req.requestId }, requestId: req.requestId });
  }
  res.json({ success: true, data: observation, requestId: req.requestId });
}));

export default router;