import express from 'express';
import { timingSafeEqual, randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { query, getClient, closePool } from '../db/client.js';
import { schema, seedData } from '../db/schema.js';
import { principals, tenantId } from '../security/context.js';
import { hash, hashPrivateArtifact, getSigningKey } from '@bayora/crypto-utils';
import { TargetResponseSchema } from '@bayora/schemas';
import * as audit from '../services/audit.js';

const kind = process.env.CELL_KIND;
if (!['red', 'blue', 'audit', 'replay'].includes(kind || '')) throw new Error('Invalid cell kind');
const secret = process.env.CELL_TOKEN;
if (!secret || secret.length < 32 || !process.env.DATABASE_URL) throw new Error('Cell requires a strong token and private database');
if (kind === 'audit' && !process.env.SIGNING_KEY_FILE) throw new Error('Audit cell requires a persistent signing secret file');

export const app: express.Express = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.get('/health', (_req, res) => res.json({ status: 'healthy' }));
function equal(a: string, b: string) { return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
app.use((req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const replay = process.env.REPLAY_READ_TOKEN && equal(token, process.env.REPLAY_READ_TOKEN);
  if (!equal(token, secret!) && !replay) return res.sendStatus(401);
  if (replay && !['/evidence', '/verify', '/manifest', '/events'].includes(req.path)) return res.sendStatus(403);
  const tenant = z.guid().safeParse(req.headers['x-tenant-id']);
  const role = replay ? 'auditor' : String(req.headers['x-actor-role'] || '');
  if (!tenant.success || !['red', 'blue', 'orchestrator', 'auditor'].includes(role)) return res.sendStatus(403);
  principals.run({ tenantId: tenant.data, role, userId: 'internal', deadline: Date.now() + 40000 }, next);
});

async function record(runId: string) {
  const result = await query('SELECT data FROM cell_records WHERE tenant_id = $1 AND run_id = $2', [tenantId(), runId]);
  return result.rows[0]?.data;
}
async function save(runId: string, data: unknown) {
  await query(`INSERT INTO cell_records (tenant_id, run_id, data) VALUES ($1, $2, $3)
    ON CONFLICT (tenant_id, run_id) DO UPDATE SET data = EXCLUDED.data`, [tenantId(), runId, JSON.stringify(data)]);
}
async function target(runId: string, modelAdapter: string, prompt: string) {
  const base = process.env.TARGET_ADAPTER_URL;
  if (!base || !process.env.TARGET_TOKEN) throw new Error('Target unavailable');
  const result = await fetch(new URL('/execute', base.includes('://') ? base : `http://${base}`), { method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TARGET_TOKEN}` },
    body: JSON.stringify({ run_id: runId, case_id: 'case-001', model_adapter: modelAdapter, prompt, timeout_ms: Math.max(1, Math.min(30000, (principals.getStore()?.deadline || Date.now() + 30000) - Date.now())) }), signal: AbortSignal.timeout(Math.max(1, Math.min(32000, (principals.getStore()?.deadline || Date.now() + 32000) - Date.now()))) });
  if (!result.ok) throw new Error('Target failed');
  const raw = await result.json() as any;
  const parsed = TargetResponseSchema.parse({ runId: raw.run_id, caseId: raw.case_id, response: raw.response, tokensUsed: raw.tokens_used, latencyMs: raw.latency_ms, metadata: raw.metadata });
  if (parsed.runId !== runId || parsed.caseId !== 'case-001') throw new Error('Target identity mismatch');
  return parsed;
}
const observation = (runId: string, digest: string) => ({ runId, caseId: 'case-001', outcome: 'not_tested', severity: 'low', category: 'not_tested', confidence: 0, evidenceDigest: digest });

app.post('/:operation', async (req, res, next) => {
  const role = principals.getStore()!.role;
  const parsed = z.object({ runId: z.string().uuid() }).passthrough().safeParse(req.body);
  if (!parsed.success) return res.sendStatus(400);
  const { runId } = parsed.data;
  const operation = req.params.operation;
  const client = await getClient();
  let locked = false;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [tenantId() + runId]);
    locked = lock.rows[0].locked;
    if (!locked) return res.sendStatus(409);
    const existing = await record(runId);
    let result: any;
    if (kind === 'red') {
      if (operation === 'commit' && role === 'red') {
        const payload = z.string().min(1).max(100000).parse(req.body.payload);
        if (existing && existing.payload !== payload) return res.sendStatus(409);
        const nonce = existing?.nonce || randomBytes(32).toString('hex');
        const commitment = existing?.commitment || hashPrivateArtifact('payload', payload, nonce);
        if (!existing) await save(runId, { payload, nonce, commitment, closed: false, createdAt: new Date().toISOString() });
        result = { commitmentHash: commitment };
      } else if (operation === 'execute' && role === 'orchestrator' && existing && !existing.closed) {
        if ((existing.nonce ? hashPrivateArtifact('payload', existing.payload, existing.nonce) : hash(existing.payload)) !== req.body.commitmentHash || existing.commitment !== req.body.commitmentHash) return res.sendStatus(409);
        if (!existing.response) {
          existing.response = await target(runId, z.enum(['mock-adapter', 'ollama-llama3.2']).parse(req.body.modelAdapter), existing.payload);
          existing.executedAt = new Date().toISOString();
          await save(runId, existing);
        }
        result = observation(runId, existing.nonce ? hashPrivateArtifact('response', existing.response.response, existing.nonce) : hash(existing.response.response));
      } else if (operation === 'freeze' && role === 'orchestrator' && existing?.response) {
        await save(runId, { ...existing, closed: true }); result = { closed: true };
      } else if (operation === 'payload' && role === 'red' && existing) result = [{ payload: existing.payload }];
      else if (operation === 'evidence' && role === 'auditor' && existing?.closed) result = [
        { id: runId + ':prompt', runId, artifactType: 'prompt', digest: existing.commitment, accessClass: 'red_private', createdAt: existing.createdAt, content: { payload: existing.payload, nonce: existing.nonce } },
        { id: runId + ':response', runId, artifactType: 'response', digest: existing.nonce ? hashPrivateArtifact('response', existing.response.response, existing.nonce) : hash(existing.response.response), accessClass: 'target_private', createdAt: existing.executedAt, content: { ...existing.response, nonce: existing.nonce } }
      ];
      else return res.sendStatus(403);
    } else if (kind === 'blue') {
      const rule = process.env.DEFENSE_RULE || 'Flag unassessed outcomes; allow only a safe outcome';
      if (operation === 'defend' && role === 'orchestrator' && !existing?.closed) {
        const view = z.object({ runId: z.string().uuid(), caseId: z.literal('case-001'), outcome: z.literal('not_tested'), severity: z.literal('low'), category: z.literal('not_tested'), confidence: z.literal(0), evidenceDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict().parse(req.body.observation);
        if (view.runId !== runId) return res.sendStatus(400);
        await save(runId, { rule, closed: false, action: 'flag', digest: hash(rule), createdAt: existing?.createdAt || new Date().toISOString() });
        result = { action: 'flag', ruleDigest: hash(rule) };
      } else if (operation === 'rules' && role === 'blue') result = [{ rule: existing?.rule || rule }];
      else if (operation === 'freeze' && role === 'orchestrator' && existing) { await save(runId, { ...existing, closed: true }); result = { closed: true }; }
      else if (operation === 'evidence' && role === 'auditor' && existing?.closed) result = [{ id: runId + ':rule', runId, artifactType: 'defense_rule', digest: existing.digest, accessClass: 'blue_private', createdAt: existing.createdAt, content: { rule: existing.rule } }];
      else return res.sendStatus(403);
    } else if (kind === 'audit') {
      if (operation === 'public-key') return res.json(await audit.getSigningPublicKey());
      if (operation === 'append' && role === 'orchestrator') {
        if (!existing) {
          if (req.body.eventType !== 'run_created') return res.sendStatus(409);
          const meta = z.object({ policyVersion: z.string().max(100), modelAdapter: z.string().max(100), createdBy: z.string().uuid() }).passthrough().parse(req.body.payload);
          await query('INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tenantId(), tenantId()]);
          await query("INSERT INTO users (id, display_name, role, tenant_id) VALUES ($1, 'Evaluation operator', 'orchestrator', $2) ON CONFLICT DO NOTHING", [meta.createdBy, tenantId()]);
          await query("INSERT INTO runs (id, status, policy_version, model_adapter, created_by, tenant_id) VALUES ($1, 'CREATED', $2, $3, $4, $5) ON CONFLICT DO NOTHING", [runId, meta.policyVersion, meta.modelAdapter, meta.createdBy, tenantId()]);
          await save(runId, { closed: false });
        }
        if (existing?.closed) return res.sendStatus(409);
        const eventType = z.enum(['run_created', 'payload_committed', 'execution_started', 'target_response', 'defense_applied', 'observation_released', 'run_closed']).parse(req.body.eventType);
        const previous = await query('SELECT event_hash FROM audit_events WHERE run_id = $1 AND event_type = $2', [runId, eventType]);
        result = previous.rows[0]?.event_hash || await audit.appendAuditEvent(runId, eventType, req.body.actor, req.body.payload);
      } else if (!existing) return res.sendStatus(403);
      else if (operation === 'seal' && role === 'orchestrator') {
        const events = await audit.getAuditEvents(runId);
        if (events.map(event => event.eventType).join(',') !== 'run_created,payload_committed,execution_started,target_response,defense_applied,observation_released,run_closed') return res.sendStatus(409);
        await query("UPDATE runs SET status = 'CLOSED', closed_at = COALESCE(closed_at, NOW()) WHERE id = $1", [runId]);
        result = await audit.buildAndSignManifest(runId); await save(runId, { closed: true });
      } else if (operation === 'events' && ['auditor', 'orchestrator'].includes(role)) result = await audit.getAuditEvents(runId);
      else if (operation === 'manifest' && ['auditor', 'orchestrator'].includes(role)) result = await audit.getManifest(runId);
      else if (operation === 'verify' && ['auditor', 'orchestrator'].includes(role)) result = await audit.verifyManifest(runId);
      else return res.sendStatus(403);
    } else if (kind === 'replay' && operation === 'replay' && role === 'auditor') {
      const { callCell } = await import('../services/cells.js');
      const proof = await callCell('audit', '/verify', { runId });
      if (!proof.valid) return res.sendStatus(409);
      const manifest = await callCell('audit', '/manifest', { runId });
      const evidence = await callCell<any[]>('red', '/evidence', { runId });
      const prompt = evidence.find(e => e.artifactType === 'prompt');
      const response = evidence.find(e => e.artifactType === 'response');
      if (!prompt || !response) return res.sendStatus(409);
      const payloadDigest = prompt.content.nonce ? hashPrivateArtifact('payload', prompt.content.payload, prompt.content.nonce) : hash(prompt.content.payload);
      const responseDigest = (text: string) => response.content.nonce ? hashPrivateArtifact('response', text, response.content.nonce) : hash(text);
      if (payloadDigest !== prompt.digest || responseDigest(response.content.response) !== response.digest) return res.sendStatus(409);
      const replayId = randomUUID();
      const fresh = await target(replayId, manifest.modelAdapter, prompt.content.payload);
      result = { runId, replayId, originalDigest: response.digest, replayDigest: responseDigest(fresh.response), matches: response.digest === responseDigest(fresh.response), modelAdapter: manifest.modelAdapter, method: 'Fresh stateless target request; exact response comparison using the original evidence nonce', createdAt: new Date().toISOString() };
      await save(runId, result);
    } else return res.sendStatus(404);
    res.json(result);
  } catch (error) { next(error); }
  finally {
    try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [tenantId() + runId]); client.release(); }
    catch (error) { client.release(error as Error); }
  }
});
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(JSON.stringify({ error: err.name, cell: kind }));
  res.status(err instanceof z.ZodError ? 400 : 503).json({ error: 'Cell operation failed' });
});

async function main() {
  await query(`CREATE TABLE IF NOT EXISTS cell_records (tenant_id UUID NOT NULL, run_id UUID NOT NULL, data JSONB NOT NULL, PRIMARY KEY (tenant_id, run_id))`);
  await query(`CREATE OR REPLACE FUNCTION freeze_cell_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF OLD.data->>'closed' = 'true' AND (TG_OP = 'DELETE' OR NEW.data IS DISTINCT FROM OLD.data) THEN RAISE EXCEPTION 'Cell record frozen'; END IF;
    RETURN COALESCE(NEW, OLD); END $$;
    DROP TRIGGER IF EXISTS cell_record_frozen ON cell_records;
    CREATE TRIGGER cell_record_frozen BEFORE UPDATE OR DELETE ON cell_records FOR EACH ROW EXECUTE FUNCTION freeze_cell_record()`);
  if (kind === 'audit') { getSigningKey(); await query(schema); await query(seedData); }
  const server = app.listen(Number(process.env.PORT || 10000), '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => { void closePool().finally(() => process.exit(0)); }); setTimeout(() => process.exit(1), 15000).unref(); });
}
if (process.env.NODE_ENV !== 'test') void main().catch(() => { console.error('Cell startup failed'); process.exit(1); });
