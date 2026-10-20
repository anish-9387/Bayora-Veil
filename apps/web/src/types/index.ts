export type RunStatus = 'CREATED' | 'COMMITTED' | 'RUNNING' | 'EVALUATED' | 'CLOSED' | 'VERIFIED';

export interface Run {
  id: string;
  status: RunStatus;
  policyVersion: string;
  modelAdapter: string;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
  config?: Record<string, unknown>;
}

export interface Observation {
  id: string;
  runId: string;
  caseId: string;
  outcome: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  confidence: number;
  evidenceDigest: string;
  releasedAt: string;
  releasedAfterPhase: string;
}

export interface EvidenceArtifact {
  id: string;
  runId: string;
  artifactType: string;
  storageKey: string;
  digest: string;
  accessClass: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  runId: string;
  sequence: number;
  eventType: string;
  timestamp: string;
  actor: string;
  payloadDigest: string;
  previousEventHash: string;
  eventHash: string;
  createdAt: string;
}

export interface RunManifest {
  runId: string;
  merkleRoot: string;
  finalChainHash: string;
  signature: string;
  publicKeyId: string;
  eventCount: number;
  policyVersion: string;
  modelAdapter: string;
  createdAt: string;
}

export interface VerifyResult {
  valid: boolean;
  runId: string;
  checks: Array<{
    name: string;
    passed: boolean;
    detail?: string;
  }>;
  tamperedEvents?: Array<{
    sequence: number;
    expectedHash: string;
    actualHash: string;
  }>;
}

export interface ExperimentResult {
  experimentId: string;
  metricName: string;
  metricValue: number;
  sampleCount: number;
  method: string;
  createdAt: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    requestId: string;
  };
  requestId: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}