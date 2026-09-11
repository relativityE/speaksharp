#!/usr/bin/env node
/**
 * #1432 — create one short-lived Production model-comparison authorization.
 *
 * The private Ed25519 key is read from an operator-owned file outside the repository. The generated
 * envelope contains no secret and is valid only for the exact Production origin/release and a bounded
 * time window. This tool never changes Vercel, deploys, opens the comparison surface, or selects a model.
 */
import { createPrivateKey, createPublicKey, randomBytes, sign } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL_COMPARISON_AUTH_VERSION = 'speaksharp.model-comparison-authorization.v1';
export const MODEL_COMPARISON_PRODUCTION_ORIGIN = 'https://speaksharp-public.vercel.app';
export const MODEL_COMPARISON_MAX_TTL_SECONDS = 300;

const SHA40 = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function payloadBytes(payload) {
  return Buffer.from(JSON.stringify({
    version: payload.version,
    releaseSha: payload.releaseSha,
    origin: payload.origin,
    nonce: payload.nonce,
    candidateId: payload.candidateId,
    journey: payload.journey,
    evidenceDocumentId: payload.evidenceDocumentId,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  }));
}

export function createModelComparisonAuthorization({
  releaseSha,
  origin = MODEL_COMPARISON_PRODUCTION_ORIGIN,
  ttlSeconds = 120,
  privateKey,
  now = Date.now(),
  nonce = randomBytes(24).toString('base64url'),
  candidateId,
  journey,
  evidenceDocumentId,
}) {
  if (!SHA40.test(releaseSha ?? '')) throw new Error('release must be a full lowercase git SHA');
  if (origin !== MODEL_COMPARISON_PRODUCTION_ORIGIN) {
    throw new Error(`origin must be ${MODEL_COMPARISON_PRODUCTION_ORIGIN}`);
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MODEL_COMPARISON_MAX_TTL_SECONDS) {
    throw new Error(`ttl-seconds must be an integer from 1 to ${MODEL_COMPARISON_MAX_TTL_SECONDS}`);
  }
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(nonce)) throw new Error('nonce is invalid');
  if (!['v2:base.en', 'v4:distil:q4', 'moonshine:streaming-medium'].includes(candidateId)) {
    throw new Error('candidate must be one of the three comparison candidates');
  }
  if (!['open_mic', 'focus_points'].includes(journey)) throw new Error('journey must be open_mic or focus_points');
  if (!UUID_V4.test(evidenceDocumentId ?? '')) throw new Error('evidence-document must be a lowercase UUIDv4');
  const key = privateKey?.type === 'private' && typeof privateKey.export === 'function'
    ? privateKey
    : createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('private key must be Ed25519');
  const payload = {
    version: MODEL_COMPARISON_AUTH_VERSION,
    releaseSha,
    origin,
    nonce,
    candidateId,
    journey,
    evidenceDocumentId,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1_000).toISOString(),
  };
  return { payload, signature: sign(null, payloadBytes(payload), key).toString('base64') };
}

export function modelComparisonPublicKey(privateKey) {
  const key = privateKey?.type === 'private' && typeof privateKey.export === 'function'
    ? privateKey
    : createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('private key must be Ed25519');
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
  return spki.subarray(-32).toString('base64');
}

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
};

function main() {
  const releaseSha = arg('release');
  const keyPath = arg('private-key');
  const outPath = arg('out');
  const candidateId = arg('candidate');
  const journey = arg('journey');
  const evidenceDocumentId = arg('evidence-document');
  const ttlRaw = arg('ttl-seconds') ?? '120';
  const showPublicKey = process.argv.includes('--show-public-key');
  if (!keyPath || (!showPublicKey && (!releaseSha || !outPath || !candidateId || !journey || !evidenceDocumentId))) {
    throw new Error('required: --release <sha> --candidate <id> --journey <open_mic|focus_points> --evidence-document <uuidv4> --private-key </absolute/operator/key.pem> --out <envelope.json> [--ttl-seconds 120]');
  }
  if (!isAbsolute(keyPath)) throw new Error('private-key path must be absolute and outside the repository');
  const repositoryRoot = resolve(process.cwd());
  const resolvedKey = resolve(keyPath);
  if (resolvedKey === repositoryRoot || resolvedKey.startsWith(`${repositoryRoot}/`)) {
    throw new Error('private key must remain outside the repository');
  }
  const privateKey = readFileSync(resolvedKey);
  if (showPublicKey) {
    console.log(modelComparisonPublicKey(privateKey));
    return;
  }
  if (existsSync(outPath)) throw new Error('refusing to overwrite an existing authorization envelope');
  const authorization = createModelComparisonAuthorization({
    releaseSha,
    ttlSeconds: Number(ttlRaw),
    privateKey,
    candidateId,
    journey,
    evidenceDocumentId,
  });
  writeFileSync(outPath, `${JSON.stringify(authorization, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`wrote short-lived authorization for ${authorization.payload.releaseSha}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(`HOLD: ${error instanceof Error ? error.message : 'authorization could not be created'}`);
    process.exit(1);
  }
}
