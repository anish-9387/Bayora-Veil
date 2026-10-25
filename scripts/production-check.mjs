import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvFile } from 'node:process';
import { generateKeyPair } from '../packages/crypto-utils/dist/index.js';
import { verifyBundle } from './verify-bundle.mjs';

if (existsSync('.env')) loadEnvFile('.env');
const require = createRequire(resolve('apps/api/package.json'));
const { Pool } = require('pg');
const admin = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
  host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'bayora_veil'
});
const children = [];
const pools = [];
let logs = '';
const key = () => randomBytes(32).toString('hex');
const keys = { red: key(), blue: key(), audit: key(), replay: key(), target: key(), targetReplay: key(), redRead: key(), auditRead: key() };
const ports = { api: 3301, red: 3302, blue: 3303, audit: 3304, replay: 3305, target: 8300 };
const url = name => `http://127.0.0.1:${ports[name]}`;
const databases = {};
const runtimeEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(DB_|DATABASE_URL$|ACCOUNT_PASSWORD$|SIGNING_|CELL_|TARGET_|RED_|BLUE_|AUDIT_|REPLAY_)/.test(name)));
function start(name, command, args, env) {
  const child = spawn(command, args, { cwd: resolve('.'), env: { ...runtimeEnv, NODE_ENV: 'production', AUTH_MODE: 'accounts', EXECUTION_PROFILE: 'isolated', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + `[${name}] ${data}`).slice(-16000); });
  child.on('error', error => { logs += `${name}: ${error.message}`; });
  return child;
}
async function ready(name) {
  for (let i = 0; i < 600; i++) {
    try { if ((await fetch(url(name) + '/health', { signal: AbortSignal.timeout(1000) })).ok) { console.log(`${name}: ready`); return; } } catch {}
    await delay(200);
  }
  throw new Error(`${name} did not become healthy`);
}
try {
  for (const name of ['api', 'red', 'blue', 'audit', 'replay']) {
    const db = 'bayora_check_' + name;
    const password = key();
    if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [db])).rowCount) await admin.query(`CREATE ROLE ${db}`);
    await admin.query(`ALTER ROLE ${db} WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [db])).rowCount) await admin.query(`CREATE DATABASE ${db} OWNER ${db}`);
    await admin.query(`ALTER DATABASE ${db} OWNER TO ${db}`);
    await admin.query(`REVOKE CONNECT ON DATABASE ${db} FROM PUBLIC`);
    const base = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : new URL('postgresql://localhost');
    if (!process.env.DATABASE_URL) { base.hostname = process.env.DB_HOST || 'localhost'; base.port = process.env.DB_PORT || '5432'; base.username = process.env.DB_USER || 'postgres'; base.password = process.env.DB_PASSWORD || 'postgres'; }
    base.pathname = '/' + db;
    const maintenance = new Pool({ connectionString: base.toString() });
    try {
      await maintenance.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${db}`);
      const tables = await maintenance.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
      for (const { tablename } of tables.rows) {
        assert.match(tablename, /^[a-z_]+$/);
        await maintenance.query(`ALTER TABLE ${tablename} OWNER TO ${db}`);
      }
      const functions = await maintenance.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('reject_audit_mutation', 'protect_closed_artifact', 'freeze_cell_record')");
      for (const { proname } of functions.rows) await maintenance.query(`ALTER FUNCTION ${proname}() OWNER TO ${db}`);
    } finally { await maintenance.end(); }
    base.username = db; base.password = password; databases[name] = base.toString();
    pools.push(new Pool({ connectionString: databases[name] }));
  }
  mkdirSync('apps/api/.bayora', { recursive: true });
  const signingFile = resolve('apps/api/.bayora/production-check-key.json');
  if (!existsSync(signingFile)) writeFileSync(signingFile, JSON.stringify(generateKeyPair()), { mode: 0o600 });
  const migration = start('migration', process.execPath, ['apps/api/dist/db/migrate.js'], { DATABASE_URL: databases.api });
  assert.equal(await new Promise(r => migration.once('exit', r)), 0, 'Migration must pass');
  start('target', resolve(process.platform === 'win32' ? 'services/target-adapter/venv/Scripts/python.exe' : 'services/target-adapter/venv/bin/python'), ['-m', 'uvicorn', 'src.main:app', '--app-dir', 'services/target-adapter', '--host', '127.0.0.1', '--port', String(ports.target), '--no-access-log'], { TARGET_TOKEN: keys.target, TARGET_REPLAY_TOKEN: keys.targetReplay });
  await ready('target');
  for (const name of ['red', 'blue', 'audit', 'replay']) {
    const env = { DATABASE_URL: databases[name], CELL_KIND: name, CELL_TOKEN: keys[name], PORT: String(ports[name]) };
    if (name === 'audit') env.SIGNING_KEY_FILE = signingFile;
    if (name === 'red' || name === 'replay') Object.assign(env, { TARGET_ADAPTER_URL: url('target'), TARGET_TOKEN: name === 'red' ? keys.target : keys.targetReplay });
    if (name === 'red' || name === 'audit') env.REPLAY_READ_TOKEN = keys[name + 'Read'];
    if (name === 'replay') Object.assign(env, { RED_CELL_URL: url('red'), RED_CELL_TOKEN: keys.redRead, AUDIT_CELL_URL: url('audit'), AUDIT_CELL_TOKEN: keys.auditRead });
    start(name, process.execPath, ['apps/api/dist/cells/server.js'], env); await ready(name);
  }
  const apiEnv = { DATABASE_URL: databases.api, PORT: String(ports.api), CORS_ORIGIN: 'https://production-check.example' };
  for (const name of ['red', 'blue', 'audit', 'replay']) Object.assign(apiEnv, { [name.toUpperCase() + '_CELL_URL']: url(name), [name.toUpperCase() + '_CELL_TOKEN']: keys[name] });
  start('api', process.execPath, ['apps/api/dist/index.js'], apiEnv); await ready('api');
  const tenant = randomUUID(), other = randomUUID(), password = key(), suffix = randomUUID();
  for (const id of [tenant, other]) await pools[0].query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [id, 'Production smoke test']);
  const tokens = {};
  for (const role of ['orchestrator', 'red', 'blue', 'auditor', 'foreign']) {
    const salt = key();
    const passwordHash = salt + ':' + scryptSync(password, salt, 64).toString('hex');
    const email = `${role}-${suffix}@example.test`;
    await pools[0].query('INSERT INTO users (id, display_name, role, tenant_id, email, password_hash) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), role, role === 'foreign' ? 'auditor' : role, role === 'foreign' ? other : tenant, email, passwordHash]);
    const response = await fetch(url('api') + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 200); tokens[role] = (await response.json()).token;
  }
  async function request(path, role, body, status = 200, extra = {}) {
    const response = await fetch(url('api') + '/api/v1' + path, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text(); assert.equal(response.status, status, `${path}: ${text}`); return text ? JSON.parse(text).data : null;
  }
  const spoof = await fetch(url('api') + '/api/v1/runs', { headers: { 'X-Service-ID': 'attacker', 'X-Service-Role': 'orchestrator' } }); assert.equal(spoof.status, 401);
  const run = await request('/runs', 'orchestrator', { policyVersion: 'v1.0.0', modelAdapter: 'mock-adapter', createdBy: randomUUID() }, 201);
  const path = '/runs/' + run.id;
  await request(path, 'foreign', undefined, 403);
  await request(path + '/commit', 'blue', { payload: 'spoof' }, 403, { 'X-Service-Role': 'red' });
  const firstCommitment = await request(path + '/commit', 'red', { payload: 'prompt_injection private-smoke-marker' });
  await request(path + '/red-payload', 'blue', undefined, 403);
  await request(path + '/blue-rules', 'red', undefined, 403);
  await request(path + '/evidence', 'auditor', undefined, 403);
  const leases = [randomUUID(), randomUUID()];
  for (const id of leases) await pools[0].query("INSERT INTO work_leases (id, tenant_id, expires_at) VALUES ($1, $2, NOW() + interval '90 seconds')", [id, tenant]);
  try { await request(path + '/execute', 'orchestrator', {}, 429); }
  finally { await pools[0].query('DELETE FROM work_leases WHERE id = ANY($1::uuid[])', [leases]); }
  const original = await pools[1].query('SELECT data FROM cell_records WHERE tenant_id = $1 AND run_id = $2', [tenant, run.id]);
  await pools[1].query("UPDATE cell_records SET data = jsonb_set(data, '{payload}', to_jsonb($1::text)) WHERE tenant_id = $2 AND run_id = $3", ['tampered before execution', tenant, run.id]);
  await request(path + '/execute', 'orchestrator', {}, 409);
  await pools[1].query('UPDATE cell_records SET data = $1 WHERE tenant_id = $2 AND run_id = $3', [JSON.stringify(original.rows[0].data), tenant, run.id]);
  await request(path + '/execute', 'orchestrator', {});
  await request(path + '/evaluate', 'orchestrator', {});
  const observations = await request(path + '/observations', 'blue'); assert.ok(!JSON.stringify(observations).includes('private-smoke-marker'));
  await request(path + '/close', 'orchestrator', {});
  await request(path + '/commit', 'red', { payload: 'changed' }, 409);
  const evidence = await request(path + '/evidence', 'auditor'); assert.ok(JSON.stringify(evidence).includes('private-smoke-marker'));
  assert.ok((await request(path + '/verify', 'auditor', {})).valid);
  const bundle = await request(path + '/bundle', 'auditor');
  assert.ok(bundle.events.every(event => typeof event.canonicalPayload === 'string' && !event.canonicalPayload.includes('private-smoke-marker')));
  assert.ok(verifyBundle(bundle, bundle.publicKey));
  assert.equal(verifyBundle({ ...bundle, events: bundle.events.slice(0, -1) }, bundle.publicKey), false);
  assert.equal(verifyBundle(bundle, generateKeyPair().publicKey), false);
  await assert.rejects(pools[3].query('UPDATE audit_events SET actor = $1 WHERE run_id = $2', ['red', run.id]), /append-only/);
  await assert.rejects(pools[0].query('UPDATE evidence_artifacts SET digest = $1 WHERE run_id = $2', ['sha256:' + 'a'.repeat(64), run.id]), /immutable/);
  await assert.rejects(pools[1].query("UPDATE cell_records SET data = data || '{\"tampered\":true}'::jsonb WHERE tenant_id = $1 AND run_id = $2", [tenant, run.id]), /frozen/);
  const copy = await request(path + '/tamper-check', 'auditor', {}); assert.ok(copy.original.valid && !copy.tampered.valid && !copy.deleted.valid && !copy.reordered.valid);
  assert.ok((await request(path + '/replay', 'auditor', {})).matches);
  const metrics = await request('/metrics', 'orchestrator');
  assert.equal(metrics.failures, 1); assert.equal(metrics.evidence.premature, 0); assert.ok(metrics.latency.samples > 0);
  const metadata = await pools[0].query('SELECT content FROM evidence_artifacts WHERE run_id = $1', [run.id]); assert.ok(metadata.rows.every(r => r.content === null));
  const comparison = await request('/runs', 'orchestrator', { policyVersion: 'v1.0.0', modelAdapter: 'mock-adapter', createdBy: randomUUID() }, 201);
  const secondCommitment = await request(`/runs/${comparison.id}/commit`, 'red', { payload: 'prompt_injection private-smoke-marker' });
  assert.notEqual(firstCommitment.commitmentHash, secondCommitment.commitmentHash);
  const forbiddenDatabase = new URL(databases.red); forbiddenDatabase.pathname = '/bayora_check_blue';
  const foreignPool = new Pool({ connectionString: forbiddenDatabase.toString() });
  try { await assert.rejects(foreignPool.query('SELECT 1'), /permission denied/); } finally { await foreignPool.end(); }
  for (const type of ['blind_classification', 'timing_leakage', 'cross_tenant_access']) {
    const experiment = await request('/experiments/leakage', 'orchestrator', { type, runId: run.id, config: { samples: 12 } }, 201);
    const results = await request(`/experiments/${experiment.experimentId}/results`, 'auditor'); assert.ok(results.length >= 3 && results.every(r => Number.isFinite(r.metricValue)));
    if (type === 'cross_tenant_access') assert.ok(results.every(r => r.metricValue === 100));
    await request(`/experiments/${experiment.experimentId}/results`, 'foreign', undefined, 403);
  }
  const targetDenied = await fetch(url('target') + '/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(targetDenied.status, 401);
  const cellDenied = await fetch(url('red') + '/evidence', { method: 'POST', headers: { Authorization: `Bearer ${keys.blue}`, 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Actor-Role': 'auditor' }, body: JSON.stringify({ runId: run.id }) }); assert.equal(cellDenied.status, 401);
  await request('/auth/logout', 'auditor', {}, 204);
  await request(path, 'auditor', undefined, 401);
  console.log(`PASS: production account auth, spoofing, tenants, private cells, payload isolation, closure, signatures, replay, three experiments, and logout. Run ${run.id}`);
  if (process.env.PRODUCTION_CHECK_UI === '1') {
    mkdirSync('.bayora', { recursive: true });
    writeFileSync('.bayora/browser-check.json', JSON.stringify({ email: `orchestrator-${suffix}@example.test`, password, auditorEmail: `auditor-${suffix}@example.test`, runId: run.id }), { mode: 0o600 });
    console.log('Synthetic UI account prepared; Ctrl+C stops the verification services.');
    await new Promise(resolve => process.once('SIGINT', resolve));
  }
} catch (error) {
  console.error(logs); throw error;
} finally {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.all(pools.map(pool => pool.end())); await admin.end();
}
