import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useLeakageExperiment, useRuns } from '../hooks/useApi';
import { PageHeader, Card, Badge, LoadingSpinner, EmptyState } from '../components/Layout';
import { Play, BarChart2, Zap, Shield, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

export function LeakageLabPage() {
  const { data: runsResponse, error: runsError } = useRuns(undefined, 100);
  const { data: history, error: historyError, refetch: refreshHistory } = useQuery({ queryKey: ['experiments'], queryFn: api.experiments.list });
  const createExperiment = useLeakageExperiment();
  const [selectedRun, setSelectedRun] = useState<string>('');
  const [experimentType, setExperimentType] = useState<'blind_classification' | 'timing_leakage' | 'cross_tenant_access'>('blind_classification');
  const [error, setError] = useState('');
  const [runningExperiment, setRunningExperiment] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState<string | null>(null);

  const runs = runsResponse?.data || [];

  const configs: Record<string, any> = {
    blind_classification: { samples: 96, classes: ['class-0', 'class-1', 'class-2'], comparison: 'firewall OFF / ON' },
    timing_leakage: { samples: 48, profiles: ['4ms', '16ms'], bucketMs: 100 },
    cross_tenant_access: { attempts: 18, targets: ['red_payload', 'blue_rules', 'raw_evidence'] }
  };

  const handleStartExperiment = async () => {
    if (!selectedRun) return;
    setRunningExperiment(true);
    setError('');
    try {
      const res = await createExperiment.mutateAsync({
        type: experimentType,
        runId: selectedRun,
        config: configs[experimentType]
      });
      if (!res.data) throw new Error('Experiment did not return an ID');
      const measured = await api.experiments.getResults(res.data.experimentId);
      setResults(measured.data || []);
      setShowResults(res.data.experimentId);
      void refreshHistory();
      setRunningExperiment(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Experiment failed');
      setRunningExperiment(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leakage Lab"
        description="Measure information leakage through controlled experiments. Compare raw and filtered channels using repeatable synthetic tests."
      />

      {runsError && <p role="alert" className="text-bayora-danger">Could not load runs: {runsError.message}. Select Orchestrator or Auditor to browse runs.</p>}
      {error && <p role="alert" className="text-bayora-danger">{error}</p>}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Experiment Configuration">
          <div className="space-y-4">
            <div>
              <label htmlFor="experiment-run" className="block text-sm font-medium mb-1">Select Run</label>
              <select
                id="experiment-run"
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
              <label htmlFor="experiment-type" className="block text-sm font-medium mb-1">Experiment Type</label>
              <select
                id="experiment-type"
                value={experimentType}
                onChange={(e) => setExperimentType(e.target.value as any)}
                className="w-full"
                disabled={runningExperiment}
              >
                <option value="blind_classification">Blind Payload Classification</option>
                <option value="timing_leakage">Timing Side-Channel Leakage</option>
                <option value="cross_tenant_access">Cross-Role Access Attempts</option>
              </select>
            </div>

            <div className="p-4 bg-bayora-dark rounded-lg text-sm space-y-2">
              <p className="font-medium">Configuration</p>
              <p className="text-bayora-text-muted">{configs[experimentType].samples || configs[experimentType].attempts} samples per comparison</p>
              <p className="text-bayora-text-muted">{experimentType === 'blind_classification' ? 'Three balanced classes. Compare the same marker classifier with the firewall off and on.' : experimentType === 'timing_leakage' ? 'Compare 4ms and 16ms tasks, before and after 100ms timing buckets.' : 'Try Red payload, Blue rule, and evidence routes from disallowed roles.'}</p>
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

            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 inline mr-1" />
              <strong>Methodology:</strong> Synthetic labels, controlled channels, measured inference accuracy vs baseline. Results are prototype measurements, not proof of universal security.
            </div>
          </div>
        </Card>

        <Card title="Experiment Types" className="lg:col-span-2">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
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
              description="Can an observer infer internal work profile from response timing? Compares raw timings with 100ms buckets."
              metric="Classifier accuracy before/after mitigation"
              badge="Side-channel"
            />
            <ExperimentCard
              icon={AlertTriangle}
              title="Tenant & Role Access"
              description="Attempts unauthorized access to Red payloads, Blue rules, raw evidence and another tenant’s run session. Every test expects denial."
              metric="HTTP denial rate"
              badge="Authorization"
            />
          </div>
        </Card>
      </div>

      {showResults && (
        <Card title={`Results: ${experimentType.replace('_', ' ').toUpperCase()}`}>
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium">Measured Results</h4>
            <button onClick={() => setShowResults(null)} className="text-sm text-bayora-text-muted hover:text-bayora-text">Close</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {results.map((r, i) => (
              <div key={i} className="p-4 bg-bayora-dark rounded-lg">
                <p className="text-bayora-text-muted text-sm">{r.metricName}</p>
                <p className="text-2xl font-bold text-bayora-text">{Number(r.metricValue).toFixed(2)}</p>
                <p className="text-xs text-bayora-text-muted mt-1">n={r.sampleCount} • {r.method}</p>
              </div>
            ))}
          </div>
          <div className="p-3 bg-bayora-dark rounded-lg text-sm">
            <p className="font-medium mb-2">Methodology & Caveats</p>
            <ul className="list-disc list-inside space-y-1 text-bayora-text-muted">
              <li>Synthetic test cases with balanced labels</li>
              <li>Controlled environment - not production representative</li>
              <li>Baseline: random guess / majority class</li>
              <li>Results measure selected channels only</li>
              <li>Residual risks documented in Threat Model</li>
            </ul>
          </div>
        </Card>
      )}

      <Card title="Experiment History">
        {historyError && <p role="alert">Could not load saved experiments.</p>}
        {!history?.data?.length ? <EmptyState icon={BarChart2} title="No saved experiments" description="Start a comparison on a closed run." /> : <div className="space-y-3">{history.data.map(item => <button key={item.id} className="block w-full text-left rounded-xl border p-4" onClick={async () => { try { const result = await api.experiments.getResults(item.id); setResults(result.data || []); setExperimentType(item.type as typeof experimentType); setShowResults(item.id); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load results'); } }}>{item.type.replace(/_/g, ' ')} · {item.status}<span className="block text-xs text-bayora-text-muted">{new Date(item.started_at).toLocaleString()}</span></button>)}</div>}
      </Card>
    </div>
  );
}

function ExperimentCard({ icon: Icon, title, description, metric, badge }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; metric: string; badge: string }) {
  return (
    <div className="p-4 bg-bayora-dark border border-bayora-border rounded-lg hover:border-bayora-primary/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 min-w-10 shrink-0 aspect-square rounded-full bg-bayora-primary/20 flex items-center justify-center">
          <Icon className="w-5 h-5 text-bayora-primary" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
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
