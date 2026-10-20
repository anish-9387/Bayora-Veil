import { query, closePool } from './client.js';
import { schema, seedData } from './schema.js';

async function migrate() {
  console.log('Starting database migration...');

  try {
    await query(schema);
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