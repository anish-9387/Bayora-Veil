import { query, closePool } from './client.js';
import { schema, seedData } from './schema.js';
import { hash } from '@bayora/crypto-utils';

async function seed() {
  console.log('Seeding demo data...');

  try {
    await query(schema);
    await query(seedData);

    const runId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const commitmentHash = hash('synthetic_payload_for_demo_run');
    await query(
      `INSERT INTO runs (id, status, policy_version, model_adapter, created_by, config)
       VALUES ($1, 'CREATED', 'v1.0.0', 'mock-adapter', '11111111-1111-1111-1111-111111111111', '{}')
       ON CONFLICT (id) DO NOTHING`,
      [runId]
    );

    await query(
      `INSERT INTO payload_commitments (run_id, commitment_hash, reveal_after_close)
       VALUES ($1, $2, true)
       ON CONFLICT DO NOTHING`,
      [runId, commitmentHash]
    );

    console.log('Demo data seeded successfully');
  } catch (error) {
    console.error('Seeding failed:', error);
    throw error;
  } finally {
    await closePool();
  }
}

seed().catch(() => process.exit(1));
