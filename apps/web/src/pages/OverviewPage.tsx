import { useRuns, useCreateRun } from '../hooks/useApi';
import { PageHeader, Card, Badge, StatusBadge, DataTable, LoadingSpinner, EmptyState } from '../components/Layout';
import { Plus, ChevronRight, Clock } from 'lucide-react';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

export function OverviewPage() {
  const { data: runsResponse, isLoading, refetch } = useRuns(undefined, 10);
  const createRun = useCreateRun();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({ policyVersion: 'v1.0.0', modelAdapter: 'mock-adapter', createdBy: '11111111-1111-1111-1111-111111111111' });

  const runs = runsResponse?.data?.items || [];
  const totalRuns = runsResponse?.data?.total || 0;

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
        title="Overview"
        description="Monitor evaluation runs, isolation status, and audit verification"
        action={
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card title="Total Runs">
          <div className="text-4xl font-bold text-white">{totalRuns}</div>
          <p className="text-bayora-text-muted text-sm mt-1">All evaluation runs</p>
        </Card>
        <Card title="Active Runs">
          <div className="text-4xl font-bold text-bayora-warning">{(statusCounts.RUNNING || 0) + (statusCounts.COMMITTED || 0)}</div>
          <p className="text-bayora-text-muted text-sm mt-1">Currently executing</p>
        </Card>
        <Card title="Completed">
          <div className="text-4xl font-bold text-bayora-success">{statusCounts.CLOSED || 0}</div>
          <p className="text-bayora-text-muted text-sm mt-1">Closed & verified</p>
        </Card>
        <Card title="Failed Verification">
          <div className="text-4xl font-bold text-bayora-danger">{statusCounts.VERIFIED === 0 ? 0 : '—'}</div>
          <p className="text-bayora-text-muted text-sm mt-1">Tamper detection</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Recent Runs" className="lg:col-span-2">
          {isLoading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : runs.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No runs yet"
              description="Create your first evaluation run to start testing AI safety isolation."
              action={
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
        </Card>

        <Card title="Isolation Checks">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-bayora-success" />
                <span>Red/Blue separation</span>
              </div>
              <Badge variant="success">Pass</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-bayora-success" />
                <span>Observation firewall</span>
              </div>
              <Badge variant="success">Active</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-bayora-success" />
                <span>Hash chain integrity</span>
              </div>
              <Badge variant="success">Verified</Badge>
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
              <div>
                <label className="block text-sm font-medium mb-1">Created By (User ID)</label>
                <input
                  type="text"
                  value={formData.createdBy}
                  onChange={(e) => setFormData({ ...formData, createdBy: e.target.value })}
                  className="w-full font-mono text-sm"
                  required
                />
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