import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizeEvent, buildMerkleRoot, verify } from '../packages/crypto-utils/dist/index.js';
import { verifyEventCopy } from '../apps/api/dist/services/verification.js';

export function verifyBundle(bundle, publicKey) {
  if (!/^[a-f0-9]{64}$/i.test(publicKey)) throw new Error('Supply an independently preserved Ed25519 public key (64 hex characters)');
  const { manifest: m, events } = bundle;
  const chain = verifyEventCopy(m.runId, events);
  const canonical = canonicalizeEvent({ run_id: m.runId, merkle_root: m.merkleRoot, final_chain_hash: m.finalChainHash,
    signature: '', public_key_id: m.publicKeyId, event_count: Number(m.eventCount), policy_version: m.policyVersion,
    model_adapter: m.modelAdapter, created_at: m.createdAt,
    ...(m.datasetVersion ? { dataset_version: m.datasetVersion } : {}), ...(m.modelVersion ? { model_version: m.modelVersion } : {}) });
  return chain.valid && events.length === Number(m.eventCount) && buildMerkleRoot(events.map(e => e.eventHash)) === m.merkleRoot
    && events.at(-1)?.eventHash === m.finalChainHash && verify(m.signature, canonical, publicKey);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const valid = verifyBundle(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.argv[3] || '');
    console.log(valid ? 'PASS: pinned key, signature, complete chain, event count and Merkle root' : 'FAIL: evidence verification');
    process.exitCode = valid ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
