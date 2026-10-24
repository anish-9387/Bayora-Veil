import { expect, it } from 'vitest';
import { hash } from '@bayora/crypto-utils';
import { schema } from '../src/db/schema.js';

it('fits SHA-256 digests in every hash column, including existing tables', () => {
  const columns = ['commitment_hash', 'evidence_digest', 'digest', 'payload_digest',
    'previous_event_hash', 'event_hash', 'merkle_root', 'final_chain_hash'];
  for (const column of columns) {
    const width = Number(schema.match(new RegExp(`\\b${column} VARCHAR\\((\\d+)\\)`))?.[1]);
    expect(width).toBeGreaterThanOrEqual(hash('demo').length);
    expect(schema).toContain(`ALTER COLUMN ${column} TYPE VARCHAR(${width})`);
  }
});
