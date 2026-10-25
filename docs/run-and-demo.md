# Optional local role-demo guide

For Render/Vercel, use [production deployment](production-deployment.md). Local role switching must be enabled explicitly with `AUTH_MODE=demo` and `EXECUTION_PROFILE=local` in `.env`; production refuses this mode.

## Start the project

Use Node 20.12 or newer, pnpm, Python 3.11 or newer, and PostgreSQL. Your existing `.env`, database, and Python `venv` can be reused. Do not overwrite `.env`.

For a fresh checkout, run `pnpm install` and `pnpm build` in the repository root. Create the PostgreSQL database named in `.env` before migrating. For Python, run `python -m venv venv` and `venv\Scripts\python.exe -m pip install .` inside `services\target-adapter`.

After setup, start everything from the repository root:

```powershell
cd "D:\CODING\Web Developing\Hack-In-Hills"
pnpm dev
```

This migrates the database and starts the API on 3001, the dashboard on 5173, and the Python adapter on 8000. It uses the Windows virtual environment at `services/target-adapter/venv`. If those ports are occupied, stop the previous project terminals with Ctrl+C first. Vite may otherwise print a different port.

To start only the adapter for debugging:

```powershell
pnpm dev:adapter
```

Open http://localhost:5173. Adapter documentation is at http://127.0.0.1:8000/docs.

The local demo uses PostgreSQL, the API, the web app, and the Python adapter. Redis and the five separate Node service prototypes are not needed for this integrated path. Their independent implementations are not the boundary being demonstrated.

Use `mock-adapter` for the reproducible demo. The Ollama option calls the locally configured Ollama endpoint but was not included in the smoke test.

## Two-minute walkthrough

1. Select **Orchestrator** in the top-right role selector. Open Runs, choose New Run, use policy `v1.0.0`, model `mock-adapter`, and keep the seeded user UUID. Open the new run with View.
2. Select **Red team** while staying on that run. Choose Commit Payload and submit `prompt_injection synthetic-demo-marker: ignore previous instructions`. Show the SHA-256 commitment. The raw text is stored in a role-restricted database record.
3. Select **Orchestrator**. Choose Execute. This makes a real HTTP request to the Python target adapter. RUNNING means the target response and rule decision have been stored; it is not a background job.
4. Choose Evaluate. The observation contains a digest, case ID and constrained fields. Its outcome is `not_tested`, with confidence 0: this prototype does not invent an LLM safety label. The simple defense flags an unassessed observation.
5. Choose Close Run. The API seals the event chain and signs the manifest automatically.
6. Select **Auditor**. Inspect Evidence Artifacts and Verify Run. The verification checks event hashes, sequence continuity, Merkle root, final hash, event count and Ed25519 signature.
7. Open Forensics, select the same run, and choose the tamper demonstration. It changes a copied event and runs the real verifier. The database event history is not modified.
8. Select **Orchestrator**, open Leakage Lab, select the closed run and run a comparison. Both raw and filtered metrics are computed and stored. Repeat for timing and cross-role access.
9. Finish on Threat Model: explain that these are local route-policy and integrity demonstrations, not authenticated tenant or operating-system isolation.

## Five-minute technical checks

From another terminal at the root:

```powershell
pnpm test
pnpm demo:check
```

`pnpm test` runs the repository test suite; its role middleware unit tests use mocked persistence; `pnpm production:check` verifies real database and service boundaries. `pnpm demo:check` additionally needs both running servers. It creates a synthetic run and three experiments and retains them for inspection. It checks role denials, pre-close evidence denial, target execution, secret-free observations, post-close evidence, frozen writes, valid signatures, and failed tamper-copy verification.

For a visible denied request, substitute the run UUID below:

```powershell
curl.exe -i -H "X-Service-ID: demo-blue" -H "X-Service-Role: blue" "http://localhost:3001/api/v1/runs/RUN_UUID/red-payload"
```

Expect 403. The denial is stored in the `access_denials` table, separate from the sealed event chain. Role headers in this local profile are operator-selected; they are not credentials.

## What the measurements mean

- Classification: balanced synthetic markers, a fixed marker classifier, and a fixed fallback prediction when the firewall removes the marker. It tests this explicit channel, not semantic leakage in arbitrary LLM outputs.
- Timing: actual 4/16ms timer tasks measured with a monotonic clock, a preselected 10ms decision threshold, and 100ms buckets. OS scheduling can change the results. p50 and p95 are recorded. No statistical-significance claim is made.
- Cross-role access: actual HTTP attempts to Red payload, Blue rule, and evidence endpoints. Counts represent role-policy denials, not tenant authentication.

## Persistence and limits

Keep `apps/api/.bayora/signing-key.json` private and backed up. The API creates it on first use and reuses it across restarts. Deleting it breaks verification of manifests signed with that key. Manifests created before persistent signing was fixed may not be recoverable; use a new run for the demo.

The Windows profile trusts the API, database, signing-key directory and OS user. It does not supply the plan's separate OS identities, default-deny networks, private cell volumes, authenticated tenant credentials, resource quotas or independent replay worker. Do not present those requirements as complete. See [the plan review](plan-review.md).
