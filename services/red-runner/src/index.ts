import express from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import { hash, generateRequestId } from '@bayora/crypto-utils';
import { SubmitPayloadSchema, PayloadCommitmentSchema, ActorRole, EventType } from '@bayora/schemas';

const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });

const app = express();
const PORT = parseInt(process.env.PORT || '3002', 10);

const payloadStore = new Map<string, { payload: string; commitmentHash: string; runId: string }>();

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
  if (!serviceId || role !== 'red') {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Red runner access only', requestId: (req as any).requestId }
    });
  }
  next();
});

const RunIdParamSchema = z.object({ id: z.string().uuid() });

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'red-runner', version: '0.1.0', timestamp: new Date().toISOString() });
});

app.post('/runs/:id/payload', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const bodyResult = SubmitPayloadSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: bodyResult.error.flatten(), requestId: (req as any).requestId } });
  }

  const { payload, metadata } = bodyResult.data;
  const runId = parseResult.data.id;
  const commitmentHash = hash(payload);
  const storageKey = `payload_${uuidv4()}`;

  payloadStore.set(storageKey, { payload, commitmentHash, runId });

  logger.info('payload_stored', { runId, storageKey, commitmentHash });

  res.json({
    success: true,
    data: { storageKey, commitmentHash },
    requestId: (req as any).requestId
  });
});

app.get('/runs/:id/payload/:storageKey', async (req, res) => {
  const runId = req.params.id;
  const storageKey = req.params.storageKey;

  const stored = payloadStore.get(storageKey);
  if (!stored || stored.runId !== runId) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Payload not found', requestId: (req as any).requestId } });
  }

  logger.info('payload_retrieved', { runId, storageKey });
  res.json({ success: true, data: { payload: stored.payload, commitmentHash: stored.commitmentHash }, requestId: (req as any).requestId });
});

app.get('/runs/:id/commitment', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  for (const [key, value] of payloadStore.entries()) {
    if (value.runId === parseResult.data.id) {
      return res.json({ success: true, data: { commitmentHash: value.commitmentHash }, requestId: (req as any).requestId });
    }
  }

  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No commitment for this run', requestId: (req as any).requestId } });
});

app.get('/runs/:id/payloads', async (req, res) => {
  const parseResult = RunIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID', requestId: (req as any).requestId } });
  }

  const payloads = [];
  for (const [key, value] of payloadStore.entries()) {
    if (value.runId === parseResult.data.id) {
      payloads.push({ storageKey: key, commitmentHash: value.commitmentHash });
    }
  }

  res.json({ success: true, data: payloads, requestId: (req as any).requestId });
});

app.listen(PORT, () => {
  logger.info(`Red runner listening on port ${PORT}`);
});