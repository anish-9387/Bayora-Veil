import express from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import { hash, generateRequestId, bucketDuration } from '@bayora/crypto-utils';
import { ObservationSchema, BlueDefenseInputSchema, BlueDefenseOutputSchema, ActorRole, Severity, OutcomeCategory } from '@bayora/schemas';

const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });

const app = express();
const PORT = parseInt(process.env.PORT || '3003', 10);

const defenseRules = new Map<string, string>();
const defenseConfigs = new Map<string, any>();

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  res.setHeader('x-request-id', requestId);
  (req as any).requestId = requestId;
  next();
});

app.use((req, res, next) => {
  const serviceId = req.headers['x-service-id'];
  const role = req.headers['x-service-role'];
  if (!serviceId || role !== 'blue') {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Blue runner access only', requestId: (req as any).requestId }
    });
  }
  next();
});

const RunIdParamSchema = z.object({ id: z.string().uuid() });

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'blue-runner', version: '0.1.0', timestamp: new Date().toISOString() });
});

app.post('/runs/:id/defense-rules', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const ruleSchema = z.object({ rule: z.string(), config: z.record(z.unknown()).optional() });
  const bodyResult = ruleSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid rule', requestId: (req as any).requestId } });
  }

  const { rule, config } = bodyResult.data;
  const runId = parseResult.data.id;
  const storageKey = `defense_rule_${uuidv4()}`;
  const digest = hash(rule);

  defenseRules.set(storageKey, rule);
  if (config) defenseConfigs.set(storageKey, config);

  logger.info('defense_rule_stored', { runId, storageKey, digest });

  res.json({ success: true, data: { storageKey, digest }, requestId: (req as any).requestId });
});

app.get('/runs/:id/defense-rules/:storageKey', async (req, res) => {
  const runId = req.params.id;
  const storageKey = req.params.storageKey;

  const rule = defenseRules.get(storageKey);
  if (!rule) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Defense rule not found', requestId: (req as any).requestId } });
  }

  logger.info('defense_rule_retrieved', { runId, storageKey });
  res.json({ success: true, data: { rule, config: defenseConfigs.get(storageKey) }, requestId: (req as any).requestId });
});

app.post('/runs/:id/defend', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const bodyResult = BlueDefenseInputSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid defense input', details: bodyResult.error.flatten(), requestId: (req as any).requestId } });
  }

  const { observation, defenseConfig } = bodyResult.data;
  const runId = parseResult.data.id;

  let action: 'allow' | 'block' | 'flag' | 'modify' = 'allow';
  let reason = 'Observation passes defense rules';

  if (observation.severity === 'critical' || observation.severity === 'high') {
    action = 'flag';
    reason = `High severity observation flagged for review: ${observation.category}`;
  }

  if (observation.outcome === 'jailbreak' || observation.outcome === 'prompt_injection') {
    action = 'block';
    reason = `Attack category ${observation.outcome} blocked by defense policy`;
  }

  const defenseOutput = {
    runId,
    caseId: observation.caseId,
    action,
    reason,
    modifiedObservation: action === 'modify' ? { ...observation, severity: 'low' as Severity } : undefined,
    metadata: { defenseConfig, latencyBucket: bucketDuration(observation.confidence * 1000) }
  };

  logger.info('defense_applied', { runId, caseId: observation.caseId, action });

  res.json({ success: true, data: defenseOutput, requestId: (req as any).requestId });
});

app.get('/runs/:id/defense-config', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const runId = parseResult.data.id;
  const configs = [];
  for (const [key, value] of defenseConfigs.entries()) {
    if (key.includes(runId)) {
      configs.push({ storageKey: key, config: value });
    }
  }

  res.json({ success: true, data: configs, requestId: (req as any).requestId });
});

app.listen(PORT, () => {
  logger.info(`Blue runner listening on port ${PORT}`);
});