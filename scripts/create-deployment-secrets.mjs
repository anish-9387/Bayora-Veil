import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { generateKeyPair } from '../packages/crypto-utils/dist/index.js';

mkdirSync('.bayora', { recursive: true });
const signing = resolve('.bayora/signing-key.json');
writeFileSync(signing, JSON.stringify(generateKeyPair()), { flag: 'wx', mode: 0o600 });
const keys = ['API_DB_PASSWORD', 'RED_DB_PASSWORD', 'BLUE_DB_PASSWORD', 'AUDIT_DB_PASSWORD', 'REPLAY_DB_PASSWORD', 'RED_CELL_TOKEN', 'BLUE_CELL_TOKEN', 'AUDIT_CELL_TOKEN', 'REPLAY_CELL_TOKEN', 'TARGET_TOKEN', 'TARGET_REPLAY_TOKEN', 'RED_REPLAY_TOKEN', 'AUDIT_REPLAY_TOKEN'];
const env = keys.map(key => `${key}=${randomBytes(32).toString('hex')}`).join('\n');
writeFileSync('.bayora/deployment.env', env + `\nCORS_ORIGIN=https://your-frontend.example\nSIGNING_KEY_FILE=${signing.replaceAll('\\', '/')}\n`, { flag: 'wx', mode: 0o600 });
console.log('Created private .bayora/signing-key.json and .bayora/deployment.env. Back up the signing key securely. Existing files are never overwritten.');
