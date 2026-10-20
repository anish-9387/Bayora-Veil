import { describe, it, expect } from 'vitest';
import { CapabilitySchema, ActorRole } from '@bayora/schemas';

const CAPABILITY_MAP: Record<ActorRole, string[]> = {
  red: ['red.submit_payload', 'red.read_own_payload', 'red.commit_payload'],
  blue: ['blue.read_sanitized_observation', 'blue.apply_defense', 'blue.read_own_rules'],
  target: ['target.execute_case', 'target.read_context'],
  auditor: ['auditor.read_closed_run_evidence', 'auditor.verify_manifest', 'auditor.read_audit_log'],
  orchestrator: ['orchestrator.create_run', 'orchestrator.transition_run', 'orchestrator.read_all'],
  'observation-firewall': ['firewall.release_observation', 'firewall.filter_evidence'],
  'audit-service': ['audit.append_event', 'audit.build_manifest', 'audit.sign_manifest']
};

describe('Capability Matrix', () => {
  it('defines capabilities for all roles', () => {
    const roles: ActorRole[] = ['red', 'blue', 'target', 'auditor', 'orchestrator', 'observation-firewall', 'audit-service'];
    roles.forEach(role => {
      expect(CAPABILITY_MAP[role]).toBeDefined();
      expect(CAPABILITY_MAP[role].length).toBeGreaterThan(0);
    });
  });

  it('red cannot read blue capabilities', () => {
    const redCaps = CAPABILITY_MAP.red;
    const blueCaps = CAPABILITY_MAP.blue;
    expect(redCaps.some(c => c.startsWith('blue.')).toBe(false));
  });

  it('blue cannot read red capabilities', () => {
    const redCaps = CAPABILITY_MAP.red;
    const blueCaps = CAPABILITY_MAP.blue;
    expect(blueCaps.some(c => c.startsWith('red.')).toBe(false));
  });

  it('target has no access to red or blue stores', () => {
    const targetCaps = CAPABILITY_MAP.target;
    expect(targetCaps.some(c => c.startsWith('red.') || c.startsWith('blue.'))).toBe(false);
  });

  it('auditor has read access to evidence and audit', () => {
    const auditorCaps = CAPABILITY_MAP.auditor;
    expect(auditorCaps.some(c => c === 'auditor.read_closed_run_evidence')).toBe(true);
    expect(auditorCaps.some(c => c === 'auditor.verify_manifest')).toBe(true);
    expect(auditorCaps.some(c => c === 'auditor.read_audit_log')).toBe(true);
  });

  it('orchestrator has broad read access', () => {
    const orchCaps = CAPABILITY_MAP.orchestrator;
    expect(orchCaps.some(c => c === 'orchestrator.read_all')).toBe(true);
  });

  it('firewall can release observations and filter evidence', () => {
    const fwCaps = CAPABILITY_MAP['observation-firewall'];
    expect(fwCaps.some(c => c === 'firewall.release_observation')).toBe(true);
    expect(fwCaps.some(c => c === 'firewall.filter_evidence')).toBe(true);
  });

  it('audit service can append events and sign manifests', () => {
    const auditCaps = CAPABILITY_MAP['audit-service'];
    expect(auditCaps.some(c => c === 'audit.append_event')).toBe(true);
    expect(auditCaps.some(c => c === 'audit.build_manifest')).toBe(true);
    expect(auditCaps.some(c => c === 'audit.sign_manifest')).toBe(true);
  });
});

describe('Capability Schema Validation', () => {
  it('validates capability objects', () => {
    const valid = { capability: 'red.submit_payload', resource: 'payload', action: 'create' };
    expect(CapabilitySchema.safeParse(valid).success).toBe(true);
  });

  it('rejects incomplete capability', () => {
    const invalid = { capability: 'red.submit_payload' };
    expect(CapabilitySchema.safeParse(invalid).success).toBe(false);
  });
});