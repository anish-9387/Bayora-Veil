import express from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import { hash, generateRequestId, bucketDuration, addTimingNoise } from '@bayora/crypto-utils';
import { ObservationSchema, EvidenceArtifactSchema, AccessClass, OutcomeCategory, Severity, ActorRole } from '@bayora/schemas';

const logger = pino.default({ level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });

const app = express();
const PORT = parseInt(process.env.PORT || '3004', 10);

interface RawEvidence {
  runId: string;
  caseId: string;
  prompt: string;
  response: string;
  defenseRule?: string;
  stackTrace?: string;
  toolTrace?: string;
  timing?: Record<string, number>;
  hiddenLabels?: Record<string, string>;
  outcome?: string;
}

const evidenceStore = new Map<string, RawEvidence[]>();
const runPhases = new Map<string, string>();

const ALLOWED_OUTCOMES: OutcomeCategory[] = [
  'policy_violation', 'instruction_hierarchy', 'data_exfiltration',
  'prompt_injection', 'jailbreak', 'hallucination', 'bias',
  'safe', 'not_tested', 'out_of_scope'
];

const ALLOWED_SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

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
  if (!serviceId || !['observation-firewall', 'orchestrator', 'auditor'].includes(role)) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Firewall access only', requestId: (req as any).requestId }
    });
  }
  next();
});

const RunIdParamSchema = z.object({ id: z.string().uuid() });

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'observation-firewall', version: '0.1.0', timestamp: new Date().toISOString() });
});

app.post('/runs/:id/phase', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const phaseSchema = z.object({ phase: z.string() });
  const bodyResult = phaseSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid phase', requestId: (req as any).requestId } });
  }

  runPhases.set(parseResult.data.id, bodyResult.data.phase);
  logger.info('phase_updated', { runId: parseResult.data.id, phase: bodyResult.data.phase });

  res.json({ success: true, data: { phase: bodyResult.data.phase }, requestId: (req as any).requestId });
});

app.post('/runs/:id/evidence', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const evidenceSchema = z.object({
    caseId: z.string(),
    prompt: z.string(),
    response: z.string(),
    defenseRule: z.string().optional(),
    stackTrace: z.string().optional(),
    toolTrace: z.string().optional(),
    timing: z.record(z.number()).optional(),
    hiddenLabels: z.record(z.string()).optional()
  });

  const bodyResult = evidenceSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid evidence', requestId: (req as any).requestId } });
  }

  const runId = parseResult.data.id;
  const key = `${runId}:${bodyResult.data.caseId}`;

  if (!evidenceStore.has(key)) {
    evidenceStore.set(key, []);
  }
  evidenceStore.get(key)!.push({ ...bodyResult.data, runId });

  logger.info('evidence_stored', { runId, caseId: bodyResult.data.caseId });

  res.json({ success: true, data: { stored: true }, requestId: (req as any).requestId });
});

app.post('/runs/:id/observations/release', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const releaseSchema = z.object({
    caseId: z.string(),
    outcome: z.enum(ALLOWED_OUTCOMES as [OutcomeCategory, ...OutcomeCategory[]]),
    severity: z.enum(ALLOWED_SEVERITIES as [Severity, ...Severity[]]),
    category: z.enum(ALLOWED_OUTCOMES as [OutcomeCategory, ...OutcomeCategory[]]),
    confidence: z.number().min(0).max(1)
  });

  const bodyResult = releaseSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid observation', requestId: (req as any).requestId } });
  }

  const runId = parseResult.data.id;
  const phase = runPhases.get(runId) || 'created';

  if (phase !== 'evaluation_closed' && phase !== 'closed') {
    return res.status(400).json({
      success: false,
      error: { code: 'PHASE_ERROR', message: `Cannot release observation in phase: ${phase}`, requestId: (req as any).requestId }
    });
  }

  const { caseId, outcome, severity, category, confidence } = bodyResult.data;
  const key = `${runId}:${caseId}`;
  const evidenceList = evidenceStore.get(key);

  if (!evidenceList || evidenceList.length === 0) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No evidence for this case', requestId: (req as any).requestId } });
  }

  const evidence = evidenceList[0];
  const evidenceDigest = hash(JSON.stringify({
    prompt: evidence.prompt,
    response: evidence.response,
    defenseRule: evidence.defenseRule,
    timing: evidence.timing
  }));

  const observation = {
    id: uuidv4(),
    runId,
    caseId,
    outcome,
    severity,
    category,
    confidence: Math.max(0, Math.min(1, confidence)),
    evidenceDigest,
    releasedAt: new Date().toISOString(),
    releasedAfterPhase: phase
  };

  evidenceStore.delete(key);

  logger.info('observation_released', { runId, caseId, outcome, evidenceDigest });

  res.json({ success: true, data: observation, requestId: (req as any).requestId });
});

app.get('/runs/:id/evidence/:caseId', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const caseId = req.params.caseId;
  const role = req.headers['x-service-role'] as ActorRole;
  const key = `${parseResult.data.id}:${caseId}`;
  const evidenceList = evidenceStore.get(key);

  if (!evidenceList || evidenceList.length === 0) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No evidence for this case', requestId: (req as any).requestId } });
  }

  const evidence = evidenceList[0];
  let sanitized: Partial<RawEvidence>;

  switch (role) {
    case 'blue':
      sanitized = sanitizeForBlue(evidence);
      break;
    case 'red':
      sanitized = sanitizeForRed(evidence);
      break;
    case 'auditor':
    case 'orchestrator':
    case 'observation-firewall':
      sanitized = sanitizeForAuditor(evidence);
      break;
    default:
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Role not authorized for raw evidence', requestId: (req as any).requestId } });
  }

  res.json({ success: true, data: sanitized, requestId: (req as any).requestId });
});

function sanitizeForBlue(evidence: RawEvidence): Partial<RawEvidence> {
  return {
    caseId: evidence.caseId,
    response: truncateResponse(evidence.response),
    timing: bucketTiming(evidence.timing)
  };
}

function sanitizeForRed(evidence: RawEvidence): Partial<RawEvidence> {
  return {
    caseId: evidence.caseId,
    outcome: 'policy_violation'
  };
}

function sanitizeForAuditor(evidence: RawEvidence): RawEvidence {
  return { ...evidence };
}

function truncateResponse(response: string, maxLength = 500): string {
  if (response.length <= maxLength) return response;
  return response.substring(0, maxLength) + '... [truncated]';
}

function bucketTiming(timing?: Record<string, number>): Record<string, number> | undefined {
  if (!timing) return undefined;
  const bucketed: Record<string, number> = {};
  for (const [key, value] of Object.entries(timing)) {
    bucketed[key] = Math.floor(value / 100) * 100;
  }
  return bucketed;
}

app.listen(PORT, () => {
  logger.info(`Observation firewall listening on port ${PORT}`);
});