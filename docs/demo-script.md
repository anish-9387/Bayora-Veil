# Production demonstration

Prepare four assigned accounts in one tenant: Orchestrator, Red, Blue and Auditor. Use separate browser profiles or sign out/in. Production rejects client-selected roles. See [the deployment guide](production-deployment.md) for provisioning.

1. Orchestrator creates a run with policy v1.0.0 and mock-adapter.
2. Red commits a harmless synthetic prompt. Show the opaque SHA-256 commitment; its private nonce stays in Red storage until auditor reveal.
3. Orchestrator executes and evaluates. Blue sees only the allow-listed observation. An unassessed outcome remains not_tested with confidence 0 and the private rule flags it.
4. Orchestrator closes the run. The raw stores freeze and the independent audit service seals/signs the complete ordered protocol.
5. Auditor opens the same run, inspects raw evidence and nonce, and verifies the chain, canonical metadata, Merkle root, event count and signature.
6. Forensics runs the copied-event tamper demonstration. Replaying a fresh Target session compares its response digest with the sealed original. Download a bundle and check it offline using an independently preserved public key.
7. Orchestrator opens Leakage Lab and runs classification, timing and authenticated tenant/role access probes. Show sample counts, methods, measured denial rates and saved history. The tests exercise actual server-issued identities rather than caller-supplied role headers.
8. End on Threat Model and explain the gateway/administrator trust assumptions and Render's shared private network. Do not claim hardware attestation, universal model safety or zero leakage.

For a technical check, run pnpm test and pnpm production:check against disposable local PostgreSQL credentials. The latter starts the isolated production services temporarily and asserts authentication, cross-tenant/cell/database denials, work budgets, tamper rejection/recovery, immutable writes, signatures, offline proof verification, target replay and stored experiments. It retains synthetic test records and stops its processes.

The optional local AUTH_MODE=demo profile supports a role picker for development only. It does not demonstrate authenticated tenancy. Use the production profile for the complete protocol demonstration.
