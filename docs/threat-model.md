# Threat Model

## Assets

| Asset | Classification | Description |
|-------|---------------|-------------|
| Red Team Payloads | CONFIDENTIAL | Adversarial prompts, hidden attack labels, synthetic test cases |
| Blue Team Rules | CONFIDENTIAL | Detection logic, mitigation policies, classification thresholds |
| Target Interactions | CONFIDENTIAL | Raw prompts, responses, tool traces, internal model state |
| Raw Evidence | RESTRICTED | Complete execution traces, stack traces, timing data |
| Audit Trail | INTEGRITY-CRITICAL | Event sequence, hash chain, Merkle root, signatures |

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                    CONTROL PLANE                             │
│  API Gateway • Orchestrator • Policy Service • Scheduler    │
│  Trust: PARTIAL — Coordinates but no raw secret access      │
└─────────────────────────────────────────────────────────────┘
         │              │              │              │
    ┌────▼────┐    ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
    │RED CELL │    │TARGET   │    │BLUE CELL│    │ EVIDENCE  │
    │         │    │CELL     │    │         │    │ DOMAIN    │
    │Payloads │    │Model    │    │Rules    │    │           │
    │+ Runner │    │Adapter  │    │+ Runner │    │Raw+Clean  │
    │Trust:HI │    │Trust:HI │    │Trust:HI │    │Trust:HI   │
    └─────────┘    └─────────┘    └─────────┘    └───────────┘
                                               │
                                        ┌──────▼──────┐
                                        │ AUDIT DOMAIN│
                                        │ Events+Sigs │
                                        │ Trust: HIGH │
                                        └─────────────┘
```

## Attack Surface Analysis

### Tested & Mitigated

| Attack | Vector | Mitigation | Status |
|--------|--------|------------|--------|
| Cross-team API access | Blue→Red payload endpoint | Default-deny network + capability auth | ✅ Tested |
| Raw evidence during blind run | Blue/Red→evidence store | Firewall blocks until CLOSED+auditor | ✅ Tested |
| Timing side channel | Latency inference | 100ms bucketing + noise + fixed envelopes | ⚠️ Partial |
| Cross-run context reuse | Shared KV cache | Fresh session per case | ✅ Tested |
| Prompt injection for secrets | Target→system prompt | Mock refusal + isolation | ✅ Tested |
| Resource exhaustion | Long payloads | 30s timeout + queue limits | ✅ Tested |

### Residual Risks

| Risk | Likelihood | Impact | Notes |
|------|------------|--------|-------|
| Host/kernel compromise | Low | Critical | Docker is dev boundary only |
| CPU cache/power side channels | Low | Medium | Requires confidential computing |
| Semantic leakage | Medium | Medium | Firewall reduces, not eliminates |
| Malicious admin + signing key | Low | Critical | No hardware root of trust |
| Key compromise | Low | High | Demo key in memory only |
| External provider visibility | High | Medium | Ollama/API sees all traffic |
| Label quality | Medium | Low | Synthetic labels only |

## Assumptions

1. Docker containers provide process-level isolation (not hardware)
2. Network policies enforced by Docker Compose (not production CNI)
3. Signing key stored in memory for demo (production needs HSM)
4. Mock model behaves deterministically
5. Synthetic test cases represent attack distribution
6. No insider threat from orchestration service
7. Time synchronization across services for audit ordering

## Security Controls Implemented

- **Isolation by Default**: Separate containers, networks, credentials per cell
- **Capability-Based Auth**: Scoped permissions (`red.submit_payload`, `blue.read_sanitized_observation`, etc.)
- **Observation Firewall**: Allow-list schema (no deny-list sanitization)
- **Timing Mitigations**: 100ms bucketing, ±50ms noise, fixed response envelopes
- **Hash Chain**: SHA-256(event || previous_hash) with genesis
- **Merkle Root**: Binary tree over event hashes at closure
- **Ed25519 Signatures**: Manifest signed, public key preserved externally
- **Deterministic Replay**: Worker recomputes chain, root, evidence digests
- **Leakage Measurement**: Controlled experiments with methodology disclosure

## Stretch Goals

- gVisor/Firecracker for stronger runtime boundary
- Policy-as-code with versioned test policies
- Public safety benchmark import (AdvBench, HarmBench)
- Remote attestation (requires hardware/cloud support)
- Hardware-backed key storage (HSM/KMS)