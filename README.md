# BAYORA VEIL — Verifiable Evaluation Isolation Layer

A prototype for **blind, isolated, measurable, and verifiable AI safety evaluations** built for Hack in Hills '26 Problem Statement 04.

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Red Cell  │     │ Target Cell │     │  Blue Cell  │     │   Audit     │
│  (Payloads) │────▶│  (Model)    │────▶│ (Defenses)  │     │  (Evidence) │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │                   │
       └───────────────────┴───────────────────┴───────────────────┘
                                   │
                          ┌────────▼────────┐
                          │ Observation     │
                          │ Firewall        │
                          │ (Allow-list)    │
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │   Dashboard     │
                          │  (Sanitized)    │
                          └─────────────────┘
```

## Key Features

- **Isolation by Default**: Separate containers, networks, and credentials for Red, Blue, and Target cells
- **Observation Firewall**: Allow-list schema releases only sanitized observations (no raw prompts, secrets, or stack traces)
- **Blind Evaluation Protocol**: Cryptographic commitments, phased execution, post-closure revelation
- **Tamper-Evident Audit**: SHA-256 hash chain, Merkle roots, Ed25519 signed manifests
- **Leakage Measurement**: Controlled experiments measuring blind classification accuracy and timing side channels
- **Deterministic Replay**: Verification worker replays runs and compares evidence digests

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for local development)
- Python 3.11+ (for target adapter)

### Using Docker Compose (Recommended)

```bash
cd bayora-veil
cp .env.example .env
docker-compose -f infra/docker-compose.yml up --build
```

Services will be available at:
- **Dashboard**: http://localhost:5173
- **API**: http://localhost:3001
- **Target Adapter**: http://localhost:8000
- **Red Runner**: http://localhost:3002
- **Blue Runner**: http://localhost:3003
- **Observation Firewall**: http://localhost:3004
- **Audit Service**: http://localhost:3005
- **Replay Worker**: http://localhost:3006

### Local Development

```bash
# Install dependencies
npm install

# Start database
docker-compose -f infra/docker-compose.yml up -d postgres redis

# Run migrations
npm run db:migrate

# Seed demo data
npm run db:seed

# Start all services
npm run dev
```

## Demo Script

1. **Create a run** — Select policy version and model adapter
2. **Commit payload** — Red Team stores adversarial prompt, publishes only SHA-256 commitment
3. **Execute** — Target model processes prompt in isolated cell
4. **Defend** — Blue Team applies defenses to sanitized observation only
5. **Observe** — Firewall releases only allow-listed telemetry (outcome, severity, digest)
6. **Close** — Freeze run, enable auditor access to raw evidence
7. **Verify** — Check hash chain, Merkle root, and Ed25519 signature
8. **Tamper demo** — Modify event copy, show verification failure
9. **Leakage lab** — Run experiments with firewall ON/OFF, compare measured inference accuracy

## Project Structure

```
bayora-veil/
├── apps/
│   ├── api/           # Express + TypeScript control plane
│   └── web/           # Vite + React + TypeScript dashboard
├── services/
│   ├── target-adapter/      # Python FastAPI model adapter
│   ├── red-runner/          # Red Team payload vault
│   ├── blue-runner/         # Blue Team defense runner
│   ├── observation-firewall/# Allow-list schema enforcement
│   ├── audit-service/       # Hash chain, Merkle, signatures
│   └── replay-worker/       # Deterministic replay verification
├── packages/
│   ├── schemas/       # Shared Zod schemas (API, events, types)
│   └── crypto-utils/  # Hash, signatures, Merkle, canonicalization
├── tests/             # Isolation, authorization, leakage, audit, replay
├── infra/             # Docker Compose, network policies
└── docs/              # Threat model, architecture, demo script
```

## Security Model

### Protected In Prototype
- Cross-team API access (default-deny networking + capability auth)
- Raw evidence access during blind runs (firewall enforcement)
- Cross-run context contamination (fresh sessions per case)
- Audit trail modification (hash chain + Merkle + signatures)
- Basic resource exhaustion (timeouts, limits)

### Not Fully Solved
- Host/kernel/hypervisor compromise
- Hardware side channels (cache, power, speculative execution)
- All semantic leakage through model outputs
- Malicious administrator with signing key
- Cryptographic key compromise
- External model provider visibility

## Leakage Experiments

Run controlled measurements (not claims):

| Experiment | Metric | Method |
|------------|--------|--------|
| Blind Classification | Balanced accuracy vs chance | Logistic regression on sanitized vs raw telemetry |
| Timing Leakage | Classifier accuracy before/after bucketing | Decision tree on latency distributions |
| Cross-Tenant Access | Denial rate + audit coverage | Automated unauthorized request attempts |

Results show **measured prototype metrics** with sample counts and methodology — no invented percentages.

## Testing

```bash
# Run all tests
npm run test

# Specific test suites
npm run test --workspace=apps/api
npm run test --workspace=packages/schemas
npm run test --workspace=packages/crypto-utils
```

## Configuration

Key environment variables (see `.env.example`):

| Variable | Description | Default |
|----------|-------------|---------|
| `MOCK_MODEL` | Use deterministic mock instead of Ollama | `true` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

## License

MIT — See [LICENSE](LICENSE) for details.

## References

- Hack in Hills '26 PS-04 Problem Statement
- AdvBench, JailbreakBench, HarmBench, ToxiGen benchmarks
- Firecracker, gVisor, Kata Containers for stronger isolation
- OWASP Top 10 for LLM Applications
- NIST AI Risk Management Framework