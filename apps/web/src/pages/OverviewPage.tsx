import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useRuns, useCreateRun } from '../hooks/useApi';
import { PageHeader, Card, Badge, StatusBadge, DataTable, LoadingSpinner, EmptyState } from '../components/Layout';
import { Plus, ChevronRight, Clock } from 'lucide-react';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

export function OverviewPage({ runsOnly = false }: { runsOnly?: boolean }) {
  const role = sessionStorage.getItem('bayora-role') || 'orchestrator';
  const { data: metrics, error: metricsError } = useQuery({ queryKey: ['metrics'], queryFn: api.metrics, enabled: ['orchestrator', 'auditor'].includes(role) });
  const [offset, setOffset] = useState(0);
  const { data: runsResponse, isLoading, error, refetch } = useRuns(undefined, 10, offset);
  const createRun = useCreateRun();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({ policyVersion: 'v1.0.0', modelAdapter: 'mock-adapter', createdBy: '11111111-1111-1111-1111-111111111111' });

  const runs = runsResponse?.data || [];
  const totalRuns = runs.length;

  const statusCounts = runs.reduce((acc, run) => {
    acc[run.status] = (acc[run.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const handleCreateRun = (e: React.FormEvent) => {
    e.preventDefault();
    createRun.mutate(formData, {
      onSuccess: () => {
        setShowCreateModal(false);
        refetch();
      }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={runsOnly ? 'Evaluation runs' : 'Overview'}
        description={runsOnly ? 'Explore your runs, follow their progress, and inspect the evidence.' : 'Evaluation runs and verification status.'}
        action={role === 'orchestrator' &&
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-bayora-primary hover:bg-bayora-primary-hover text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
            disabled={createRun.isPending}
          >
            <Plus className="w-4 h-4" />
            New Run
          </button>
        }
      />

      {error && <div role="alert" className="glass-card p-5 text-bayora-danger">Could not load runs: {error.message} <button onClick={() => refetch()} className="underline">Try again</button></div>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card title="Runs on this page">
          <div className="text-4xl font-bold text-bayora-text">{totalRuns}</div>
          <p className="text-bayora-text-muted text-sm mt-1">10 runs per page</p>
        </Card>
        <Card title="Active Runs">
          <div className="text-4xl font-bold text-bayora-warning">{(statusCounts.RUNNING || 0) + (statusCounts.COMMITTED || 0)}</div>
          <p className="text-bayora-text-muted text-sm mt-1">Currently executing</p>
        </Card>
        <Card title="Completed">
          <div className="text-4xl font-bold text-bayora-success">{(statusCounts.CLOSED || 0) + (statusCounts.VERIFIED || 0)}</div>
          <p className="text-bayora-text-muted text-sm mt-1">Closed or verified on this page</p>
        </Card>
        <Card title="Verified">
          <div className="text-4xl font-bold text-bayora-primary">{statusCounts.VERIFIED || 0}</div>
          <p className="text-bayora-text-muted text-sm mt-1">Verified runs on this page</p>
        </Card>
      </div>

      {metrics?.data && <Card title="Workspace measurements"><div className="grid grid-cols-3 gap-4"><div><strong>{metrics.data.denied}</strong><p className="text-sm">Access denials</p></div><div><strong>{metrics.data.failures}</strong><p className="text-sm">Execution failures</p></div><div><strong>{metrics.data.timeouts}</strong><p className="text-sm">Target timeouts</p></div></div><p className="text-sm text-bayora-text-muted mt-4">Evidence route: {metrics.data.evidence.premature} premature releases across {metrics.data.evidence.attempts} auditor attempts. API latency (24h, n={metrics.data.latency.samples}): p50 {metrics.data.latency.p50 === null ? "not measured" : `${Number(metrics.data.latency.p50).toFixed(1)}ms`}, p95 {metrics.data.latency.p95 === null ? "not measured" : `${Number(metrics.data.latency.p95).toFixed(1)}ms`}.</p></Card>}
      {metricsError && <p role="alert">Workspace measurements are unavailable.</p>}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Recent Runs" className="lg:col-span-2">
          {isLoading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : error ? <p className="text-bayora-text-muted">Check that the API is running, then try again.</p> : runs.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No runs yet"
              description="Create your first evaluation run to start testing AI safety isolation."
              action={role === 'orchestrator' &&
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-4 py-2 bg-bayora-primary hover:bg-bayora-primary-hover text-white rounded-lg font-medium"
                >
                  Create Run
                </button>
              }
            />
          ) : (
            <DataTable
              columns={[
                { key: 'id', header: 'Run ID', render: (run) => <code className="text-bayora-text-muted">{run.id.slice(0, 8)}...</code> },
                { key: 'status', header: 'Status', render: (run) => <StatusBadge status={run.status} /> },
                { key: 'policyVersion', header: 'Policy' },
                { key: 'modelAdapter', header: 'Model' },
                { key: 'createdAt', header: 'Created', render: (run) => formatDistanceToNow(new Date(run.createdAt), { addSuffix: true }) }
              ]}
              data={runs}
              keyExtractor={(run) => run.id}
              rowAction={(run) => (
                <a href={`/runs/${run.id}`} className="text-bayora-primary hover:underline text-sm flex items-center gap-1">
                  <ChevronRight className="w-3 h-3" /> View
                </a>
              )}
            />
          )}
          <div className="flex items-center justify-between mt-5 pt-4 border-t border-bayora-border">
            <button disabled={offset === 0 || isLoading} onClick={() => setOffset(Math.max(0, offset - 10))}>Previous</button>
            <span className="text-sm text-bayora-text-muted">Page {offset / 10 + 1}</span>
            <button disabled={runs.length < 10 || isLoading || !!error} onClick={() => setOffset(offset + 10)}>Next</button>
          </div>
        </Card>

        <Card title="Execution boundaries">
          <p className="text-sm text-bayora-text-muted mb-5">The production profile uses private services and independent databases. See Threat Model for deployment assumptions.</p>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-bayora-success" />
                <span>Red/Blue separation</span>
              </div>
              <Badge>Tenant + role</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-bayora-success" />
                <span>Observation firewall</span>
              </div>
              <Badge>Implemented</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-bayora-success" />
                <span>Hash chain integrity</span>
              </div>
              <Badge>Verify per run</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-bayora-warning" />
                <span>Side-channel mitigations</span>
              </div>
              <Badge variant="warning">Partial</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-bayora-danger" />
                <span>Hardware attestation</span>
              </div>
              <Badge variant="danger">Not implemented</Badge>
            </div>
          </div>
        </Card>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-bayora-surface border border-bayora-border rounded-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Create New Run</h3>
            <form onSubmit={handleCreateRun} className="space-y-4">
              {createRun.error && <p role="alert" className="text-bayora-danger">{createRun.error.message}</p>}
              <div>
                <label className="block text-sm font-medium mb-1">Policy Version</label>
                <input
                  type="text"
                  value={formData.policyVersion}
                  onChange={(e) => setFormData({ ...formData, policyVersion: e.target.value })}
                  className="w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Model Adapter</label>
                <select
                  value={formData.modelAdapter}
                  onChange={(e) => setFormData({ ...formData, modelAdapter: e.target.value })}
                  className="w-full"
                >
                  <option value="mock-adapter">Mock Adapter (Deterministic)</option>
                  <option value="ollama-llama3.2">Ollama Llama 3.2</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-bayora-border rounded-lg hover:bg-bayora-border transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createRun.isPending}
                  className="flex-1 px-4 py-2 bg-bayora-primary hover:bg-bayora-primary-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {createRun.isPending ? 'Creating...' : 'Create Run'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
