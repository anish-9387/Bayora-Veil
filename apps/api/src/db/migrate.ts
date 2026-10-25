import { query, closePool } from './client.js';
import { schema, seedData } from './schema.js';

async function migrate() {
  console.log('Starting database migration...');

  try {
    await query(schema);
    if (process.env.NODE_ENV === 'production') await query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metadata_no_raw_content') THEN
        ALTER TABLE evidence_artifacts ADD CONSTRAINT metadata_no_raw_content CHECK (content IS NULL);
      END IF; END $$`);
    console.log('Schema created successfully');

    await query(seedData);
    console.log('Seed data inserted successfully');

    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await closePool();
  }
}

migrate().catch(() => process.exit(1));
