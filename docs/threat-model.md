# Threat model

The production baseline protects ordinary application paths with authenticated accounts, tenant ownership checks, fixed roles, scoped cell credentials, separate private stores, minimized observations, closure guards and signed evidence.

Tested paths include forged role headers, foreign-tenant run and experiment access, Blue-to-Red and Red-to-Blue requests, early evidence access, wrong cell credentials, cross-database credential use, resource-budget rejection, payload commitment mismatch, closed-write rejection, invalid event copies, wrong verification keys and fresh target replay. See [the implementation map](plan-review.md) for verification scope.

A random private per-run nonce prevents simple dictionary matching and cross-run correlation of public commitment/evidence digests. Canonical audit metadata excludes raw prompts, responses, private rules, credentials and nonces. Auditors receive restricted evidence only after closure.

The API gateway sees raw submissions/reveals in transit. Hosting administrators, service code, database DDL owners and signing-key access remain trusted. Preserve signed roots and public keys externally. Hash chains and triggers cannot establish integrity against an administrator controlling both data and keys.

Render private services do not supply per-pair packet filtering. Compose configures that stronger network boundary on a suitable host. Filesystem, container and platform policy enforcement must be checked in the deployment itself.

The synthetic experiments measure selected explicit/timing/access channels. They do not prove absence of semantic leakage or hardware side channels. A mock refusal is not a real-model safety verdict; unknown outcomes stay not_tested. Provider-side caches, real-model safety, kernel compromise, volumetric DDoS, hardware attestation and formal noninterference are not established by these checks.

[Production setup, residual risks and operator responsibilities](production-deployment.md).
