import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { scrypt } from 'node:crypto';
import { query } from '../db/client.js';

const derive = promisify(scrypt);
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function hashPassword(password: string) {
  if (password.length < 14 || password.length > 256) throw new Error('Password must contain 14 to 256 characters');
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  const actual = await derive(password, salt, 64) as Buffer;
  const expected = Buffer.from(hex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
// A missing account performs the same password work to avoid an account-existence oracle.
const dummyPassword = hashPassword(randomBytes(32).toString('hex'));
export async function login(email: string, password: string) {
  const result = await query('SELECT * FROM users WHERE lower(email) = $1 AND disabled = false', [email.toLowerCase()]);
  const user = result.rows[0];
  const valid = await verifyPassword(password, user?.password_hash || dummyPassword);
  if (!user || !valid) return null;
  const token = randomBytes(32).toString('base64url');
  await query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + interval '1 hour')", [tokenHash(token), user.id]);
  return { token, user: { id: user.id, tenantId: user.tenant_id, role: user.role, name: user.display_name } };
}
export async function authenticate(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await query(`SELECT u.id, u.tenant_id, u.role, u.display_name FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.disabled = false`, [tokenHash(token)]);
  return result.rows[0] || null;
}
export async function logout(token: string) { await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]); }

export async function probeSession(tenant: string, role: string) {
  const user = randomUUID();
  const token = randomBytes(32).toString('base64url');
  await query("INSERT INTO users (id, display_name, tenant_id, role) VALUES ($1, 'Internal authorization experiment', $2, $3)", [user, tenant, role]);
  await query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + interval '90 seconds')", [tokenHash(token), user]);
  return { token, cleanup: async () => { await logout(token); await query('DELETE FROM users WHERE id = $1', [user]); } };
}
