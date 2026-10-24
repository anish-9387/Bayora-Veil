import { describe, it, expect } from 'vitest';
import {
  RunStatus,
  RunSchema,
  CreateRunSchema,
  ObservationSchema,
  AuditEventSchema,
  RunManifestSchema,
  VerifyResultSchema,
  SubmitPayloadSchema,
  TargetRequestSchema,
  BlueDefenseInputSchema,
  LeakageExperimentConfigSchema,
  ActorRole,
  EventType,
  Severity,
  OutcomeCategory,
  AccessClass
} from '../src/index.js';

describe('schemas', () => {
  describe('RunStatus', () => {
    it('accepts valid statuses', () => {
      expect(RunStatus.safeParse('CREATED').success).toBe(true);
      expect(RunStatus.safeParse('COMMITTED').success).toBe(true);
      expect(RunStatus.safeParse('RUNNING').success).toBe(true);
      expect(RunStatus.safeParse('EVALUATED').success).toBe(true);
      expect(RunStatus.safeParse('CLOSED').success).toBe(true);
      expect(RunStatus.safeParse('VERIFIED').success).toBe(true);
    });

    it('rejects invalid status', () => {
      expect(RunStatus.safeParse('INVALID').success).toBe(false);
    });
  });

  describe('ActorRole', () => {
    it('accepts valid roles', () => {
      const roles = ['red', 'blue', 'target', 'orchestrator', 'auditor', 'observation-firewall', 'audit-service'];
      roles.forEach(r => expect(ActorRole.safeParse(r).success).toBe(true));
    });
  });

  describe('EventType', () => {
    it('accepts valid event types', () => {
      const types = [
        'run_created', 'payload_committed', 'execution_started', 'target_response',
        'defense_applied', 'observation_released', 'evidence_stored', 'run_closed',
        'manifest_signed', 'verification_requested', 'verification_completed',
        'access_denied', 'leakage_experiment_started', 'leakage_experiment_completed'
      ];
      types.forEach(t => expect(EventType.safeParse(t).success).toBe(true));
    });
  });

  describe('Severity', () => {
    it('accepts valid severities', () => {
      expect(Severity.safeParse('low').success).toBe(true);
      expect(Severity.safeParse('medium').success).toBe(true);
      expect(Severity.safeParse('high').success).toBe(true);
      expect(Severity.safeParse('critical').success).toBe(true);
    });
  });

  describe('OutcomeCategory', () => {
    it('accepts valid categories', () => {
      const cats = ['policy_violation', 'instruction_hierarchy', 'data_exfiltration', 'prompt_injection', 'jailbreak', 'hallucination', 'bias', 'safe', 'not_tested', 'out_of_scope'];
      cats.forEach(c => expect(OutcomeCategory.safeParse(c).success).toBe(true));
    });
  });

  describe('AccessClass', () => {
    it('accepts valid access classes', () => {
      const classes = ['public', 'red_private', 'blue_private', 'target_private', 'auditor_only', 'raw_evidence'];
      classes.forEach(c => expect(AccessClass.safeParse(c).success).toBe(true));
    });
  });

  describe('CreateRunSchema', () => {
    it('validates required fields', () => {
      const valid = {
        policyVersion: 'v1.0.0',
        modelAdapter: 'mock-adapter',
        createdBy: '11111111-1111-1111-1111-111111111111'
      };
      expect(CreateRunSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects missing policyVersion', () => {
      const invalid = { modelAdapter: 'mock', createdBy: '11111111-1111-1111-1111-111111111111' };
      expect(CreateRunSchema.safeParse(invalid).success).toBe(false);
    });

    it('rejects invalid UUID', () => {
      const invalid = { policyVersion: 'v1', modelAdapter: 'mock', createdBy: 'not-uuid' };
      expect(CreateRunSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('SubmitPayloadSchema', () => {
    it('accepts valid payload', () => {
      const valid = { payload: 'test prompt', metadata: { key: 'value' } };
      expect(SubmitPayloadSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects empty payload', () => {
      const invalid = { payload: '' };
      expect(SubmitPayloadSchema.safeParse(invalid).success).toBe(false);
    });

    it('rejects oversized payload', () => {
      const invalid = { payload: 'x'.repeat(100001) };
      expect(SubmitPayloadSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('ObservationSchema', () => {
    const validObservation = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      runId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      caseId: 'case_001',
      outcome: 'policy_violation',
      severity: 'high',
      category: 'prompt_injection',
      confidence: 0.95,
      evidenceDigest: 'sha256:' + 'a'.repeat(64),
      releasedAt: '2026-01-01T12:00:00Z',
      releasedAfterPhase: 'evaluation_closed'
    };

    it('validates correct observation', () => {
      expect(ObservationSchema.safeParse(validObservation).success).toBe(true);
    });

    it('rejects invalid confidence', () => {
      const invalid = { ...validObservation, confidence: 1.5 };
      expect(ObservationSchema.safeParse(invalid).success).toBe(false);
    });

    it('rejects invalid evidence digest', () => {
      const invalid = { ...validObservation, evidenceDigest: 'not-a-hash' };
      expect(ObservationSchema.safeParse(invalid).success).toBe(false);
    });

    it('rejects invalid severity', () => {
      const invalid = { ...validObservation, severity: 'extreme' };
      expect(ObservationSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('AuditEventSchema', () => {
    const validEvent = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      runId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      sequence: 1,
      eventType: 'run_created',
      timestamp: '2026-01-01T12:00:00Z',
      actor: 'orchestrator',
      payloadDigest: 'sha256:' + 'a'.repeat(64),
      previousEventHash: 'sha256:' + '0'.repeat(64),
      eventHash: 'sha256:' + 'b'.repeat(64),
      createdAt: '2026-01-01T12:00:00Z'
    };

    it('validates correct event', () => {
      expect(AuditEventSchema.safeParse(validEvent).success).toBe(true);
    });

    it('rejects invalid sequence', () => {
      const invalid = { ...validEvent, sequence: 0 };
      expect(AuditEventSchema.safeParse(invalid).success).toBe(false);
    });

    it('rejects invalid hashes', () => {
      const invalid = { ...validEvent, eventHash: 'invalid' };
      expect(AuditEventSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('RunManifestSchema', () => {
    const validManifest = {
      runId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      merkleRoot: 'sha256:' + 'a'.repeat(64),
      finalChainHash: 'sha256:' + 'b'.repeat(64),
      signature: 'c'.repeat(128),
      publicKeyId: 'bayora-eval-key-001',
      eventCount: 10,
      policyVersion: 'v1.0.0',
      modelAdapter: 'mock-adapter',
      createdAt: '2026-01-01T12:00:00Z'
    };

    it('validates correct manifest', () => {
      expect(RunManifestSchema.safeParse(validManifest).success).toBe(true);
    });

    it('rejects invalid signature length', () => {
      const invalid = { ...validManifest, signature: 'short' };
      expect(RunManifestSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('VerifyResultSchema', () => {
    it('validates valid result', () => {
      const valid = {
        valid: true,
        runId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        checks: [{ name: 'hash', passed: true }]
      };
      expect(VerifyResultSchema.safeParse(valid).success).toBe(true);
    });

    it('validates result with tampered events', () => {
      const valid = {
        valid: false,
        runId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        checks: [{ name: 'hash', passed: false }],
        tamperedEvents: [{ sequence: 1, expectedHash: 'sha256:a', actualHash: 'sha256:b' }]
      };
      expect(VerifyResultSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('TargetRequestSchema', () => {
    it('validates correct request', () => {
      const valid = {
        runId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        caseId: 'case_001',
        prompt: 'test prompt',
        timeoutMs: 30000
      };
      expect(TargetRequestSchema.safeParse(valid).success).toBe(true);
    });

    it('uses default timeout', () => {
      const valid = { runId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', caseId: 'b', prompt: 'c' };
      const parsed = TargetRequestSchema.parse(valid);
      expect(parsed.timeoutMs).toBe(30000);
    });
  });

  describe('BlueDefenseInputSchema', () => {
    it('validates correct input', () => {
      const valid = {
        runId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        caseId: 'case_001',
        observation: {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          runId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          caseId: 'case_001',
          outcome: 'safe',
          severity: 'low',
          category: 'safe',
          confidence: 0.5,
          evidenceDigest: 'sha256:' + 'a'.repeat(64),
          releasedAt: '2026-01-01T12:00:00.000Z',
          releasedAfterPhase: 'evaluation_closed'
        }
      };
      const result = BlueDefenseInputSchema.safeParse(valid);
      if (!result.success) {
        console.log('Validation errors:', JSON.stringify(result.error.flatten(), null, 2));
      }
      expect(result.success).toBe(true);
    });
  });

  describe('LeakageExperimentConfigSchema', () => {
    it('validates blind_classification', () => {
      const valid = {
        type: 'blind_classification',
        runId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        config: { samples: 100 }
      };
      expect(LeakageExperimentConfigSchema.safeParse(valid).success).toBe(true);
    });

    it('validates timing_leakage', () => {
      const valid = {
        type: 'timing_leakage',
        runId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        config: { profiles: ['fast', 'slow'] }
      };
      expect(LeakageExperimentConfigSchema.safeParse(valid).success).toBe(true);
    });

    it('validates cross_tenant_access', () => {
      const valid = {
        type: 'cross_tenant_access',
        runId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        config: { attempts: 20 }
      };
      expect(LeakageExperimentConfigSchema.safeParse(valid).success).toBe(true);
    });
  });
});