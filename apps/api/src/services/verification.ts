import { hash, canonicalizeEvent } from '@bayora/crypto-utils';
const GENESIS_HASH = 'sha256:' + '0'.repeat(64);
type AuditRecord = { canonicalPayload?: string; runId: string; sequence: number; eventType: string; timestamp: string | Date; actor: string; payloadDigest: string; previousEventHash: string; eventHash: string; createdAt: string | Date };

export function verifyEventCopy(runId: string, events: AuditRecord[]) {
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = [];
  const tamperedEvents: Array<{ sequence: number; expectedHash: string; actualHash: string }> = [];

  let previousHash = GENESIS_HASH;
  let allValid = events.length > 0 && events.every(event => event.runId === runId);
  checks.push({ name: 'Run identity and nonempty events', passed: allValid });

  for (const event of events) {
    if (event.canonicalPayload !== undefined) {
      const validPayload = hash(event.canonicalPayload) === event.payloadDigest;
      checks.push({ name: `Event ${event.sequence} canonical metadata`, passed: validPayload });
      if (!validPayload) allValid = false;
    }
    const eventData = {
      run_id: event.runId,
      sequence: event.sequence,
      event_type: event.eventType,
      timestamp: event.timestamp,
      actor: event.actor,
      payload_digest: event.payloadDigest,
      previous_event_hash: event.previousEventHash,
      event_hash: '',
      created_at: event.createdAt
    };

    const canonicalEvent = canonicalizeEvent(eventData);
    const expectedHash = hash(canonicalEvent + previousHash);

    const hashMatches = expectedHash === event.eventHash;
    const chainMatches = event.previousEventHash === previousHash;

    checks.push({
      name: `Event ${event.sequence} hash`,
      passed: hashMatches,
      detail: hashMatches ? undefined : `Expected ${expectedHash}, got ${event.eventHash}`
    });

    checks.push({
      name: `Event ${event.sequence} chain`,
      passed: chainMatches,
      detail: chainMatches ? undefined : `Expected previous ${previousHash}, got ${event.previousEventHash}`
    });

    if (!hashMatches || !chainMatches) {
      allValid = false;
      tamperedEvents.push({
        sequence: event.sequence,
        expectedHash,
        actualHash: event.eventHash
      });
    }

    previousHash = event.eventHash;
  }

  checks.push({
    name: 'Sequence continuity',
    passed: events.every((e, i) => e.sequence === i + 1),
    detail: events.some((e, i) => e.sequence !== i + 1) ? 'Sequence gap detected' : undefined
  });

  if (events.some((e, i) => e.sequence !== i + 1)) {
    allValid = false;
  }

  return {
    valid: allValid,
    runId,
    checks,
    tamperedEvents: tamperedEvents.length > 0 ? tamperedEvents : undefined
  };
}

