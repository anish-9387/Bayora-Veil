# Production deployment: Render + Vercel

This profile deploys the control API publicly and runs Red, Blue, Target, Audit and Replay as separate private services. It replaces local role headers with password authentication and server-issued, revocable one-hour sessions. Each account belongs to one tenant and one role. There is no public registration or client-controlled role assignment.

## Before deployment

1. Use Node 22, pnpm 9 and Python 3.12. Run `pnpm install --frozen-lockfile`, `pnpm -r build` and `pnpm test`.
2. Create the Python environment with `python -m venv services/target-adapter/venv` and install `./services/target-adapter` using that environment's pip.
3. Run `pnpm production:check` against a disposable PostgreSQL administrator connection. This creates five separate `bayora_check_*` databases, temporarily starts the complete production topology, tests it with authenticated synthetic accounts, and stops its processes. It retains synthetic records. Never point this check at a production database administrator.
4. Run `node scripts/create-deployment-secrets.mjs` once. It creates ignored, private `.bayora/signing-key.json` and `.bayora/deployment.env` files without overwriting existing files. Keep an encrypted backup of the signing key. The environment file is for Compose; set its CORS_ORIGIN to your exact HTTPS frontend origin. Render generates its own service tokens.

## Render

1. Connect the repository and create a Blueprint using root `render.yaml`. Review the paid service/database resources before applying it. All services/databases use the same region. The blueprint provisions six application services and five independent PostgreSQL databases; the Target has no database.
2. Set `bayora-api`'s `CORS_ORIGIN` to the exact production frontend origin, for example `https://your-project.vercel.app`, with no trailing slash. Use a stable domain; arbitrary preview domains are not allowed.
3. Add the contents of `.bayora/signing-key.json` as a secret file named `signing-key.json` **only to bayora-audit**. Its path is `/etc/secrets/signing-key.json`. Upload this before expecting audit readiness. The audit cell refuses to generate an ephemeral production key.
4. The API pre-deploy command migrates its metadata database. Each private cell initializes only its own database. Blueprint references distribute each connection string and token only to the services that need it. Database external IP access is disabled.
5. Once all services are healthy, open a Render shell on **bayora-api** and provision accounts. Set `ACCOUNT_PASSWORD` through the shell's environment using a securely generated password; do not put it in source, screenshots or command arguments. Then run:

   ```sh
   node apps/api/dist/security/provision.js TENANT_UUID operator@example.com orchestrator "Evaluation operator"
   ```

   Use the same tenant UUID for the four team accounts and a different email/password for each. Valid roles: `orchestrator`, `red`, `blue`, `auditor`. The tenant is created if needed. Repeat with a different UUID for another organization. Remove `ACCOUNT_PASSWORD` from the environment when done. Demo UUIDs have no login passwords and cannot authenticate.
6. Use `/ready` for the API health check. It tests database connectivity. Private services expose a generic `/health` endpoint and bind to `0.0.0.0:$PORT`.

The Render account, environment settings, backups, secret upload and account provisioning are operator actions. Creating repository files does not deploy resources or confirm those controls on your account.

## Vercel

1. Import the same repository with its root directory set to the repository root. Root `vercel.json` selects Vite, builds `@bayora/web`, and publishes `apps/web/dist`.
2. Set **only** `VITE_API_URL=https://YOUR-API.onrender.com/api/v1` for the production frontend. This URL is public configuration. Never give Vercel database passwords, cell tokens or the signing key.
3. Deploy. SPA rewrites allow refreshing `/runs/:id`, `/leakage` and `/forensics`. Security headers restrict scripts to this origin and disable framing and unnecessary browser permissions.
4. Sign in using an account provisioned on Render. Production has no role picker. Use separate browser profiles or sign out/in to demonstrate the different accounts. A client changing its stored role or sending `X-Service-Role` does not change backend permissions.
5. After changing either origin or API URL, redeploy the corresponding service and test sign-in from the actual frontend origin. Sessions use Authorization headers, avoiding cross-site cookie dependencies. Tokens remain in that tab's session storage and expire after one hour; sign-out revokes them server-side.

## Service and data boundaries

| Service | Credentials/data it receives | Allowed work |
| --- | --- | --- |
| API | Metadata DB; four gateway-to-cell tokens | Authentication, tenant/role checks, state machine, digest metadata, experiments |
| Red | Red DB; Target execution token; replay read token | Commit payload, verify its digest, execute Target, retain raw prompt/response |
| Blue | Blue DB and gateway token | Strict sanitized observation input, private rule and decision |
| Target | Two execution credentials; optional configured model endpoint | Bounded, stateless inference; no database credentials or team volumes |
| Audit | Audit DB; audit-only signing secret; replay read token | Append hash-only events, freeze and sign complete runs, verify |
| Replay | Replay DB; read-only closed Red evidence and Audit tokens; separate Target token | Verify source manifest, execute a fresh case, compare response digests |

The API acts as the authenticated gateway for Red submissions and post-close auditor reveals, so their bytes transit its memory. They are not stored in its database, logs or event metadata. The API is part of the trusted computing base. Eliminating even transient gateway access requires direct client-to-cell encryption or separate authenticated ingress, beyond this deployment profile.

Production commitments and response evidence digests use domain-separated canonical data with a private 32-byte per-run nonce. This prevents straightforward dictionary guessing of predictable payloads and correlation of identical mock responses from public digests. The nonce stays in Red storage and is revealed with closed-run auditor evidence; replay reuses it to compare the fresh response. The local role demo retains its earlier plain SHA-256 format. Classification experiments use opaque case identifiers so their sequence does not disclose the balanced hidden labels.

The Audit database rejects ordinary UPDATE/DELETE of events/manifests. Closed metadata artifacts and raw cell records reject modification. Database owners with DDL privileges can disable triggers; trusted administrators and external preservation of signed roots remain essential.

## Verification and demonstration

1. Orchestrator creates policy `v1.0.0`, model `mock-adapter`.
2. Red signs in and commits a harmless synthetic prompt. Show its SHA-256 commitment.
3. Blue cannot read Red payloads; Red cannot read Blue rules. An account from another tenant cannot read the run or its experiment results, even knowing their UUIDs. Denials are recorded.
4. Orchestrator executes and evaluates. Raw inference occurs inside the Red/Target path. Blue receives a strict allow-list observation; an unassessed outcome remains `not_tested` with confidence 0. The simple Blue rule flags it for review.
5. Orchestrator closes the run. Red and Blue records freeze. The separate Audit cell requires the complete ordered protocol, builds a Merkle root, and signs the manifest.
6. Auditor inspects raw evidence, verifies the chain/root/signature, runs the copied-event tamper test, and replays the case in a fresh Target request. Exact response digests match for the deterministic mock; a real model may differ.
7. Run the three Leakage Lab experiments and reopen their saved history. Classification reports balanced synthetic classes, nominal Wilson uncertainty and baseline comparisons. Timing reports measured classifier performance, percentiles and histogram counts. Access tests use real short-lived authenticated accounts, including a different tenant.

In Forensics, download a verification bundle. Preserve the audit public key through an independent trusted channel, then verify offline:

```sh
node scripts/verify-bundle.mjs /path/to/bayora-RUN_UUID.json PINNED_PUBLIC_KEY_HEX
```

The verifier needs no database or running service. It checks signatures against the supplied pinned key, event identity/continuity, count, Merkle root and final hash, including removal of a trailing event. A public key supplied inside a downloaded bundle is not itself a trust anchor.

## Operational requirements

- Enable and verify database backups and perform a restore drill. Keep signing-key backups separately from database backups. Preserve exported signed manifests/public keys outside ordinary service-writer access.
- Rotate cell credentials in dependent services together. A compromised session can be revoked by deleting its session row; disabling an account invalidates all its sessions on their next request. Restrict Render shell/secret access to deployment administrators.
- Monitor HTTP failures, execution/timeout counts, authorization denials and service health. Request logs contain paths/status/duration/request IDs, not bodies, credentials or raw model output.
- Two concurrent work leases per tenant and two Target inference slots bound work; rate limits are shared in PostgreSQL. The API fails closed if its authorization database is unavailable. Platform DDoS protection, database capacity and paid instance sizing must be verified under your workload.
- Use the mock for the first release. To enable Ollama, configure an endpoint reachable only from Target and pin the model operationally. No public, user-selected model URL is accepted. The adapter starts a fresh request, limits output and requests unloading after inference; external provider caches and host memory remain provider trust assumptions.
- Stretch goals in PLAN.md (gVisor/Firecracker, hardware attestation, permitted external benchmarks) require compatible infrastructure and are not represented as available Render features.

## Strict network deployment

Render's private services have no public ingress, but services in one workspace/region share a private network. The blueprint enforces default-deny **application authorization**, not per-pair packet filtering. Do not claim a Render-native per-cell firewall that the platform does not provide.

For the plan's explicit per-pair network boundary on a Docker-capable host:

```sh
docker compose --env-file .bayora/deployment.env -f infra/compose.production.yml up --build -d
```

This profile has internal networks only for documented call pairs and each service's database, independent volumes, non-root applications, read-only application filesystems, dropped capabilities, no Docker socket, CPU/memory/PID limits and no public cell/database ports. Its API binds localhost:3001; place an HTTPS reverse proxy in front for external access. Strict network semantics and container limits still require validation on the actual host. Render does not run a Compose file.

Sources: [Render private services](https://render.com/docs/private-services), [Render private networking](https://render.com/docs/private-network), [Blueprint specification](https://render.com/docs/blueprint-spec), [Render secrets](https://render.com/docs/configure-environment-variables), [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).
