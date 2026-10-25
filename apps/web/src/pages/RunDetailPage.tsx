import { api } from '../api/client';
import { useQuery } from '@tanstack/react-query';
import { useRun, useCommitPayload, useExecuteRun, useEvaluateRun, useCloseRun, useObservations, useEvidence, useManifest, useVerifyRun, useSignManifest, usePublicKey } from '../hooks/useApi';
import { PageHeader, Card, Badge, StatusBadge, DataTable, LoadingSpinner, EmptyState } from '../components/Layout';
import { RefreshCw, CheckCircle, XCircle, Lock, Shield, FileText, Hash, Key, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useParams } from 'react-router-dom';
import clsx from 'clsx';

export function RunDetailPage() {
  const role = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('bayora-role')) || 'orchestrator';
  const { id } = useParams<{ id: string }>();
  const { data: runData, isLoading: runLoading, error: runError, refetch: refetchRun } = useRun(id!);
  const { data: commitment } = useQuery({ queryKey: ['commitment', id, runData?.data?.status], queryFn: () => api.runs.commitment(id!), enabled: !!id });
  const { data: observationsData, refetch: refetchObservations } = useObservations(id!);
  const { data: evidenceData, refetch: refetchEvidence } = useEvidence(id!, runData?.data?.status);
  const { data: manifestData, refetch: refetchManifest } = useManifest(id!, runData?.data?.status);
  const { data: publicKeyData } = usePublicKey();

  const commitPayload = useCommitPayload();
  const executeRun = useExecuteRun();
  const evaluateRun = useEvaluateRun();
  const closeRun = useCloseRun();
  const verifyRun = useVerifyRun();
  const signManifest = useSignManifest();

  const run = runData?.data;
  const observations = observationsData?.data || [];
  const evidence = evidenceData?.data || [];
  const manifest = manifestData?.data;

  const [showCommitModal, setShowCommitModal] = useState(false);
  const [commitPayloadText, setCommitPayloadText] = useState('');
  const [showEvidenceDetail, setShowEvidenceDetail] = useState<string | null>(null);

  if (runLoading) return <div className="flex justify-center py-8"><LoadingSpinner size="lg" /></div>;
  if (runError) return <div role="alert" className="glass-card p-8">Could not load this run: {runError.message} <button className="underline" onClick={() => refetchRun()}>Try again</button></div>;
  if (!run) return <div className="text-center py-8 text-bayora-text-muted">Run not found</div>;

  const canCommit = role === 'red' && run.status === 'CREATED';
  const canExecute = role === 'orchestrator' && run.status === 'COMMITTED';
  const canEvaluate = role === 'orchestrator' && run.status === 'RUNNING';
  const canClose = role === 'orchestrator' && run.status === 'EVALUATED';
  const canVerify = ['auditor', 'orchestrator'].includes(role) && (run.status === 'CLOSED' || run.status === 'VERIFIED');
  const canSign = role === 'orchestrator' && run.status === 'CLOSED';
  const canViewEvidence = role === 'auditor' && (run.status === 'CLOSED' || run.status === 'VERIFIED');

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await commitPayload.mutateAsync({ id: run.id, payload: commitPayloadText });
      setShowCommitModal(false);
      setCommitPayloadText('');
      refetchRun();
    } catch (error) {
      console.error('Commit failed:', error);
    }
  };

  const handleExecute = async () => {
    try {
      await executeRun.mutateAsync(run.id);
      refetchRun();
    } catch (error) {
      console.error('Execute failed:', error);
    }
  };

  const handleEvaluate = async () => {
    try {
      await evaluateRun.mutateAsync(run.id);
      refetchRun();
    } catch (error) {
      console.error('Evaluate failed:', error);
    }
  };

  const handleClose = async () => {
    try {
      await closeRun.mutateAsync(run.id);
      refetchRun();
      refetchObservations();
      refetchEvidence();
    } catch (error) {
      console.error('Close failed:', error);
    }
  };

  const handleVerify = async () => {
    try {
      await verifyRun.mutateAsync(run.id);
    } catch (error) {
      console.error('Verify failed:', error);
    }
  };

  const handleSign = async () => {
    try {
      await signManifest.mutateAsync(run.id);
      refetchManifest();
    } catch (error) {
      console.error('Sign failed:', error);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Run ${run.id.slice(0, 8)}...`}
        description={`Policy: ${run.policyVersion} • Model: ${run.modelAdapter}`}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={run.status} />
            {run.status !== 'VERIFIED' && run.status !== 'CREATED' && (
              <button onClick={() => refetchRun()} className="p-2 hover:bg-bayora-border rounded-lg transition-colors" title="Refresh">
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
          </div>
        }
      />

      {commitment?.data && <Card title="Payload commitment"><code className="text-xs break-all">{commitment.data.commitmentHash}</code></Card>}
      {run.status === 'CREATED' && role !== 'red' && <p className="text-sm text-bayora-text-muted">A Red team account must commit the payload before execution.</p>}
      {[commitPayload.error, executeRun.error, evaluateRun.error, closeRun.error, verifyRun.error, signManifest.error].filter(Boolean).map((error, i) => <p key={i} role="alert" className="glass-card p-4 text-bayora-danger">{error?.message}</p>)}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Run Status" className="lg:col-span-2">
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-bayora-dark rounded-lg">
              <div>
                <p className="text-bayora-text-muted text-sm">State Machine</p>
                <p className="font-mono text-lg">{run.status}</p>
              </div>
              <StatusBadge status={run.status} />
            </div>

            <div className="flex items-center gap-4 overflow-x-auto pb-4">
              {['CREATED', 'COMMITTED', 'RUNNING', 'EVALUATED', 'CLOSED', 'VERIFIED'].map((state, i) => {
                const isCurrent = state === run.status;
                const isPast = ['CREATED', 'COMMITTED', 'RUNNING', 'EVALUATED', 'CLOSED', 'VERIFIED'].indexOf(state) < ['CREATED', 'COMMITTED', 'RUNNING', 'EVALUATED', 'CLOSED', 'VERIFIED'].indexOf(run.status);
                return (
                  <div key={state} className="flex items-center flex-shrink-0">
                    <div className={clsx('w-10 h-10 rounded-full flex items-center justify-center font-medium text-sm transition-colors',
                      isCurrent ? 'bg-bayora-primary text-white' :
                      isPast ? 'bg-bayora-success text-white' :
                      'bg-bayora-border text-bayora-text-muted'
                    )}>
                      {isPast ? <CheckCircle className="w-5 h-5" /> : String(i + 1)}
                    </div>
                    <span className={clsx('text-xs font-medium hidden sm:block whitespace-nowrap', isCurrent || isPast ? 'text-bayora-text' : 'text-bayora-text-muted')}>
                      {state}
                    </span>
                    {i < 5 && <div className={clsx('w-16 h-0.5 mx-2', isPast ? 'bg-bayora-success' : 'bg-bayora-border')} />}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="p-3 bg-bayora-dark rounded-lg">
                <p className="text-bayora-text-muted">Policy Version</p>
                <p className="font-mono">{run.policyVersion}</p>
              </div>
              <div className="p-3 bg-bayora-dark rounded-lg">
                <p className="text-bayora-text-muted">Model Adapter</p>
                <p className="font-mono">{run.modelAdapter}</p>
              </div>
              <div className="p-3 bg-bayora-dark rounded-lg">
                <p className="text-bayora-text-muted">Created</p>
                <p>{formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}</p>
              </div>
              <div className="p-3 bg-bayora-dark rounded-lg">
                <p className="text-bayora-text-muted">Closed</p>
                <p>{run.closedAt ? formatDistanceToNow(new Date(run.closedAt), { addSuffix: true }) : '-'}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Actions">
          <div className="space-y-3">
            {canCommit && (
              <button
                onClick={() => setShowCommitModal(true)}
                className="w-full px-4 py-2 bg-bayora-primary hover:bg-bayora-primary-hover text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                disabled={commitPayload.isPending}
              >
                <Lock className="w-4 h-4" /> Commit Payload
              </button>
            )}
            {canExecute && (
              <button
                onClick={handleExecute}
                className="w-full px-4 py-2 bg-bayora-primary hover:bg-bayora-primary-hover text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                disabled={executeRun.isPending}
              >
                <RotateCcw className="w-4 h-4" /> Execute
              </button>
            )}
            {canEvaluate && (
              <button
                onClick={handleEvaluate}
                className="w-full px-4 py-2 bg-bayora-warning hover:bg-amber-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                disabled={evaluateRun.isPending}
              >
                <Shield className="w-4 h-4" /> Evaluate
              </button>
            )}
            {canClose && (
              <button
                onClick={handleClose}
                className="w-full px-4 py-2 bg-bayora-success hover:bg-green-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                disabled={closeRun.isPending}
              >
                <Lock className="w-4 h-4" /> Close Run
              </button>
            )}
            {canSign && (
              <button
                onClick={handleSign}
                className="w-full px-4 py-2 bg-bayora-primary hover:bg-bayora-primary-hover text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                disabled={signManifest.isPending}
              >
                <Key className="w-4 h-4" /> Sign Manifest
              </button>
            )}
            {canVerify && (
              <button
                onClick={handleVerify}
                className="w-full px-4 py-2 border border-bayora-border hover:bg-bayora-border text-bayora-text rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                disabled={verifyRun.isPending}
              >
                <Hash className="w-4 h-4" /> Verify Integrity
              </button>
            )}

          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Released Observations">
          {observations.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No observations released"
              description="Approved observations appear after evaluation. Raw evidence remains restricted until closure."
            />
          ) : (
            <DataTable
              columns={[
                { key: 'caseId', header: 'Case', render: (o) => <code className="text-sm">{o.caseId}</code> },
                { key: 'outcome', header: 'Outcome' },
                { key: 'severity', header: 'Severity', render: (o) => <Badge variant={o.severity === 'critical' || o.severity === 'high' ? 'danger' : o.severity === 'medium' ? 'warning' : 'success'}>{o.severity}</Badge> },
                { key: 'confidence', header: 'Confidence', render: (o) => `${Math.round(o.confidence * 100)}%` },
                { key: 'releasedAt', header: 'Released', render: (o) => formatDistanceToNow(new Date(o.releasedAt), { addSuffix: true }) }
              ]}
              data={observations}
              keyExtractor={(o) => o.id}
            />
          )}
        </Card>

        <Card title={canViewEvidence ? 'Evidence Artifacts (Auditor Only)' : 'Evidence Artifacts (Locked)'}>
          {canViewEvidence ? (
            evidence.length === 0 ? (
              <EmptyState icon={FileText} title="No evidence artifacts" description="Raw evidence will appear here after run closure." />
            ) : (
              <DataTable
                columns={[
                  { key: 'artifactType', header: 'Type', render: (e) => <Badge variant="primary">{e.artifactType}</Badge> },
                  { key: 'accessClass', header: 'Access', render: (e) => <Badge variant={e.accessClass === 'raw_evidence' ? 'danger' : 'default'}>{e.accessClass}</Badge> },
                  { key: 'digest', header: 'Digest', render: (e) => <code className="text-xs">{e.digest.slice(0, 16)}...</code> },
                  { key: 'createdAt', header: 'Created', render: (e) => formatDistanceToNow(new Date(e.createdAt), { addSuffix: true }) }
                ]}
                data={evidence}
                keyExtractor={(e) => e.id}
                rowAction={(e) => (
                  <button
                    onClick={() => setShowEvidenceDetail(e.id)}
                    className="text-bayora-primary hover:underline text-sm"
                  >
                    View
                  </button>
                )}
              />
            )
          ) : (
            <div className="text-center py-8 text-bayora-text-muted">
              <Lock className="w-12 h-12 mx-auto mb-4 text-bayora-border" />
              <p>Sign in as an auditor after closure to inspect evidence</p>
              <p className="text-sm mt-1">Status: {run.status}</p>
            </div>
          )}
        </Card>
      </div>

      {manifest && (
        <Card title="Signed Manifest">
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="p-3 bg-bayora-dark rounded-lg">
                <p className="text-bayora-text-muted">Merkle Root</p>
                <p className="font-mono text-xs truncate">{manifest.merkleRoot}</p>
              </div>
              <div className="p-3 bg-bayora-dark rounded-lg">
                <p className="text-bayora-text-muted">Final Chain Hash</p>
                <p className="font-mono text-xs truncate">{manifest.finalChainHash}</p>
              </div>
              <div className="p-3 bg-bayora-dark rounded-lg">
                <p className="text-bayora-text-muted">Event Count</p>
                <p className="font-mono">{manifest.eventCount}</p>
              </div>
              <div className="p-3 bg-bayora-dark rounded-lg">
                <p className="text-bayora-text-muted">Public Key ID</p>
                <p className="font-mono text-xs">{manifest.publicKeyId}</p>
              </div>
            </div>
            <div className="p-3 bg-bayora-dark rounded-lg">
              <p className="text-bayora-text-muted text-sm mb-1">Signature (Ed25519)</p>
              <code className="text-xs truncate block">{manifest.signature}</code>
            </div>
            {publicKeyData?.data && (
              <div className="p-3 bg-bayora-dark rounded-lg">
                <p className="text-bayora-text-muted text-sm mb-1">Verification Public Key</p>
                <code className="text-xs truncate block">{publicKeyData.data.publicKey}</code>
              </div>
            )}
          </div>
        </Card>
      )}

      {showCommitModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-bayora-surface border border-bayora-border rounded-xl p-6 w-full max-w-2xl">
            <h3 className="text-xl font-bold mb-4">Commit Payload (Red Team Only)</h3>
            <form onSubmit={handleCommit} className="space-y-4">
              <p className="text-bayora-text-muted text-sm">Enter the adversarial payload. Only its SHA-256 commitment will be stored.</p>
              <textarea
                value={commitPayloadText}
                onChange={(e) => setCommitPayloadText(e.target.value)}
                rows={8}
                className="w-full font-mono text-sm resize-none"
                placeholder="Enter adversarial prompt..."
                required
              />
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowCommitModal(false)} className="flex-1 px-4 py-2 border border-bayora-border rounded-lg hover:bg-bayora-border transition-colors">Cancel</button>
                <button type="submit" disabled={commitPayload.isPending} className="flex-1 px-4 py-2 bg-bayora-primary hover:bg-bayora-primary-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50">{commitPayload.isPending ? 'Committing...' : 'Commit Payload'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEvidenceDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-bayora-surface border border-bayora-border rounded-xl p-6 w-full max-w-3xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">Evidence Detail</h3>
              <button onClick={() => setShowEvidenceDetail(null)} className="p-2 hover:bg-bayora-border rounded-lg">✕</button>
            </div>
            <pre className="bg-bayora-dark p-4 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap font-mono">
              {JSON.stringify(evidence.find(e => e.id === showEvidenceDetail), null, 2)}
            </pre>
          </div>
        </div>
      )}

      {verifyRun.data && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-bayora-surface border border-bayora-border rounded-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Verification Result</h3>
            <div className={`p-4 rounded-lg ${verifyRun.data.data?.valid ? 'bg-green-500/20 border border-green-500/30' : 'bg-red-500/20 border border-red-500/30'}`}>
              <div className="flex items-center gap-3 mb-4">
                {verifyRun.data.data?.valid ? (
                  <CheckCircle className="w-8 h-8 text-green-700" />
                ) : (
                  <XCircle className="w-8 h-8 text-red-700" />
                )}
                <div>
                  <p className="text-lg font-bold">{verifyRun.data.data?.valid ? 'VERIFIED' : 'TAMPERED'}</p>
                  <p className="text-sm text-bayora-text-muted">Hash chain integrity check</p>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                {verifyRun.data.data?.checks?.map((check, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span>{check.name}</span>
                    <Badge variant={check.passed ? 'success' : 'danger'}>{check.passed ? 'PASS' : 'FAIL'}</Badge>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => verifyRun.reset()} className="w-full mt-4 px-4 py-2 border border-bayora-border rounded-lg hover:bg-bayora-border transition-colors">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
