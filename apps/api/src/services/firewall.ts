import { z } from 'zod';
import { ObservationSchema, EvidenceArtifactSchema, AccessClass, OutcomeCategory, Severity } from '@bayora/schemas';
import { hash } from '@bayora/crypto-utils';
import { v4 as uuidv4 } from 'uuid';

interface RawEvidence {
  runId: string;
  caseId: string;
  prompt: string;
  response: string;
  defenseRule?: string;
  stackTrace?: string;
  toolTrace?: string;
  timing?: Record<string, number>;
  hiddenLabels?: Record<string, string>;
}

const ALLOWED_OUTCOMES: OutcomeCategory[] = [
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
];

const ALLOWED_SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

export class ObservationFirewall {
  private runPhase: Map<string, string> = new Map();
  private pendingObservations: Map<string, RawEvidence[]> = new Map();

  setRunPhase(runId: string, phase: string) {
    this.runPhase.set(runId, phase);
  }

  getRunPhase(runId: string): string {
    return this.runPhase.get(runId) || 'created';
  }

  async processEvidence(runId: string, caseId: string, evidence: RawEvidence): Promise<void> {
    this.pendingObservations.set(`${runId}:${caseId}`, [evidence]);
  }

  async releaseObservation(
    runId: string,
    caseId: string,
    outcome: OutcomeCategory,
    severity: Severity,
    category: OutcomeCategory,
    confidence: number
  ): Promise<z.infer<typeof ObservationSchema> | null> {
    const phase = this.getRunPhase(runId);
    if (phase !== 'evaluation_closed' && phase !== 'closed') {
      return null;
    }

    const evidenceKey = `${runId}:${caseId}`;
    const evidenceList = this.pendingObservations.get(evidenceKey);
    if (!evidenceList || evidenceList.length === 0) {
      return null;
    }

    const evidence = evidenceList[0];
    const evidenceDigest = hash(JSON.stringify({
      prompt: evidence.prompt,
      response: evidence.response,
      defenseRule: evidence.defenseRule,
      timing: evidence.timing
    }));

    const observation = {
      id: uuidv4(),
      runId,
      caseId,
      outcome,
      severity,
      category,
      confidence: Math.max(0, Math.min(1, confidence)),
      evidenceDigest,
      releasedAt: new Date().toISOString(),
      releasedAfterPhase: phase
    };

    this.pendingObservations.delete(evidenceKey);
    return ObservationSchema.parse(observation);
  }

  sanitizeForBlue(rawEvidence: RawEvidence): Partial<RawEvidence> {
    return {
      caseId: rawEvidence.caseId,
      response: this.truncateResponse(rawEvidence.response),
      timing: this.bucketTiming(rawEvidence.timing)
    };
  }

  sanitizeForRed(rawEvidence: RawEvidence): { caseId: string; outcome: string } {
    return {
      caseId: rawEvidence.caseId,
      outcome: 'policy_violation'
    };
  }

  sanitizeForAuditor(rawEvidence: RawEvidence): RawEvidence {
    return { ...rawEvidence };
  }

  private truncateResponse(response: string, maxLength = 500): string {
    if (response.length <= maxLength) return response;
    return response.substring(0, maxLength) + '... [truncated]';
  }

  private bucketTiming(timing?: Record<string, number>): Record<string, number> | undefined {
    if (!timing) return undefined;
    const bucketed: Record<string, number> = {};
    for (const [key, value] of Object.entries(timing)) {
      bucketed[key] = Math.floor(value / 100) * 100;
    }
    return bucketed;
  }

  filterEvidenceByAccessClass(artifacts: z.infer<typeof EvidenceArtifactSchema>[], requesterRole: string): z.infer<typeof EvidenceArtifactSchema>[] {
    const allowedClasses: Record<string, AccessClass[]> = {
      red: ['public', 'red_private'],
      blue: ['public', 'blue_private'],
      target: ['public', 'target_private'],
      auditor: ['public', 'red_private', 'blue_private', 'target_private', 'auditor_only', 'raw_evidence'],
      orchestrator: ['public', 'red_private', 'blue_private', 'target_private', 'auditor_only', 'raw_evidence'],
      'observation-firewall': ['public', 'red_private', 'blue_private', 'target_private', 'auditor_only', 'raw_evidence']
    };

    const allowed = allowedClasses[requesterRole] || ['public'];
    return artifacts.filter(a => allowed.includes(a.accessClass));
  }

  validateObservationSchema(data: unknown): z.infer<typeof ObservationSchema> | null {
    const result = ObservationSchema.safeParse(data);
    return result.success ? result.data : null;
  }

  createDelayedRelease(runId: string, delayMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

export const observationFirewall = new ObservationFirewall();