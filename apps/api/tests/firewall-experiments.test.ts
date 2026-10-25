import { expect, it } from 'vitest';
import { ObservationFirewall } from '../src/services/firewall.js';
import { classificationMetrics, wilsonInterval } from '../src/services/experiments.js';

it('does not expose raw model output, prompts, hidden labels or timing to Blue', () => {
  const firewall = new ObservationFirewall();
  const result = firewall.sanitizeForBlue({ runId: 'r', caseId: 'case-1', prompt: 'secret', response: 'secret repeated by model', hiddenLabels: { category: 'secret' }, timing: { tokens: 123 } });
  expect(result).toEqual({ caseId: 'case-1', outcome: 'not_tested' });
});
it('computes measured classification results from balanced samples', () => {
  const metrics = classificationMetrics(12);
  expect(metrics.every(metric => metric.sampleCount === 12)).toBe(true);
  expect(metrics[1].metricValue).toBe(100);
  expect(metrics[2].metricValue).toBeCloseTo(100 / 3);
});
it('keeps Wilson uncertainty within probability bounds including perfect observed accuracy', () => {
  expect(wilsonInterval(12, 12)[0]).toBeLessThan(100);
  expect(wilsonInterval(0, 12)[1]).toBeGreaterThan(0);
  expect(wilsonInterval(6, 12)[0]).toBeCloseTo(25.38, 1);
  expect(() => wilsonInterval(0, 0)).toThrow();
});
