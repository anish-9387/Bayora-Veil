# PLAN.md implementation and deployment review

Reviewed 25 October 2026. PLAN.md remains the design target; this document maps its baseline requirements to the implemented production profile and the remaining deployment verification. The previous Windows-only gap report is superseded.

| Baseline requirement | Implementation and evidence |
| --- | --- |
| Complete run lifecycle | Created → Committed → Running → Evaluated → Closed → Verified; backend transition checks, per-run PostgreSQL locks, retry handling and production smoke assertions |
| Separate Red/Blue identities | Fixed server-assigned account roles, tenant authorization, independent service tokens, processes and databases; forged role headers and wrong cell credentials are denied |
| Private Red payload store and commitment | Red database stores payload and random nonce; domain-separated SHA-256 commitment is recorded before execution and rechecked inside Red |
| Target isolation and fresh context | Separate private Python service, no team database credentials/volumes, strict request envelope, fresh stateless request and no user-selected provider URL |
| Simple private Blue defense | Separate Blue database and process; strict sanitized input, private rule, deterministic flag for an unassessed outcome |
| Observation Firewall | Constructed allow-list output plus strict validation at Red → API → Blue boundaries; no raw prompt, response, hidden label, private rule or precise duration is released |
| Restricted evidence | Raw Red/Target and Blue records stay in their respective databases; auditor access requires closed/verified state, and cell records freeze at closure |
| Resource budgets | Two concurrent work leases per tenant, twenty across the API, two Target slots, database/request timeouts and shared rate limits; Compose adds CPU/memory/PID limits |
| Tamper-evident audit | Separate audit database and signer; canonical safe metadata, sequence/hash chain, Merkle root, signed policy/model-adapter/dataset versions, immutable database rows |
| Verification and replay | Online and offline pinned-key verification, modified/deleted/reordered copied-event checks, independent Replay process with read-only closed-evidence credentials and fresh response digest comparison |
| Measured leakage | Balanced marker classifier with opaque IDs, baseline and nominal Wilson intervals; measured timer distributions/percentiles; actual authenticated cross-role and cross-tenant HTTP probes |
| Dashboard and errors | Responsive light interface, account login/sign-out, actual counts/latency, evidence/verification/replay, saved experiment history, failure/error states and scoped navigation |
| Setup, tests and demonstration | Render blueprint, Vercel configuration, non-root container images, strict-network Compose profile, locked Node/Python dependencies, CI and production deployment guide |

## Boundaries that require a deployment decision

**Render networking:** private cells have no public ingress, but Render services in one workspace and region share a private network. Application authorization defaults to denial unless the correct scoped credential and operation are supplied. Native Render does not provide this implementation with per-pair packet filtering. `infra/compose.production.yml` defines the stricter allowed network pairs on a Docker-capable host. That platform distinction prevents claiming identical network guarantees for the two deployments.

**Trusted gateway:** raw Red submissions and authorized auditor evidence transit the authenticated API gateway's memory. The production metadata database rejects non-null raw evidence content, the orchestrator role cannot retrieve private raw routes, and execution runs through Red/Target without sending raw responses through orchestration. If the requirement means an entirely untrusted gateway must never see plaintext bytes, additional direct client-to-cell encryption/ingress is required; that is not a guarantee of this profile.

**Root and administrator trust:** append-only triggers protect ordinary writes, not an administrator who can change DDL, code or signing keys. Preserve signed roots and public keys externally. Render secret access, database backups, restore drills, TLS origins, sizing and operational monitoring need verification on the actual hosting account.

## PLAN stretch goals

Ollama integration exists but needs a configured private provider and real-model testing. gVisor/Firecracker, confidential computing/attestation, policy-as-code beyond the pinned baseline policy, and external public benchmark imports are not shipped as supported Render capabilities. They are explicitly stretch goals in PLAN.md. No hardware isolation or general safety/zero-leakage claim is made.

## Verification scope

The workspace build, unit/authorization/crypto suite, Python adapter tests, isolated production smoke, dependency vulnerability checks and Render schema validation are the executable gates. The production smoke uses distinct non-superuser database roles and checks denial of another cell database, not merely distinct connection names. Local processes do not prove Docker or Render filesystem/network enforcement. Container builds and live cloud checks remain deployment gates when those runtimes/accounts are available.

See [production deployment](production-deployment.md) for commands and the operator checklist. A passing local suite is evidence about the implemented paths, not a promise of perfect security.

Validated in this implementation: all workspace packages build; 124 tests pass across 15 files; all 3 Python tests pass; the complete isolated production smoke passes, including distinct database-role denial, budget rejection, tamper rejection/recovery, closed-write guards, canonical metadata and offline pinned-key verification. The browser check confirms operator sign-in/sign-out, auditor evidence rendering, replay and verification at phone/laptop widths. Node production audit and OSV lookup for 24 pinned Python packages report no known advisories at the time checked. The Render blueprint passes the official JSON Schema. Docker is unavailable on this workstation; container builds/runtime policies and live Render/Vercel deployment have not been verified here.
