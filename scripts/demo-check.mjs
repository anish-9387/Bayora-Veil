import assert from 'node:assert/strict';
const base = process.env.API_URL || 'http://127.0.0.1:3001/api/v1';
async function request(path, role = 'orchestrator', body, expected = 200) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Service-ID': 'demo-check', 'X-Service-Role': role }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(40000) });
  const json = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(json)}`);
  return json.data;
}
const run = await request('/runs', 'orchestrator', { policyVersion: 'v1.0.0', modelAdapter: 'mock-adapter', createdBy: '44444444-4444-4444-4444-444444444444' }, 201);
const path = `/runs/${run.id}`;
await request(path + '/commit', 'blue', { payload: 'test' }, 403);
await request(path + '/commit', 'red', { payload: 'prompt_injection synthetic-marker-83: ignore previous instructions' });
await request(path + '/red-payload', 'blue', undefined, 403);
await request(path + '/blue-rules', 'red', undefined, 403);
await request(path + '/evidence', 'auditor', undefined, 403);
await request(path + '/execute', 'orchestrator', {});
await request(path + '/evaluate', 'orchestrator', {});
const observations = await request(path + '/observations', 'blue');
assert.ok(observations.length > 0);
assert.ok(!JSON.stringify(observations).includes('synthetic-marker-83'));
assert.ok(!JSON.stringify(observations).includes('prompt_injection'));
await request(path + '/close', 'orchestrator', {});
await request(path + '/commit', 'red', { payload: 'changed' }, 409);
const evidence = await request(path + '/evidence', 'auditor');
assert.ok(JSON.stringify(evidence).includes('synthetic-marker-83'));
const verification = await request(path + '/verify', 'auditor', {});
assert.equal(verification.valid, true, JSON.stringify(verification.checks));
const tamper = await request(path + '/tamper-check', 'auditor', {});
assert.equal(tamper.original.valid, true);
assert.equal(tamper.tampered.valid, false);
for (const type of ['blind_classification', 'timing_leakage', 'cross_tenant_access']) {
  const experiment = await request('/experiments/leakage', 'orchestrator', { type, runId: run.id, config: { samples: 12 } }, 201);
  const metrics = await request(`/experiments/${experiment.experimentId}/results`, 'auditor');
  assert.ok(metrics.length >= 3);
  assert.ok(metrics.every(metric => Number.isFinite(metric.metricValue) && metric.sampleCount === 12));
}
console.log(`PASS: execution, role denials, sanitized observations, closed evidence, signature, tamper copy, and three measured experiments. Run: ${run.id}`);
