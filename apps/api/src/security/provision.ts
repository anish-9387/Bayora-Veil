import { randomUUID } from 'node:crypto';
import { query, closePool } from '../db/client.js';
import { hashPassword } from './accounts.js';

async function main() {
  const [tenant, email, role, name] = process.argv.slice(2);
  if (!tenant || !email || !['orchestrator', 'red', 'blue', 'auditor'].includes(role))
    throw new Error('Usage: provision <tenant-uuid> <email> <orchestrator|red|blue|auditor> <name>; set ACCOUNT_PASSWORD securely in the process environment');
  if (!/^[0-9a-f-]{36}$/i.test(tenant) || !email.includes('@')) throw new Error('Invalid tenant UUID or email');
  const passwordHash = hashPassword(process.env.ACCOUNT_PASSWORD || '');
  await query('INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tenant, tenant]);
  await query(`INSERT INTO users (id, display_name, email, password_hash, role, tenant_id)
    VALUES ($1, $2, $3, $4, $5, $6)`, [randomUUID(), name || email, email.toLowerCase(), passwordHash, role, tenant]);
  console.log('Account created. Roles and tenant membership are managed server-side.');
}
main().catch(() => { console.error('Account creation failed; check arguments, unique email, and database connectivity.'); process.exitCode = 1; }).finally(closePool);
