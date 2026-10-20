import { PageHeader, Card, Badge } from '../components/Layout';
import { Shield, Lock, Unlock, AlertTriangle, CheckCircle, XCircle, Eye, EyeOff, Zap, Network, Server, Key, User, Bug } from 'lucide-react';

export function ThreatModelPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Threat Model"
        description="Protected assets, trust boundaries, tested attack paths, and residual risks — honest assessment of what this prototype does and does not protect"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Protected Assets">
          <div className="space-y-3">
            <AssetRow icon={Lock} name="Red Team Payloads" description="Adversarial prompts, attack vectors, hidden labels" status="protected" detail="Stored in Red Cell private vault; only commitment digest exposed" />
            <AssetRow icon={Shield} name="Blue Team Defense Rules" description="Detection logic, mitigation policies, classification thresholds" status="protected" detail="Stored in Blue Cell private store; inaccessible to Red Team" />
            <AssetRow icon={Eye} name="Target Model Interactions" description="Raw prompts, responses, tool traces, internal state" status="protected" detail="Isolated in Target Cell; fresh session per run; no cross-run context" />
            <AssetRow icon={FileText} name="Raw Evidence" description="Complete execution traces, stack traces, timing data" status="protected" detail="Restricted evidence store; released only post-closure to auditor" />
            <AssetRow icon={Hash} name="Audit Trail Integrity" description="Event sequence, hash chain, Merkle root, signatures" status="protected" detail="Append-only audit log; signed manifest; tamper-evident verification" />
          </div>
        </Card>

        <Card title="Trust Boundaries">
          <div className="space-y-3">
            <BoundaryRow icon={Server} name="Control Plane" description="API, orchestrator, policy service" trust="Partial" detail="Coordinates but does not access raw secrets by default" />
            <BoundaryRow icon={Lock} name="Red Cell" description="Payload vault + runner" trust="High" detail="Separate container, network, credentials; Blue cannot reach" />
            <BoundaryRow icon={Shield} name="Blue Cell" description="Defense runner + rules" trust="High" detail="Separate container, network, credentials; Red cannot reach" />
            <BoundaryRow icon={Eye} name="Target Cell" description="Model adapter + context" trust="High" detail="Narrow API; no filesystem access to Red/Blue stores" />
            <BoundaryRow icon={FileText} name="Evidence Domain" description="Raw + sanitized streams" trust="High" detail="Firewall enforces allow-list; role-based access" />
            <BoundaryRow icon={Hash} name="Audit Domain" description="Events + manifests" trust="High" detail="Append-only; separate signing key; read-only verification" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Tested Attack Paths (Mitigated in Prototype)">
          <div className="space-y-3">
            <AttackRow icon={Unlock} name="Cross-Team API Access" description="Blue calling Red payload endpoints; Red calling Blue rule endpoints" mitigated="Default-deny networking; capability-based auth; 403 on all unauthorized" status="tested" />
            <AttackRow icon={EyeOff} name="Raw Evidence During Blind Run" description="Blue/Red querying raw evidence before run closure" mitigated="Firewall blocks raw_evidence access until CLOSED + auditor role" status="tested" />
            <AttackRow icon={Zap} name="Timing Side Channels" description="Inferring payload category from response latency" mitigated="Bucketing (100ms), noise addition, fixed-size envelopes, queued updates" status="partial" />
            <AttackRow icon={Network} name="Cross-Run Context Reuse" description="Target model retaining conversation history across runs" mitigated="Fresh session per case; no shared KV cache; isolated context" status="tested" />
            <AttackRow icon={Bug} name="Prompt Injection for Secrets" description="Target model prompted to reveal system instructions or payloads" mitigated="Mock model refuses; local model isolation; no secret access" status="tested" />
            <AttackRow icon={Server} name="Resource Exhaustion" description="Long-running payloads consuming CPU/memory" mitigated="Per-run timeouts (30s), request queues, container resource limits" status="tested" />
          </div>
        </Card>

        <Card title="Out of Scope / Not Fully Solved">
          <div className="space-y-3">
            <RiskRow icon={Server} name="Host/Kernel Compromise" description="Root access on host, hypervisor escape, cloud control plane" status="not-solved" detail="Docker Compose is a dev boundary, not a hardware guarantee" />
            <RiskRow icon={Zap} name="Hardware Side Channels" description="CPU cache, power, memory bus, speculative execution" status="not-solved" detail="Requires confidential computing / remote attestation (stretch)" />
            <RiskRow icon={Bug} name="Semantic Leakage" description="Model outputs implicitly revealing hidden information" status="partial" detail="Firewall reduces but cannot eliminate all semantic channels" />
            <RiskRow icon={User} name="Malicious Administrator" description="Host admin with signing key access" status="not-solved" detail="Key compromise breaks manifest trust; no hardware root of trust" />
            <RiskRow icon={Key} name="Cryptographic Key Compromise" description="Ed25519 signing key theft" status="not-solved" detail="Local demo key only; production needs HSM/KMS" />
            <RiskRow icon={AlertTriangle} name="Formal Noninterference Proof" description="Mathematical proof of no information flow" status="not-solved" detail="Prototype demonstrates composition; not a formal verification" />
            <RiskRow icon={Bug} name="All LLM Safety Labels Correct" description="Ground truth for every attack category" status="not-solved" detail="Uses synthetic labels; real benchmarks have label noise" />
            <RiskRow icon={Network} name="External Model Provider" description="Ollama/API provider sees all prompts/responses" status="not-solved" detail="Outside local isolation boundary; disclosed in architecture" />
          </div>
        </Card>
      </div>

      <Card title="Residual Risks & Assumptions">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h4 className="font-medium text-amber-400 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Assumptions</h4>
            <ul className="list-disc list-inside space-y-2 text-sm text-bayora-text-muted">
              <li>Docker containers provide process-level isolation (not hardware)</li>
              <li>Network policies enforced by Docker Compose (not production CNI)</li>
              <li>Signing key stored in memory (not HSM) for demo</li>
              <li>Mock model behaves deterministically (no real LLM unpredictability)</li>
              <li>Synthetic test cases represent attack distribution</li>
              <li>No insider threat from orchestration service</li>
              <li>Time synchronization across services for audit ordering</li>
            </ul>
          </div>
          <div className="space-y-4">
            <h4 className="font-medium text-red-400 flex items-center gap-2"><XCircle className="w-5 h-5" /> Residual Risks</h4>
            <ul className="list-disc list-inside space-y-2 text-sm text-bayora-text-muted">
              <li>Side-channel leakage not fully eliminated (timing, cache, power)</li>
              <li>Semantic inference from sanitized observations possible</li>
              <li>Compromised host invalidates all guarantees</li>
              <li>Signing key compromise allows manifest forgery</li>
              <li>External model providers see all interactions</li>
              <li>Label quality in synthetic experiments may not match real attacks</li>
              <li>No protection against denial-of-service on orchestrator</li>
            </ul>
          </div>
        </div>
      </Card>

      <Card title="Security Controls Implemented">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ControlBadge icon={Lock} name="Isolation by Default" status="implemented" detail="Separate containers, networks, credentials" />
          <ControlBadge icon={Shield} name="Capability-Based Auth" status="implemented" detail="Scoped permissions per service role" />
          <ControlBadge icon={Eye} name="Observation Firewall" status="implemented" detail="Allow-list schema; no raw prompts/secrets" />
          <ControlBadge icon={Zap} name="Timing Bucketing" status="implemented" detail="100ms buckets + noise; fixed envelopes" />
          <ControlBadge icon={Hash} name="Hash Chain + Merkle" status="implemented" detail="SHA-256 chain; Merkle root per run" />
          <ControlBadge icon={Key} name="Ed25519 Signatures" status="implemented" detail="Manifest signing; external key preservation" />
          <ControlBadge icon={RefreshCw} name="Deterministic Replay" status="implemented" detail="Replay worker verifies evidence digests" />
          <ControlBadge icon={Bug} name="Leakage Measurement" status="implemented" detail="Blind classification + timing experiments" />
          <ControlBadge icon={Server} name="gVisor/Firecracker" status="stretch" detail="Stronger sandbox (not in MVP)" />
        </div>
      </Card>
    </div>
  );
}

function AssetRow({ icon: Icon, name, description, status, detail }: { icon: React.ComponentType<{ className?: string }>; name: string; description: string; status: 'protected' | 'partial' | 'exposed'; detail: string }) {
  const statusConfig = {
    protected: { variant: 'success' as const, label: 'Protected', icon: CheckCircle },
    partial: { variant: 'warning' as const, label: 'Partial', icon: AlertTriangle },
    exposed: { variant: 'danger' as const, label: 'Exposed', icon: XCircle }
  };
  const cfg = statusConfig[status];
  const StatusIcon = cfg.icon;
  return (
    <div className="p-4 bg-bayora-dark rounded-lg border border-bayora-border/50">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-bayora-primary/20 flex items-center justify-center">
          <Icon className="w-5 h-5 text-bayora-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold">{name}</h4>
            <Badge variant={cfg.variant} className="text-xs flex items-center gap-1">
              <StatusIcon className="w-3 h-3" />
              {cfg.label}
            </Badge>
          </div>
          <p className="text-bayora-text-muted text-sm mt-1">{description}</p>
          <p className="text-xs text-bayora-text-muted mt-2">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function BoundaryRow({ icon: Icon, name, description, trust, detail }: { icon: React.ComponentType<{ className?: string }>; name: string; description: string; trust: 'High' | 'Partial' | 'Low'; detail: string }) {
  const trustConfig = {
    High: { variant: 'success' as const, color: 'text-green-400' },
    Partial: { variant: 'warning' as const, color: 'text-amber-400' },
    Low: { variant: 'danger' as const, color: 'text-red-400' }
  };
  const cfg = trustConfig[trust];
  return (
    <div className="p-4 bg-bayora-dark rounded-lg border border-bayora-border/50">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-bayora-primary/20 flex items-center justify-center">
          <Icon className="w-5 h-5 text-bayora-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold">{name}</h4>
            <Badge variant={cfg.variant} className={cfg.color}>Trust: {trust}</Badge>
          </div>
          <p className="text-bayora-text-muted text-sm mt-1">{description}</p>
          <p className="text-xs text-bayora-text-muted mt-2">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function AttackRow({ icon: Icon, name, description, mitigated, status }: { icon: React.ComponentType<{ className?: string }>; name: string; description: string; mitigated: string; status: 'tested' | 'partial' }) {
  const statusConfig = {
    tested: { variant: 'success' as const, label: 'Tested' },
    partial: { variant: 'warning' as const, label: 'Partial' }
  };
  const cfg = statusConfig[status];
  return (
    <div className="p-4 bg-bayora-dark rounded-lg border border-bayora-border/50">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-bayora-primary/20 flex items-center justify-center">
          <Icon className="w-5 h-5 text-bayora-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold">{name}</h4>
            <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>
          </div>
          <p className="text-bayora-text-muted text-sm mt-1">{description}</p>
          <p className="text-xs text-bayora-primary mt-2">Mitigation: {mitigated}</p>
        </div>
      </div>
    </div>
  );
}

function RiskRow({ icon: Icon, name, description, status, detail }: { icon: React.ComponentType<{ className?: string }>; name: string; description: string; status: 'not-solved' | 'partial'; detail: string }) {
  const statusConfig = {
    'not-solved': { variant: 'danger' as const, label: 'Not Solved' },
    partial: { variant: 'warning' as const, label: 'Partial' }
  };
  const cfg = statusConfig[status];
  return (
    <div className="p-4 bg-bayora-dark rounded-lg border border-bayora-border/50">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
          <Icon className="w-5 h-5 text-red-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold">{name}</h4>
            <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>
          </div>
          <p className="text-bayora-text-muted text-sm mt-1">{description}</p>
          <p className="text-xs text-bayora-text-muted mt-2">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function ControlBadge({ icon: Icon, name, status, detail }: { icon: React.ComponentType<{ className?: string }>; name: string; status: 'implemented' | 'stretch'; detail: string }) {
  const statusConfig = {
    implemented: { variant: 'success' as const, bg: 'bg-green-500/20', icon: CheckCircle },
    stretch: { variant: 'warning' as const, bg: 'bg-amber-500/20', icon: AlertTriangle }
  };
  const cfg = statusConfig[status];
  const StatusIcon = cfg.icon;
  return (
    <div className={`p-4 rounded-lg border ${cfg.bg} border-${status === 'implemented' ? 'green' : 'amber'}-500/30`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-5 h-5" style={{ color: status === 'implemented' ? '#22c55e' : '#f59e0b' }} />
        <h4 className="font-semibold">{name}</h4>
      </div>
      <Badge variant={cfg.variant} className="text-xs mb-2 flex items-center gap-1">
        <StatusIcon className="w-3 h-3" />
        {status === 'implemented' ? 'Implemented' : 'Stretch Goal'}
      </Badge>
      <p className="text-xs text-bayora-text-muted">{detail}</p>
    </div>
  );
}

import { Hash } from 'lucide-react';