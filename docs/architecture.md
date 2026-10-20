# Architecture

## System Components

### Control Plane (API)
- **Technology**: Node.js + Express + TypeScript
- **Responsibilities**: Run lifecycle, policy checks, scheduling, audit orchestration
- **Database**: PostgreSQL (runs, users, policies, findings, manifests)
- **Queue**: Redis + BullMQ (async evaluation, replay jobs)
- **Auth**: Service identity headers + capability-based authorization

### Red Cell
- **Technology**: Node.js + TypeScript
- **Responsibilities**: Private payload vault, commitment submission, payload runner
- **Isolation**: Separate container, network, credentials; no Blue/Target access
- **Storage**: In-memory map (demo) → PostgreSQL blob storage (production)

### Target Cell
- **Technology**: Python + FastAPI
- **Responsibilities**: Model adapter, per-run context isolation
- **Models**: Deterministic mock (default), Ollama local (optional)
- **Isolation**: Fresh session per case; no shared KV cache; no filesystem access

### Blue Cell
- **Technology**: Node.js + TypeScript
- **Responsibilities**: Defense rule store, defense runner, sanitized observation consumer
- **Isolation**: Separate container, network, credentials; no Red/Target access

### Observation Firewall
- **Technology**: Node.js + TypeScript
- **Responsibilities**: Allow-list schema enforcement, delayed release, evidence sanitization
- **Schema**: `run_id, case_id, outcome, severity, category, confidence, evidence_digest, released_after_phase`
- **Sanitization**: Blue gets truncated response + bucketed timing; Red gets generic outcome; Auditor gets raw

### Audit Service
- **Technology**: Node.js + TypeScript + PostgreSQL
- **Responsibilities**: Append-only event log, hash chain, Merkle root, Ed25519 signatures
- **Event Format**: `event_id, run_id, sequence, event_type, timestamp, actor, payload_digest, previous_hash, event_hash`
- **Verification**: Recompute chain from genesis, verify sequence continuity, check Merkle root, verify signature

### Replay Worker
- **Technology**: Node.js + TypeScript + BullMQ
- **Responsibilities**: Deterministic replay, evidence digest comparison, discrepancy reporting
- **Output**: Metrics stored in experiment_results table

### Dashboard
- **Technology**: Vite + React + TypeScript + Tailwind CSS
- **Views**: Overview, Run Detail, Leakage Lab, Forensics, Threat Model
- **State**: TanStack Query for server state

## Data Flow

### Run Lifecycle
```
1. CREATE    → Orchestrator creates run, locks policy/model version
2. COMMIT    → Red stores payload, submits SHA-256 commitment
3. EXECUTE   → Target receives test via narrow validated API
4. DEFEND    → Blue applies defense to sanitized observation
5. OBSERVE   → Evidence stored raw; Firewall emits allow-listed telemetry
6. CLOSE     → Run frozen; access policies change; raw evidence locked
7. REVEAL    → Auditor accesses raw evidence post-closure
8. SEAL      → Hash chain + Merkle root + Ed25519 signature
9. REPLAY    → Verifier recomputes; compares digests
```

### Network Boundaries

```
External (Dashboard) → API Gateway (port 3001)
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   Red Cell        Target Cell      Blue Cell
  (port 3002)     (port 8000)      (port 3003)
        │               │               │
        └───────────────┼───────────────┘
                        ▼
              Observation Firewall
              (port 3004)
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   Evidence Store  Audit Service   Replay Worker
   (PostgreSQL)    (port 3005)     (port 3006)
```

## Database Schema

### Core Tables
- `users` — Service identities and roles
- `runs` — Run state machine, policy, model, timestamps
- `payload_commitments` — SHA-256 commitments with reveal policy
- `observations` — Sanitized, released telemetry
- `evidence_artifacts` — Raw evidence with access class
- `audit_events` — Append-only hash-chained events
- `run_manifests` — Merkle root, final hash, signature
- `experiments` — Leakage experiment configuration
- `experiment_results` — Measured metrics with methodology

## Cryptographic Primitives

| Primitive | Library | Purpose |
|-----------|---------|---------|
| SHA-256 | @noble/hashes | Hash chain, commitments, digests, Merkle |
| Ed25519 | @noble/ed25519 | Manifest signatures |
| Canonical JSON | Custom | Deterministic serialization for hashing |

**No custom crypto** — All primitives from maintained, audited libraries.

## Deployment Profiles

### MVP (Docker Compose)
- All services in containers with separate networks
- Default-deny between cells via Docker networks
- PostgreSQL + Redis as shared infrastructure
- Demo signing key in memory

### Stronger (Stretch)
- Rootless containers, seccomp, dropped capabilities
- Read-only root filesystems
- cgroup CPU/memory limits
- gVisor or Firecracker for additional boundary
- Cloud secret manager for keys
- Remote attestation (if hardware available)

## API Contracts

All endpoints use `/api/v1` prefix with Zod validation:

| Method | Endpoint | Capability |
|--------|----------|------------|
| POST | `/runs` | `orchestrator.create_run` |
| GET | `/runs/:id` | `orchestrator.read_all` |
| POST | `/runs/:id/commit` | `red.commit_payload` |
| POST | `/runs/:id/execute` | `orchestrator.transition_run` |
| POST | `/runs/:id/target/execute` | `target.execute_case` |
| POST | `/runs/:id/blue/defend` | `blue.apply_defense` |
| GET | `/runs/:id/observations` | `blue.read_sanitized_observation` |
| GET | `/runs/:id/evidence` | `auditor.read_closed_run_evidence` |
| POST | `/runs/:id/close` | `orchestrator.transition_run` |
| GET | `/runs/:id/manifest` | `auditor.verify_manifest` |
| POST | `/runs/:id/verify` | `auditor.verify_manifest` |
| POST | `/experiments/leakage` | `orchestrator.create_run` |