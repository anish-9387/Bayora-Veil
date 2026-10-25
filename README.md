# BAYORA VEIL

A blind evaluation protocol with restricted team data, allow-listed observations, measured leakage experiments, signed evidence and fresh-session replay.

## Production: Render backend, Vercel frontend

Follow [the production deployment guide](docs/production-deployment.md). It covers setup, account provisioning, secrets, verification, demonstration and operational requirements.

- `render.yaml`: one public API, five private services, five independent PostgreSQL databases.
- `vercel.json`: frontend build, SPA routing and security headers. Set `VITE_API_URL` to the public API's `/api/v1` URL.
- Production accepts server-issued sessions. Users have an administrator-assigned tenant and role; client role headers are ignored.
- Red retains raw prompts and target responses. Blue retains its rules. The API retains digest metadata. Audit alone receives the signing key.
- Auditor evidence access requires closure. Ordinary database updates cannot rewrite audit records, manifests or closed artifacts.
- Two tenant work leases, shared rate limits, bounded target concurrency and request timeouts limit resource use.

Render private services share their workspace/region network. They enforce scoped application credentials, but do not provide this project's strict per-pair network filtering. [The Compose production profile](infra/compose.production.yml) provides explicit allowed networks, independent volumes, read-only non-root applications and CPU/memory/PID limits on a compatible host. See [the PLAN review](docs/plan-review.md) for verification boundaries and stretch goals.

## Install and verify

Use Node 22, pnpm 9, Python 3.12 and PostgreSQL 16 or newer.

```sh
pnpm install --frozen-lockfile
pnpm -r build
pnpm test
python -m venv services/target-adapter/venv
```

Install the target using that environment's pip (`venv/Scripts/pip.exe` on Windows; `venv/bin/pip` on Linux/macOS):

```sh
pip install ./services/target-adapter
```

Use the environment's Python when running its tests. `pnpm production:check` runs the complete isolated topology against dedicated `bayora_check_*` PostgreSQL databases. It requires a disposable database administrator connection, creates synthetic accounts/runs/experiments and retains them. It verifies authentication, role spoof rejection, tenant denial, private service credentials, hidden payloads, closure, immutable writes, signatures, copied-event tampering, replay, measurements and logout. Processes stop afterward.

CI builds the workspace, runs tests and the isolated smoke check, validates Compose configuration and builds both container images.

## Optional local role demo

Copy `.env.example` to `.env` only for a fresh setup; keep existing credentials otherwise. Create the database named in `.env`. Set `AUTH_MODE=demo` and `EXECUTION_PROFILE=local` explicitly for this testing profile. Migration, seeding and the API load the root environment file automatically. All tables are created before demo seed data.

```sh
pnpm db:migrate
pnpm dev
```

After installing the Python virtual environment, `pnpm dev` migrates PostgreSQL and starts API :3001, dashboard :5173 and adapter :8000. Redis is not required. Press Ctrl+C to stop the processes. This local profile deliberately permits role switching and is refused in production. [Local instructions](docs/run-and-demo.md).

## Demonstrate

1. Orchestrator creates a run using `v1.0.0` and `mock-adapter`.
2. Red commits a harmless synthetic payload. Show its SHA-256 commitment.
3. Demonstrate Blue-to-Red, Red-to-Blue and foreign-tenant denials.
4. Orchestrator executes, evaluates and closes. Only the constrained observation reaches Blue; unknown safety outcomes stay `not_tested`.
5. Auditor inspects evidence and verifies chain continuity, Merkle root, event count and Ed25519 signature.
6. Forensics changes a copied event to demonstrate failure and re-executes the case in a fresh target session to compare response digests.
7. Leakage Lab measures classification, timing and authenticated access attempts, with sample counts, methods and saved history.

## Architecture and limits

The authenticated API coordinates Red, Target, Blue, Audit and Replay through narrow schemas. Separate service credentials and databases prevent ordinary cross-cell access. Raw submissions and authorized reveals transit the trusted API gateway's memory; its database stores only digest metadata in isolated mode. The target has no team database credentials, mounted stores, shell tools or shared conversation IDs.

Audit records hash only metadata, build a Merkle root and sign a manifest containing policy, adapter and dataset versions. Preserve signed manifests and public keys externally. A host/database administrator with DDL privileges or signing-key access remains trusted. Synthetic leakage results do not establish universal security or real-model safety.

Ollama requires a privately reachable configured endpoint and separate real-model verification. gVisor/Firecracker, hardware attestation and external benchmark integration remain optional PLAN stretch goals and require suitable infrastructure. Cloud deployment, backups, restoration, sizing and platform controls must be verified on the actual hosting accounts.
