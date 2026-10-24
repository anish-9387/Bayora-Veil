import { expect, it } from 'vitest';
import { ObservationFirewall } from '../src/services/firewall.js';
import { classificationMetrics } from '../src/services/experiments.js';

it('does not expose raw model output, prompts, hidden labels or timing to Blue', () => {
  const firewall = new ObservationFirewall();
  const result = firewall.sanitizeForBlue({ runId: 'r', caseId: 'case-1', prompt: 'secret', response: 'secret repeated by model', hiddenLabels: { category: 'secret' }, timing: { tokens: 123 } });
  expect(result).toEqual({ caseId: 'case-1', outcome: 'not_tested' });
});
it('computes measured classification results from balanced samples', () => {
  const metrics = classificationMetrics(12);
  expect(metrics.map(metric => metric.sampleCount)).toEqual([12, 12, 12]);
  expect(metrics[1].metricValue).toBe(100);
  expect(metrics[2].metricValue).toBeCloseTo(100 / 3);
});
