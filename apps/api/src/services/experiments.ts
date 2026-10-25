import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { query } from '../db/client.js';
import { getRun, createLeakageExperiment, completeLeakageExperiment } from './run.js';
import { observationFirewall } from './firewall.js';
import { probeSession } from '../security/accounts.js';
import { tenantId } from '../security/context.js';
import { randomUUID } from 'node:crypto';

type Metric = { metricName: string; metricValue: number; sampleCount: number; method: string };

export function wilsonInterval(correct: number, samples: number): [number, number] {
  if (samples < 1 || correct < 0 || correct > samples) throw new Error('Invalid binomial sample');
  const z = 1.959963984540054, p = correct / samples, denominator = 1 + z * z / samples;
  const center = (p + z * z / (2 * samples)) / denominator;
  const radius = z * Math.sqrt(p * (1 - p) / samples + z * z / (4 * samples * samples)) / denominator;
  return [Math.max(0, 100 * (center - radius)), Math.min(100, 100 * (center + radius))];
}

export function classificationMetrics(samples: number): Metric[] {
  let exposed = 0, filtered = 0;
  const counts = [0, 0, 0];
  for (let i = 0; i < samples; i++) {
    const label = i % 3;
    counts[label]++;
    const raw = { runId: 'synthetic', caseId: randomUUID(), prompt: `hidden-class:${label}`, response: `hidden-class:${label}` };
    const predict = (view: object) => Number(JSON.stringify(view).match(/hidden-class:(\d)/)?.[1] || 0);
    exposed += Number(predict(raw) === label);
    filtered += Number(predict(observationFirewall.sanitizeForBlue(raw)) === label);
  }
  const metric = (metricName: string, correct: number): Metric => ({ metricName, metricValue: 100 * correct / samples, sampleCount: samples,
    method: `Percent correct; fixed marker classifier, missing marker predicts class 0; class counts ${counts.join('/')}; synthetic channel only` });
  const result = [metric('Chance baseline (%)', samples / 3), metric('Firewall OFF accuracy (%)', exposed), metric('Firewall ON accuracy (%)', filtered)];
  for (const [name, correct] of [['OFF', exposed], ['ON', filtered]] as const) {
    const bounds = wilsonInterval(correct, samples);
    for (const [index, label] of ['lower', 'upper'].entries()) result.push({ metricName: `Firewall ${name} 95% interval ${label} (%)`, metricValue: bounds[index], sampleCount: samples, method: 'Wilson score interval, z=1.959964; illustrative synthetic marker sample, not population-wide security assurance' });
  }
  return result;
}

export async function runLeakageExperiment(input: { type: string; runId: string; config: Record<string, unknown> }) {
  const run = await getRun(input.runId);
  if (!run || !['CLOSED', 'VERIFIED'].includes(run.status)) throw new Error('Select a closed run');
  const requested = z.number().int().min(6).max(120).parse(input.config.samples ?? input.config.attempts ?? 30);
  const samples = Math.ceil(requested / 6) * 6;
  const id = await createLeakageExperiment(input as Parameters<typeof createLeakageExperiment>[0]);
  try {
    let metrics: Metric[] = [];
    if (input.type === 'blind_classification') {
      metrics = classificationMetrics(samples);
    } else if (input.type === 'timing_leakage') {
      const timings: number[] = [];
      let rawCorrect = 0, bucketCorrect = 0;
      for (let i = 0; i < samples; i++) {
        const label = i % 2;
        const start = performance.now();
        await delay(label ? 16 : 4);
        const elapsed = performance.now() - start;
        timings.push(elapsed);
        rawCorrect += Number(Number(elapsed >= 10) === label);
        bucketCorrect += Number(Number(Math.floor(elapsed / 100) * 100 >= 10) === label);
      }
      const sorted = timings.slice().sort((a, b) => a - b);
      const metric = (metricName: string, metricValue: number): Metric => ({ metricName, metricValue, sampleCount: samples, method: 'Balanced 4/16ms timer tasks; preselected 10ms threshold; 100ms buckets; OS scheduling affects results' });
      metrics = [metric('Chance baseline (%)', 50), metric('Raw timing accuracy (%)', 100 * rawCorrect / samples), metric('Bucketed timing accuracy (%)', 100 * bucketCorrect / samples), metric('p50 latency (ms)', sorted[Math.floor(samples * .5)]), metric('p95 latency (ms)', sorted[Math.min(samples - 1, Math.floor(samples * .95))])];
      for (const [low, high] of [[0, 10], [10, 20], [20, 50], [50, 100], [100, Infinity]]) metrics.push(metric(`Raw timing ${low}-${Number.isFinite(high) ? high : 'plus'}ms count`, timings.filter(ms => ms >= low && ms < high).length));
    } else if (input.type === 'cross_tenant_access') {
      const foreignTenant = randomUUID();
      await query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [foreignTenant, 'Temporary access experiment']);
      try {
      for (const [role, route, foreign] of [['blue', 'red-payload', false], ['red', 'blue-rules', false], ['blue', 'evidence', false], ['auditor', '', true]] as const) {
        const probe = await probeSession(foreign ? foreignTenant : tenantId(), role);
        let denied = 0;
        try {
        for (let i = 0; i < samples; i++) {
          const response = await fetch(`http://127.0.0.1:${process.env.PORT || '3001'}/api/v1/runs/${input.runId}${route ? '/' + route : ''}`, {
            headers: process.env.AUTH_MODE === 'demo' && process.env.NODE_ENV !== 'production' ? { 'X-Service-ID': 'access-experiment', 'X-Service-Role': role } : { Authorization: `Bearer ${probe.token}` }, signal: AbortSignal.timeout(5000)
          });
          denied += Number(response.status === 403);
          await response.arrayBuffer();
        }
        metrics.push({ metricName: `${foreign ? 'Other tenant' : role} to ${route || 'run session'} denied (%)`, metricValue: 100 * denied / samples, sampleCount: samples, method: 'Actual HTTP requests using short-lived server-issued sessions; expected 403; every denial is logged' });
        } finally { await probe.cleanup(); }
      }
      } finally { await query('DELETE FROM tenants WHERE id = $1', [foreignTenant]); }
    } else throw new Error('Unsupported experiment type');
    await completeLeakageExperiment(id, metrics);
    return id;
  } catch (error) {
    await query("UPDATE experiments SET status = 'FAILED', finished_at = NOW() WHERE id = $1", [id]);
    throw error;
  }
}
