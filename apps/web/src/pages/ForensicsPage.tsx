import { useRun, useManifest, useVerifyRun, useRuns } from '../hooks/useApi';
import { PageHeader, Card, Badge, DataTable, LoadingSpinner, EmptyState } from '../components/Layout';
import { Hash, Key, AlertTriangle, CheckCircle, XCircle, ChevronRight, RefreshCw, FileText, Search, Shield } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';

export function ForensicsPage() {
  const { data: runsResponse } = useRuns(undefined, 100);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const { data: runData } = useRun(selectedRunId);
  const { data: manifestData } = useManifest(selectedRunId);
  const verifyRun = useVerifyRun();
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [showTamperDemo, setShowTamperDemo] = useState(false);

  const runs = runsResponse?.data?.items || [];
  const run = runData?.data;
  const manifest = manifestData?.data;

  const handleVerify = async () => {
    if (!selectedRunId) return;
    try {
      const result = await verifyRun.mutateAsync(selectedRunId);
      setVerifyResult(result.data);
    } catch (error) {
      console.error(error);
    }
  };

  const handleTamperDemo = () => {
    setShowTamperDemo(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Forensics"
        description="Verify run integrity, inspect hash chains, and demonstrate tamper detection"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Select Run">
          <select
            value={selectedRunId}
            onChange={(e) => setSelectedRunId(e.target.value)}
            className="w-full mb-4"
          >
            <option value="">Choose a run...</option>
            {runs.map(r => (
              <option key={r.id} value={r.id}>{r.id.slice(0, 8)}... ({r.status})</option>
            ))}
          </select>

          {run && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-bayora-text-muted">Status</span>
                <Badge variant={run.status === 'VERIFIED' ? 'success' : run.status === 'CLOSED' ? 'primary' : 'default'}>{run.status}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-bayora-text-muted">Policy</span>
                <code>{run.policyVersion}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-bayora-text-muted">Model</span>
                <code>{run.modelAdapter}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-bayora-text-muted">Created</span>
                <span>{formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}</span>
              </div>
            </div>
          )}
        </Card>

        <Card title="Verification Actions" className="lg:col-span-2">
          {selectedRunId ? (
            <div className="space-y-4">
              <button
                onClick={handleVerify}
                disabled={verifyRun.isPending}
                className="w-full px-4 py-3 bg-bayora-primary hover:bg-bayora-primary-hover text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {verifyRun.isPending ? <LoadingSpinner size="sm" /> : <Hash className="w-5 h-5" />}
                {verifyRun.isPending ? 'Verifying...' : 'Verify Hash Chain & Manifest'}
              </button>

              <button
                onClick={handleTamperDemo}
                className="w-full px-4 py-3 border border-bayora-border hover:bg-bayora-border text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <AlertTriangle className="w-5 h-5" />
                Run Tamper Demonstration
              </button>

              {verifyResult && (
                <div className={`p-4 rounded-lg ${verifyResult.valid ? 'bg-green-500/20 border border-green-500/30' : 'bg-red-500/20 border border-red-500/30'}`}>
                  <div className="flex items-center gap-3 mb-3">
                    {verifyResult.valid ? (
                      <CheckCircle className="w-8 h-8 text-green-400" />
                    ) : (
                      <XCircle className="w-8 h-8 text-red-400" />
                    )}
                    <div>
                      <p className="text-lg font-bold">{verifyResult.valid ? 'VERIFICATION PASSED' : 'TAMPERING DETECTED'}</p>
                      <p className="text-sm text-bayora-text-muted">Run integrity status</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    {verifyResult.checks.map((check: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-bayora-dark rounded">
                        <span className="truncate">{check.name}</span>
                        <Badge variant={check.passed ? 'success' : 'danger'} className="text-xs">{check.passed ? 'PASS' : 'FAIL'}</Badge>
                      </div>
                    ))}
                  </div>
                  {verifyResult.tamperedEvents && verifyResult.tamperedEvents.length > 0 && (
                    <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <p className="font-medium text-red-400 mb-2">Tampered Events:</p>
                      <ul className="list-disc list-inside text-sm space-y-1">
                        {verifyResult.tamperedEvents.map((e: any) => (
                          <li key={e.sequence}>Sequence {e.sequence}: expected {e.expectedHash.slice(0, 16)}..., got {e.actualHash.slice(0, 16)}...</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={Search}
              title="Select a run"
              description="Choose a run from the left panel to verify its integrity and inspect the audit trail."
            />
          )}
        </Card>
      </div>

      {manifest && (
        <Card title="Signed Manifest Details">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <ManifestField label="Merkle Root" value={manifest.merkleRoot} icon={Hash} />
            <ManifestField label="Final Chain Hash" value={manifest.finalChainHash} icon={Hash} />
            <ManifestField label="Event Count" value={String(manifest.eventCount)} icon={FileText} />
            <ManifestField label="Public Key ID" value={manifest.publicKeyId} icon={Key} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 bg-bayora-dark rounded-lg">
              <p className="text-bayora-text-muted text-sm mb-1">Signature (Ed25519)</p>
              <code className="text-xs truncate block font-mono">{manifest.signature}</code>
            </div>
            <div className="p-3 bg-bayora-dark rounded-lg">
              <p className="text-bayora-text-muted text-sm mb-1">Policy Version</p>
              <code className="font-mono">{manifest.policyVersion}</code>
            </div>
          </div>
        </Card>
      )}

      <Card title="How Verification Works">
        <div className="space-y-4 text-sm">
          <div className="p-4 bg-bayora-dark rounded-lg">
            <h4 className="font-medium mb-2 flex items-center gap-2"><Hash className="w-4 h-4" /> Hash Chain</h4>
            <p className="text-bayora-text-muted">Each audit event includes SHA-256(canonical_event || previous_hash). The chain is verified by recomputing from genesis and checking sequence continuity.</p>
          </div>
          <div className="p-4 bg-bayora-dark rounded-lg">
            <h4 className="font-medium mb-2 flex items-center gap-2"><FileText className="w-4 h-4" /> Merkle Root</h4>
            <p className="text-bayora-text-muted">All event hashes are arranged as leaves in a Merkle tree. The root commits to the complete event set. Any added, removed, or reordered event changes the root.</p>
          </div>
          <div className="p-4 bg-bayora-dark rounded-lg">
            <h4 className="font-medium mb-2 flex items-center gap-2"><Key className="w-4 h-4" /> Ed25519 Signature</h4>
            <p className="text-bayora-text-muted">The manifest (merkle_root, final_chain_hash, metadata) is signed with an Ed25519 key. Verification requires the public key, which should be preserved externally.</p>
          </div>
          <div className="p-4 bg-bayora-dark rounded-lg">
            <h4 className="font-medium mb-2 flex items-center gap-2"><Shield className="w-4 h-4" /> Tamper Detection</h4>
            <p className="text-bayora-text-muted">Modified events break hash chain. Deleted events break sequence. Reordered events break chain links. Changed manifest breaks signature. All detected by verifier.</p>
          </div>
        </div>
      </Card>

      {showTamperDemo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-bayora-surface border border-bayora-border rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">Tamper Demonstration</h3>
              <button onClick={() => setShowTamperDemo(false)} className="p-2 hover:bg-bayora-border rounded-lg">✕</button>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <p className="font-medium text-amber-400 mb-2">How this works:</p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-bayora-text-muted">
                  <li>Original run events are hashed and chained</li>
                  <li>Merkle root is computed and manifest is signed</li>
                  <li>We create a <strong>copy</strong> of the run data and modify one event</li>
                  <li>Verification on the modified copy fails</li>
                </ol>
              </div>
              <div className="p-4 bg-bayora-dark rounded-lg">
                <p className="font-medium mb-2">Simulated Tamper: Event sequence 3 modified</p>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-bayora-text-muted">Original Hash</p>
                    <code className="text-xs truncate block">sha256:a1b2c3d4e5f6...</code>
                  </div>
                  <div>
                    <p className="text-bayora-text-muted">Tampered Hash</p>
                    <code className="text-xs truncate block text-red-400">sha256:z9y8x7w6v5u4...</code>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <XCircle className="w-8 h-8 text-red-400" />
                  <div>
                    <p className="font-bold text-red-400">VERIFICATION FAILED</p>
                    <p className="text-sm text-bayora-text-muted">Hash chain broken at sequence 3. Merkle root mismatch. Signature invalid.</p>
                  </div>
                </div>
              </div>
              <p className="text-sm text-bayora-text-muted text-center">
                This demonstrates that any modification to the audit trail is cryptographically detectable.
                The original run data remains intact — this is a copy for demonstration.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ManifestField({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="p-3 bg-bayora-dark rounded-lg">
      <div className="flex items-center gap-2 text-bayora-text-muted text-sm mb-1">
        <Icon className="w-4 h-4" />
        <span>{label}</span>
      </div>
      <code className="text-xs truncate block font-mono">{value}</code>
    </div>
  );
}