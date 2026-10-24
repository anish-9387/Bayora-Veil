import { z } from 'zod';

export const RunStatus = z.enum(['CREATED', 'COMMITTED', 'RUNNING', 'EVALUATED', 'CLOSED', 'VERIFIED']);
export type RunStatus = z.infer<typeof RunStatus>;

export const ActorRole = z.enum(['red', 'blue', 'target', 'orchestrator', 'auditor', 'observation-firewall', 'audit-service']);
export type ActorRole = z.infer<typeof ActorRole>;

export const EventType = z.enum([
  'run_created',
  'payload_committed',
  'execution_started',
  'target_response',
  'defense_applied',
  'observation_released',
  'evidence_stored',
  'run_closed',
  'manifest_signed',
  'verification_requested',
  'verification_completed',
  'access_denied',
  'leakage_experiment_started',
  'leakage_experiment_completed'
]);
export type EventType = z.infer<typeof EventType>;

export const AccessClass = z.enum(['public', 'red_private', 'blue_private', 'target_private', 'auditor_only', 'raw_evidence']);
export type AccessClass = z.infer<typeof AccessClass>;

export const Severity = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof Severity>;

export const OutcomeCategory = z.enum([
  'policy_violation',
  'instruction_hierarchy',
  'data_exfiltration',
  'prompt_injection',
  'jailbreak',
  'hallucination',
  'bias',
  'safe',
  'not_tested',
  'out_of_scope'
]);
export type OutcomeCategory = z.infer<typeof OutcomeCategory>;

export const CreateRunSchema = z.object({
  policyVersion: z.string().min(1),
  modelAdapter: z.string().min(1),
  createdBy: z.string().uuid(),
  config: z.record(z.unknown()).optional()
});
export type CreateRunInput = z.infer<typeof CreateRunSchema>;

export const RunSchema = z.object({
  id: z.string().uuid(),
  status: RunStatus,
  policyVersion: z.string(),
  modelAdapter: z.string(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  config: z.record(z.unknown()).optional()
});
export type Run = z.infer<typeof RunSchema>;

export const PayloadCommitmentSchema = z.object({
  runId: z.string().uuid(),
  commitmentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  revealAfterClose: z.boolean().default(true)
});
export type PayloadCommitment = z.infer<typeof PayloadCommitmentSchema>;

export const SubmitPayloadSchema = z.object({
  payload: z.string().min(1).max(100000),
  metadata: z.record(z.unknown()).optional()
});
export type SubmitPayloadInput = z.infer<typeof SubmitPayloadSchema>;

export const ObservationSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  caseId: z.string(),
  outcome: OutcomeCategory,
  severity: Severity,
  category: OutcomeCategory,
  confidence: z.number().min(0).max(1),
  evidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  releasedAt: z.string().datetime(),
  releasedAfterPhase: z.string()
});
export type Observation = z.infer<typeof ObservationSchema>;

export const EvidenceArtifactSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  artifactType: z.enum(['prompt', 'response', 'defense_rule', 'stack_trace', 'tool_trace', 'timing', 'other']),
  storageKey: z.string(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  accessClass: AccessClass,
  createdAt: z.string().datetime()
});
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  sequence: z.number().int().positive(),
  eventType: EventType,
  timestamp: z.string().datetime(),
  actor: ActorRole,
  payloadDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  previousEventHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  eventHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdAt: z.string().datetime()
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const RunManifestSchema = z.object({
  runId: z.string().uuid(),
  merkleRoot: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  finalChainHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  signature: z.string().min(128), // Ed25519 signature is 128 hex chars
  publicKeyId: z.string(),
  eventCount: z.number().int().nonnegative(),
  policyVersion: z.string(),
  modelAdapter: z.string(),
  createdAt: z.string().datetime()
});
export type RunManifest = z.infer<typeof RunManifestSchema>;

export const LeakageExperimentConfigSchema = z.object({
  type: z.enum(['blind_classification', 'timing_leakage', 'cross_tenant_access']),
  runId: z.string().uuid(),
  config: z.record(z.unknown())
});
export type LeakageExperimentConfig = z.infer<typeof LeakageExperimentConfigSchema>;

export const ExperimentResultSchema = z.object({
  experimentId: z.string().uuid(),
  metricName: z.string(),
  metricValue: z.number(),
  sampleCount: z.number().int().positive(),
  method: z.string(),
  createdAt: z.string().datetime()
});
export type ExperimentResult = z.infer<typeof ExperimentResultSchema>;

export const TargetRequestSchema = z.object({
  runId: z.string().uuid(),
  caseId: z.string(),
  prompt: z.string(),
  context: z.record(z.unknown()).optional(),
  timeoutMs: z.number().int().positive().default(30000)
});
export type TargetRequest = z.infer<typeof TargetRequestSchema>;

export const TargetResponseSchema = z.object({
  runId: z.string().uuid(),
  caseId: z.string(),
  response: z.string(),
  tokensUsed: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).optional()
});
export type TargetResponse = z.infer<typeof TargetResponseSchema>;

export const BlueDefenseInputSchema = z.object({
  runId: z.string().uuid(),
  caseId: z.string(),
  observation: ObservationSchema,
  defenseConfig: z.record(z.unknown()).optional()
});
export type BlueDefenseInput = z.infer<typeof BlueDefenseInputSchema>;

export const BlueDefenseOutputSchema = z.object({
  runId: z.string().uuid(),
  caseId: z.string(),
  action: z.enum(['allow', 'block', 'flag', 'modify']),
  reason: z.string(),
  modifiedObservation: ObservationSchema.optional(),
  metadata: z.record(z.unknown()).optional()
});
export type BlueDefenseOutput = z.infer<typeof BlueDefenseOutputSchema>;

export const CapabilitySchema = z.object({
  capability: z.string(),
  resource: z.string(),
  action: z.string()
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const ServiceIdentitySchema = z.object({
  serviceId: z.string(),
  role: ActorRole,
  capabilities: z.array(CapabilitySchema)
});
export type ServiceIdentity = z.infer<typeof ServiceIdentitySchema>;

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string().uuid()
    }).optional(),
    requestId: z.string().uuid()
  });

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalPages: z.number().int().nonnegative()
  });

export const HealthCheckSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  service: z.string(),
  version: z.string(),
  timestamp: z.string().datetime(),
  checks: z.record(z.object({
    status: z.enum(['pass', 'warn', 'fail']),
    message: z.string().optional()
  })).optional()
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;

export const VerifyResultSchema = z.object({
  valid: z.boolean(),
  runId: z.string().uuid(),
  checks: z.array(z.object({
    name: z.string(),
    passed: z.boolean(),
    detail: z.string().optional()
  })),
  tamperedEvents: z.array(z.object({
    sequence: z.number(),
    expectedHash: z.string(),
    actualHash: z.string()
  })).optional()
});
export type VerifyResult = z.infer<typeof VerifyResultSchema>;