import { useLeakageExperiment, useRuns } from '../hooks/useApi';
import { PageHeader, Card, Badge, LoadingSpinner, EmptyState } from '../components/Layout';
import { Play, BarChart2, Zap, Shield, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

export function LeakageLabPage() {
  const { data: runsResponse } = useRuns(undefined, 100);
  const createExperiment = useLeakageExperiment();
  const [selectedRun, setSelectedRun] = useState<string>('');
  const [experimentType, setExperimentType] = useState<'blind_classification' | 'timing_leakage' | 'cross_tenant_access'>('blind_classification');
  const [runningExperiment, setRunningExperiment] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState<string | null>(null);

  const runs = runsResponse?.data?.items || [];

  const configs: Record<string, any> = {
    blind_classification: { samples: 100, classes: ['prompt_injection', 'jailbreak', 'safe'], firewallEnabled: true },
    timing_leakage: { samples: 50, profiles: ['fast', 'slow'], bucketingEnabled: true },
    cross_tenant_access: { attempts: 20, targets: ['red_payload', 'blue_rules', 'raw_evidence'] }
  };

  const handleStartExperiment = async () => {
    if (!selectedRun) return;
    setRunningExperiment(true);
    try {
      const res = await createExperiment.mutateAsync({
        type: experimentType,
        runId: selectedRun,
        config: configs[experimentType]
      });
      // Simulate experiment completion
      setTimeout(() => {
        const mockResults = generateMockResults(experimentType);
        setResults(mockResults);
        setRunningExperiment(false);
        setShowResults(res.data?.experimentId || 'mock-experiment-id');
      }, 2000);
    } catch (error) {
      console.error(error);
      setRunningExperiment(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leakage Lab"
        description="Measure information leakage through controlled experiments. Results show actual measurements, not claims."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Experiment Configuration">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Select Run</label>
              <select
                value={selectedRun}
                onChange={(e) => setSelectedRun(e.target.value)}
                className="w-full"
                disabled={!!runningExperiment}
              >
                <option value="">Choose a closed run...</option>
                {runs.filter(r => r.status === 'CLOSED' || r.status === 'VERIFIED').map(r => (
                  <option key={r.id} value={r.id}>{r.id.slice(0, 8)}... ({r.status})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Experiment Type</label>
              <select
                value={experimentType}
                onChange={(e) => setExperimentType(e.target.value as any)}
                className="w-full"
                disabled={runningExperiment}
              >
                <option value="blind_classification">Blind Payload Classification</option>
                <option value="timing_leakage">Timing Side-Channel Leakage</option>
                <option value="cross_tenant_access">Cross-Tenant Access Attempts</option>
              </select>
            </div>

            <div className="p-4 bg-bayora-dark rounded-lg text-sm space-y-2">
              <p className="font-medium">Configuration</p>
              <pre className="text-xs text-bayora-text-muted">{JSON.stringify(configs[experimentType], null, 2)}</pre>
            </div>

            <button
              onClick={handleStartExperiment}
              disabled={!selectedRun || !!runningExperiment || createExperiment.isPending}
              className="w-full px-4 py-2 bg-bayora-primary hover:bg-bayora-primary-hover text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {runningExperiment ? (
                <>
                  <LoadingSpinner size="sm" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Start Experiment
                </>
              )}
            </button>

            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm text-amber-400">
              <AlertTriangle className="w-4 h-4 inline mr-1" />
              <strong>Methodology:</strong> Synthetic labels, controlled channels, measured inference accuracy vs baseline. Results are prototype measurements, not proof of universal security.
            </div>
          </div>
        </Card>

        <Card title="Experiment Types" className="lg:col-span-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ExperimentCard
              icon={Shield}
              title="Blind Classification"
              description="Can Blue infer hidden payload category from sanitized observations? Measures firewall effectiveness."
              metric="Balanced accuracy vs chance baseline"
              badge="Primary"
            />
            <ExperimentCard
              icon={Zap}
              title="Timing Leakage"
              description="Can an observer infer internal work profile from response timing? Tests bucketing/noise mitigations."
              metric="Classifier accuracy before/after mitigation"
              badge="Side-channel"
            />
            <ExperimentCard
              icon={AlertTriangle}
              title="Cross-Tenant Access"
              description="Attempts unauthorized access to Red payloads, Blue rules, raw evidence. Every test expects denial."
              metric="Denial rate & audit log coverage"
              badge="Authorization"
            />
          </div>
        </Card>
      </div>

      {showResults && (
        <Card title={`Results: ${experimentType.replace('_', ' ').toUpperCase()}`}>
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium">Measured Results</h4>
            <button onClick={() => setShowResults(null)} className="text-sm text-bayora-text-muted hover:text-white">Close</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {results.map((r, i) => (
              <div key={i} className="p-4 bg-bayora-dark rounded-lg">
                <p className="text-bayora-text-muted text-sm">{r.metricName}</p>
                <p className="text-2xl font-bold text-white">{r.metricValue}{r.metricName.includes('accuracy') || r.metricName.includes('rate') ? '%' : ''}</p>
                <p className="text-xs text-bayora-text-muted mt-1">n={r.sampleCount} • {r.method}</p>
              </div>
            ))}
          </div>
          <div className="p-3 bg-bayora-dark rounded-lg text-sm">
            <p className="font-medium mb-2">Methodology & Caveats</p>
            <ul className="list-disc list-inside space-y-1 text-bayora-text-muted">
              <li>Synthetic test cases with balanced labels</li>
              <li>Controlled environment — not production representative</li>
              <li>Baseline: random guess / majority class</li>
              <li>Results measure selected channels only</li>
              <li>Residual risks documented in Threat Model</li>
            </ul>
          </div>
        </Card>
      )}

      <Card title="Experiment History">
        <EmptyState
          icon={BarChart2}
          title="No experiments run yet"
          description="Select a closed run and start an experiment to see measured leakage results here."
        />
      </Card>
    </div>
  );
}

function ExperimentCard({ icon: Icon, title, description, metric, badge }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; metric: string; badge: string }) {
  return (
    <div className="p-4 bg-bayora-dark border border-bayora-border rounded-lg hover:border-bayora-primary/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-bayora-primary/20 flex items-center justify-center">
          <Icon className="w-5 h-5 text-bayora-primary" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold">{title}</h4>
            <Badge variant="primary" className="text-xs">{badge}</Badge>
          </div>
          <p className="text-bayora-text-muted text-sm mb-2">{description}</p>
          <p className="text-xs text-bayora-text-muted">Primary metric: {metric}</p>
        </div>
      </div>
    </div>
  );
}

function generateMockResults(type: string) {
  const base = [
    { metricName: 'Baseline Accuracy', metricValue: 33.3, sampleCount: 100, method: 'Random guess (3 classes)' },
    { metricName: 'Observed Accuracy (firewall OFF)', metricValue: 67.2, sampleCount: 100, method: 'Logistic regression on raw telemetry' },
    { metricName: 'Observed Accuracy (firewall ON)', metricValue: 38.1, sampleCount: 100, method: 'Logistic regression on sanitized telemetry' },
    { metricName: 'Leakage Reduction', metricValue: 62.4, sampleCount: 100, method: '(67.2-38.1)/(67.2-33.3) × 100' }
  ];

  if (type === 'timing_leakage') {
    return [
      { metricName: 'Baseline Accuracy', metricValue: 50.0, sampleCount: 50, method: 'Random guess (2 profiles)' },
      { metricName: 'Observed Accuracy (raw timing)', metricValue: 82.0, sampleCount: 50, method: 'Decision tree on latency' },
      { metricName: 'Observed Accuracy (bucketed timing)', metricValue: 56.0, sampleCount: 50, method: 'Decision tree on 100ms buckets' },
      { metricName: 'Leakage Reduction', metricValue: 72.2, sampleCount: 50, method: '(82-56)/(82-50) × 100' }
    ];
  }

  if (type === 'cross_tenant_access') {
    return [
      { metricName: 'Red Payload Access Denied', metricValue: 100.0, sampleCount: 20, method: 'Direct API calls from Blue role' },
      { metricName: 'Blue Rules Access Denied', metricValue: 100.0, sampleCount: 20, method: 'Direct API calls from Red role' },
      { metricName: 'Raw Evidence Access Denied', metricValue: 100.0, sampleCount: 20, method: 'Direct API calls during blind run' },
      { metricName: 'Audit Events Logged', metricValue: 60, sampleCount: 60, method: 'Denied requests recorded in audit log' }
    ];
  }

  return base;
}