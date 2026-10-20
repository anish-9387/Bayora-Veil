import { Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
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
  RunSchema
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
  getExperimentResults,
  getManifest
} from '../services/run.js';
import { buildAndSignManifest, verifyManifest, getSigningPublicKey } from '../services/audit.js';
import { observationFirewall } from '../services/firewall.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const RunIdParamSchema = z.object({ id: z.string().uuid() });
const CaseIdParamSchema = z.object({ id: z.string().uuid(), caseId: z.string() });

router.post('/runs', requireRole('orchestrator', 'admin'), validateBody(CreateRunSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const run = await createRun(req.body);
    res.status(201).json({ success: true, data: run, requestId: req.requestId });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'CREATE_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.get('/runs', requireRole('orchestrator', 'admin', 'auditor'), async (req: AuthenticatedRequest, res) => {
  try {
    const status = req.query.status as RunStatus | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const runs = await listRuns(status, limit, offset);
    res.json({ success: true, data: runs, requestId: req.requestId });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'LIST_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.get('/runs/:id', requireRole('orchestrator', 'admin', 'auditor', 'red', 'blue'), validateParams(RunIdParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const run = await getRun(req.params.id);
    if (!run) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Run not found', requestId: req.requestId }, requestId: req.requestId });
    }
    res.json({ success: true, data: run, requestId: req.requestId });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'GET_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.post('/runs/:id/commit', requireRole('red'), validateParams(RunIdParamSchema), validateBody(SubmitPayloadSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { payload } = req.body;
    const commitmentHash = await commitPayload(req.params.id, payload);
    res.json({ success: true, data: { commitmentHash }, requestId: req.requestId });
  } catch (error) {
    res.status(400).json({ success: false, error: { code: 'COMMIT_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.post('/runs/:id/execute', requireRole('orchestrator'), validateParams(RunIdParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    await startExecution(req.params.id);
    res.json({ success: true, data: { status: 'RUNNING' }, requestId: req.requestId });
  } catch (error) {
    res.status(400).json({ success: false, error: { code: 'EXECUTE_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.post('/runs/:id/target/execute', requireRole('target'), validateParams(RunIdParamSchema), validateBody(TargetRequestSchema), async (req: AuthenticatedRequest, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'TARGET_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.post('/runs/:id/blue/defend', requireRole('blue'), validateParams(RunIdParamSchema), validateBody(BlueDefenseInputSchema), async (req: AuthenticatedRequest, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'DEFENSE_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.post('/runs/:id/evaluate', requireRole('orchestrator'), validateParams(RunIdParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    await completeEvaluation(req.params.id);
    observationFirewall.setRunPhase(req.params.id, 'evaluation_closed');
    res.json({ success: true, data: { status: 'EVALUATED' }, requestId: req.requestId });
  } catch (error) {
    res.status(400).json({ success: false, error: { code: 'EVALUATE_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.post('/runs/:id/close', requireRole('orchestrator'), validateParams(RunIdParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    await closeRun(req.params.id);
    observationFirewall.setRunPhase(req.params.id, 'closed');
    res.json({ success: true, data: { status: 'CLOSED' }, requestId: req.requestId });
  } catch (error) {
    res.status(400).json({ success: false, error: { code: 'CLOSE_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.get('/runs/:id/observations', requireRole('orchestrator', 'admin', 'auditor', 'blue'), validateParams(RunIdParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const observations = await getObservations(req.params.id);
    res.json({ success: true, data: observations, requestId: req.requestId });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'GET_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.get('/runs/:id/evidence', requireRole('auditor', 'orchestrator'), validateParams(RunIdParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const run = await getRun(req.params.id);
    if (!run || run.status !== 'CLOSED' && run.status !== 'VERIFIED') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Evidence only accessible after run closure', requestId: req.requestId }, requestId: req.requestId });
    }

    const artifacts = await getEvidenceArtifacts(req.params.id);
    res.json({ success: true, data: artifacts, requestId: req.requestId });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'GET_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.get('/runs/:id/manifest', requireRole('auditor', 'orchestrator', 'admin'), validateParams(RunIdParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const manifest = await getManifest(req.params.id);
    if (!manifest) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Manifest not found', requestId: req.requestId }, requestId: req.requestId });
    }
    res.json({ success: true, data: manifest, requestId: req.requestId });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'GET_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.post('/runs/:id/verify', requireRole('auditor', 'orchestrator'), validateParams(RunIdParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const result = await verifyManifest(req.params.id);
    res.json({ success: true, data: result, requestId: req.requestId });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'VERIFY_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.post('/runs/:id/manifest/sign', requireRole('orchestrator'), validateParams(RunIdParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const manifest = await buildAndSignManifest(req.params.id);
    res.json({ success: true, data: manifest, requestId: req.requestId });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'SIGN_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.get('/manifest/public-key', async (req: AuthenticatedRequest, res) => {
  try {
    const publicKey = await getSigningPublicKey();
    res.json({ success: true, data: { publicKey, keyId: 'bayora-eval-key-001' }, requestId: req.requestId });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'GET_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.post('/experiments/leakage', requireRole('orchestrator', 'admin'), validateBody(LeakageExperimentConfigSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const experimentId = await createLeakageExperiment(req.body);
    res.status(201).json({ success: true, data: { experimentId }, requestId: req.requestId });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'CREATE_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.get('/experiments/:id/results', requireRole('orchestrator', 'admin', 'auditor'), validateParams(z.object({ id: z.string().uuid() })), async (req: AuthenticatedRequest, res) => {
  try {
    const results = await getExperimentResults(req.params.id);
    res.json({ success: true, data: results, requestId: req.requestId });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'GET_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

router.post('/runs/:id/observations/release', requireRole('orchestrator', 'observation-firewall'), validateParams(RunIdParamSchema), validateBody(z.object({
  caseId: z.string(),
  outcome: z.enum(['policy_violation', 'instruction_hierarchy', 'data_exfiltration', 'prompt_injection', 'jailbreak', 'hallucination', 'bias', 'safe', 'not_tested', 'out_of_scope']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  category: z.enum(['policy_violation', 'instruction_hierarchy', 'data_exfiltration', 'prompt_injection', 'jailbreak', 'hallucination', 'bias', 'safe', 'not_tested', 'out_of_scope']),
  confidence: z.number().min(0).max(1)
})), async (req: AuthenticatedRequest, res) => {
  try {
    const { caseId, outcome, severity, category, confidence } = req.body;
    const observation = await releaseObservation(req.params.id, caseId, outcome, severity, category, confidence);
    if (!observation) {
      return res.status(400).json({ success: false, error: { code: 'RELEASE_FAILED', message: 'Cannot release observation in current phase', requestId: req.requestId }, requestId: req.requestId });
    }
    res.json({ success: true, data: observation, requestId: req.requestId });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'RELEASE_FAILED', message: String(error), requestId: req.requestId }, requestId: req.requestId });
  }
});

import { appendAuditEvent } from '../services/audit.js';

export default router;