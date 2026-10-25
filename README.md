# Bayora Veil

[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9.x-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-24.x-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render&logoColor=white)](https://render.com/)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com/)
[![Vitest](https://img.shields.io/badge/Vitest-1.2-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-Proprietary-lightgrey)](LICENSE)

---

A **blind evaluation protocol** for AI safety assessments with restricted team data, allow-listed observations, measured leakage experiments, cryptographically signed evidence, and fresh-session replay verification.

## Overview

Bayora Veil implements a production-grade evaluation framework where Red (attacker) and Blue (defender) teams operate with **strict data isolation**, coordinated through an authenticated gateway. Every run produces **tamper-evident audit trails** with Merkle trees and Ed25519 signatures, enabling offline verification without any running services.

### Key Properties

| Property | Implementation |
|----------|----------------|
| **Tenant Isolation** | Separate databases per service, scoped credentials, row-level tenant enforcement |
| **Role-Based Access** | Server-issued 1-hour sessions; fixed roles (orchestrator, red, blue, auditor); no client-side role switching |
| **Blind Commitments** | Red commits SHA-256 with per-run nonce; payload revealed only on auditor-authorized closure |
| **Signed Evidence** | Audit service builds Merkle root, signs manifest with offline-verifiable Ed25519 key |
| **Fresh Replay** | Replay service re-executes in new Target session; compares response digests |
| **Leakage Measurement** | Classification, timing, and access-control experiments with statistical reporting |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RENDER (Backend)                               │
│  ┌─────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │   bayora-   │  │ bayora-  │  │ bayora-  │  │ bayora-  │  │ bayora-  │  │
│  │    api      │◄─│   red    │  │  blue    │  │  audit   │  │  replay  │  │
│  │  (public)   │  │ (private)│  │ (private)│  │ (private)│  │ (private)│  │
│  └──────┬──────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│         │              │             │             │             │        │
│  ┌──────▼──────┐  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐  │
│  │  API DB     │  │ Red DB   │  │ Blue DB  │  │Audit DB  │  │Replay DB │  │
│  │ (metadata)  │  │          │  │          │  │(immutable)           │  │
│  └─────────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│         │                                                                    │
│  ┌──────▼──────────────────────────────────────────────────────────────┐   │
│  │                    bayora-target (Python/FastAPI)                   │   │
│  │                    ┌─────────────────────┐                          │   │
│  │                    │  Mock / Ollama      │                          │   │
│  │                    └─────────────────────┘                          │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VERCEL (Frontend)                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  React 18 + Vite + Tailwind + TanStack Query                        │   │
│  │  Pages: Overview • Runs • Leakage Lab • Forensics • Threat Model    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Service Boundaries

| Service | Database | Credentials Received | Responsibilities |
|---------|----------|---------------------|------------------|
| **API** | `bayora_api` | 4 gateway→cell tokens | Auth, tenant/role checks, state machine, digest metadata, experiments |
| **Red** | `bayora_red` | Target token, Replay read token | Commit payload, verify digest, execute Target, retain raw prompt/response |
| **Blue** | `bayora_blue` | API gateway token | Sanitized observation input, private rule/decision |
| **Target** | - | 2 execution tokens | Bounded stateless inference; no DB credentials |
| **Audit** | `bayora_audit` | Signing key (secret file), Replay read token | Append hash events, freeze/sign runs, verify |
| **Replay** | `bayora_replay` | Red evidence (read), Audit tokens, Target token | Verify manifest, fresh execution, compare digests |

---

## Quick Start (Production)

### Prerequisites
- Node 22, pnpm 9, Python 3.12
- Render account (backend), Vercel account (frontend)
- GitHub/GitLab repository with this code

### 1. Local Verification
```bash
# Install & build
corepack enable && corepack prepare pnpm@9.0.0 --activate
pnpm install --frozen-lockfile
pnpm -r build

# Run tests (124 unit + 3 Python)
pnpm test

# Generate deployment secrets (creates .bayora/signing-key.json)
node scripts/create-deployment-secrets.mjs
```

### 2. Deploy Backend (Render Blueprint)
1. **Render Dashboard → Blueprints → New Blueprint Instance**
2. Connect repo → selects `render.yaml` (6 services + 5 PostgreSQL DBs)
3. Set `bayora-api` → **Environment → CORS_ORIGIN** = `https://your-project.vercel.app`
4. **bayora-audit → Environment → Secret Files** → Upload `.bayora/signing-key.json` as `signing-key.json` (mount: `/etc/secrets/signing-key.json`)
5. Wait for all services **green** → health: `GET /ready` (API), `GET /health` (private)

### 3. Provision Accounts (Render Shell → bayora-api)
```bash
export ACCOUNT_PASSWORD="$(openssl rand -base64 24)"
TENANT_UUID="550e8400-e29b-41d4-a716-446655440000"

node apps/api/dist/security/provision.js "$TENANT_UUID" "orchestrator@yourco.com" "orchestrator" "Orchestrator"
node apps/api/dist/security/provision.js "$TENANT_UUID" "red@yourco.com" "red" "Red Team"
node apps/api/dist/security/provision.js "$TENANT_UUID" "blue@yourco.com" "blue" "Blue Team"
node apps/api/dist/security/provision.js "$TENANT_UUID" "auditor@yourco.com" "auditor" "Auditor"

unset ACCOUNT_PASSWORD
```

### 4. Deploy Frontend (Vercel)
1. **Vercel → Add New Project** → Import repo (root directory)
2. **Environment Variable**: `VITE_API_URL=https://bayora-api.onrender.com/api/v1`
3. Deploy → SPA rewrites + security headers applied automatically

---

## Local Development (Demo Mode)

```bash
# 1. Copy env & configure
cp .env.example .env
# Edit .env: AUTH_MODE=demo, EXECUTION_PROFILE=local, DATABASE_URL=postgres://...

# 2. Setup Python target adapter
python -m venv services/target-adapter/venv
source services/target-adapter/venv/bin/activate  # Windows: .\venv\Scripts\Activate.ps1
pip install -e ./services/target-adapter

# 3. Migrate & run
pnpm db:migrate
pnpm dev
# API: http://localhost:3001  |  Web: http://localhost:5173  |  Adapter: http://localhost:8000
```

> **Demo mode** permits role switching via UI - **disabled in production**.

---

## Demonstration Flow

1. **Orchestrator** creates policy `v1.0.0`, model `mock-adapter`
2. **Red** commits synthetic prompt → shows SHA-256 commitment
3. **Blue** cannot read Red payload; **Red** cannot read Blue rules; cross-tenant access denied
4. **Orchestrator** executes & evaluates → Blue receives strict allow-listed observation
5. **Orchestrator** closes run → Red/Blue records freeze → **Audit** builds Merkle root, signs manifest
6. **Auditor** inspects raw evidence, verifies chain/root/signature, runs tamper test, replays case
7. **Leakage Lab**: Run classification, timing, access experiments → view saved history with Wilson intervals

### Offline Verification
```bash
# Download bundle from Forensics page, then:
node scripts/verify-bundle.mjs /path/to/bayora-RUN_UUID.json PINNED_PUBLIC_KEY_HEX
# Verifies: signatures, event identity/continuity, count, Merkle root, final hash
```

---

## Project Structure

```
bayora-veil/
├── apps/
│   ├── api/                 # Node/TypeScript - Authenticated gateway
│   │   ├── src/
│   │   │   ├── cells/       # Red, Blue, Audit, Replay cell servers
│   │   │   ├── db/          # Migrations, client, queries
│   │   │   ├── security/    # Accounts, sessions, provisioning
│   │   │   ├── routes/      # API endpoints
│   │   │   └── index.ts     # Entry point
│   │   └── package.json
│   │
│   └── web/                 # React/Vite/Tailwind frontend
│       ├── src/
│       │   ├── pages/       # Overview, Runs, LeakageLab, Forensics, ThreatModel
│       │   ├── components/  # Session, Layout, reusable UI
│       │   ├── hooks/       # useApi (TanStack Query)
│       │   └── api/client.ts
│       └── package.json
│
├── services/
│   ├── red-runner/          # Red cell logic
│   ├── blue-runner/         # Blue cell logic
│   ├── observation-firewall/# Sanitization layer
│   └── target-adapter/      # Python/FastAPI - Mock/Ollama inference
│
├── packages/
│   ├── crypto-utils/        # Ed25519, Merkle, commitments, private artifacts
│   └── schemas/             # Shared Zod schemas (API contracts)
│
├── infra/
│   ├── Dockerfile.node      # Multi-stage build for Node services
│   ├── Dockerfile.target    # Python target adapter image
│   ├── docker-compose.yml   # Local dev stack
│   └── compose.production.yml  # Strict network/profile for Docker hosts
│
├── scripts/
│   ├── create-deployment-secrets.mjs
│   ├── verify-bundle.mjs
│   └── production-check.mjs
│
├── tests/                   # Integration tests (isolation, audit-tamper, replay, leakage, auth)
├── docs/
│   ├── production-deployment.md
│   ├── plan-review.md
│   ├── architecture.md
│   ├── threat-model.md
│   ├── run-and-demo.md
│   └── demo-script.md
│
├── render.yaml              # Render Blueprint (production)
├── vercel.json              # Vercel config (frontend)
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── package.json
```

---

## Operational Requirements

- **Backups**: Enable PostgreSQL backups on Render; perform restore drills. Store signing key backups separately.
- **Rotation**: Rotate cell credentials together; revoke sessions by deleting session row; disable account to invalidate all sessions.
- **Monitoring**: Track HTTP failures, execution/timeouts, auth denials, service health. Logs contain paths/status/duration/request IDs - no bodies, credentials, or raw output.
- **Capacity**: 2 concurrent work leases/tenant, 2 Target inference slots, shared PostgreSQL rate limits. API fails closed if auth DB unavailable.
- **Model Endpoint**: Use `mock-adapter` for first release. For Ollama: configure privately reachable endpoint, pin model operationally. No public/user-selected URLs.

---

## Deployment Boundaries

| Aspect | Render | Docker Compose (Production Profile) |
|--------|--------|-------------------------------------|
| **Network Isolation** | Shared private network; app-level auth only | Explicit per-pair networks (allowed call pairs only) |
| **Container Hardening** | Platform managed | Non-root, read-only FS, dropped capabilities, CPU/mem/PID limits |
| **Hardware Attestation** | ❌ Not available | Stretch goal (gVisor/Firecracker) |
| **Database Backups** | Platform managed | Operator responsibility |
| **Secret Management** | Render secret files | `.bayora/deployment.env` + manual signing key |

> **Full PLAN compliance cannot be claimed on Render alone** - its private services share a network; strict per-pair filtering is supplied in the Compose profile. Hardware isolation and attestation remain stretch goals.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Production Deployment](docs/production-deployment.md) | Step-by-step Render + Vercel deployment |
| [PLAN Review](docs/plan-review.md) | Implemented requirements vs. remaining boundaries |
| [Architecture](docs/architecture.md) | System design, data flows, trust boundaries |
| [Threat Model](docs/threat-model.md) | STRIDE analysis, mitigations, assumptions |
| [Run & Demo](docs/run-and-demo.md) | Local demo mode instructions |
| [Demo Script](docs/demo-script.md) | Guided demonstration flow |

---

## Security

- **No public registration** - accounts provisioned by administrators only
- **Revocable sessions** - 1-hour TTL, server-side revocation on sign-out/account disable
- **Immutable audit records** - DB triggers reject UPDATE/DELETE on events/manifests
- **Private nonces** - 32-byte per-run nonces prevent dictionary attacks on commitments
- **Content Security Policy** - Strict headers via `vercel.json` (no inline scripts, no framing)
- **Supply chain** - `pnpm install --frozen-lockfile` in CI; locked dependencies