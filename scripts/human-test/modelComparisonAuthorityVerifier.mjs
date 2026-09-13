/**
 * #1432 workstream 3 (PM decision E, Codex P1 3985013874) — comparison authority verified OUTSIDE the page.
 *
 * The browser's own Ed25519 check runs in a realm the page controls: page code or DevTools can replace
 * `SubtleCrypto.prototype.verify`, forge an envelope, or call the switch executor directly. That check is
 * therefore defense-in-depth and UX gating only. Qualification authority lives here, in trusted Node:
 *
 *   - the observer verifies the exact signed envelope against a PINNED public key before it arms a page,
 *     and records a content-free authorization record in its hash-bound receipt;
 *   - the terminal validator re-verifies that same record independently, so a receipt that merely
 *     claims "verified" is never evidence.
 *
 * Nothing here is secret: the envelope and public key are both non-secret by construction.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';

export const MODEL_COMPARISON_AUTH_VERSION = 'speaksharp.model-comparison-authorization.v1';
export const MODEL_COMPARISON_MAX_TTL_MS = 300_000;
export const MODEL_COMPARISON_CLOCK_SKEW_MS = 30_000;
const CANDIDATES = new Set(['v2:base.en', 'v4:distil:q4', 'moonshine:streaming-medium']);
const JOURNEYS = new Set(['open_mic', 'focus_points']);
const SHA40 = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NONCE = /^[A-Za-z0-9._:-]{16,128}$/;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** DER SubjectPublicKeyInfo prefix for a raw 32-byte Ed25519 key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** The exact signed bytes: field order is pinned, shared with the signer and the browser. */
export function authorizationPayloadBytes(payload) {
  return Buffer.from(JSON.stringify({
    version: payload?.version,
    releaseSha: payload?.releaseSha,
    origin: payload?.origin,
    nonce: payload?.nonce,
    candidateId: payload?.candidateId,
    journey: payload?.journey,
    evidenceDocumentId: payload?.evidenceDocumentId,
    issuedAt: payload?.issuedAt,
    expiresAt: payload?.expiresAt,
  }));
}

/** Canonical digest of one envelope. Two rows can never share it, so it is the one-use key. */
export function authorizationEnvelopeSha256(envelope) {
  return sha256(Buffer.concat([
    authorizationPayloadBytes(envelope?.payload),
    Buffer.from('\n'),
    Buffer.from(String(envelope?.signature ?? '')),
  ]));
}

/** Parse a pinned raw base64 Ed25519 public key (the same value the build embeds). */
export function parsePinnedPublicKey(rawBase64) {
  const text = typeof rawBase64 === 'string' ? rawBase64.trim() : '';
  const raw = Buffer.from(text, 'base64');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(text) || raw.length !== 32) {
    throw new Error('verification key must be a raw base64 Ed25519 public key');
  }
  return {
    key: createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' }),
    fingerprint: sha256(raw),
  };
}

/**
 * Verify one envelope for one intended take. Returns `{ ok, problems, record }`; `record` is written to
 * the observer receipt only when `ok`, and is re-checked by `validateAuthorizationRecord`.
 */
export function verifyModelComparisonAuthorization({ envelope, publicKey, expected, now = Date.now() }) {
  const problems = [];
  let pinned;
  try { pinned = parsePinnedPublicKey(publicKey); } catch (error) {
    return { ok: false, problems: [error.message], record: null };
  }
  const payload = envelope?.payload;
  const signature = envelope?.signature;
  if (!payload || typeof payload !== 'object' || typeof signature !== 'string') {
    return { ok: false, problems: ['authorization envelope must contain payload and signature'], record: null };
  }
  let signatureValid = false;
  try {
    signatureValid = verify(null, authorizationPayloadBytes(payload), pinned.key, Buffer.from(signature, 'base64'));
  } catch { signatureValid = false; }
  if (!signatureValid) problems.push('authorization signature does not verify against the pinned key');

  if (payload.version !== MODEL_COMPARISON_AUTH_VERSION) problems.push('authorization version is invalid');
  if (!SHA40.test(payload.releaseSha ?? '')) problems.push('authorization releaseSha is invalid');
  if (!NONCE.test(payload.nonce ?? '')) problems.push('authorization nonce is invalid');
  if (!CANDIDATES.has(payload.candidateId)) problems.push('authorization candidate is not in the comparison slate');
  if (!JOURNEYS.has(payload.journey)) problems.push('authorization journey is invalid');
  if (!UUID_V4.test(payload.evidenceDocumentId ?? '')) problems.push('authorization evidenceDocumentId is invalid');
  for (const [field, value] of Object.entries(expected ?? {})) {
    if (payload[field] !== value) problems.push(`authorization ${field} must be ${JSON.stringify(value)}`);
  }
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt
    || expiresAt - issuedAt > MODEL_COMPARISON_MAX_TTL_MS) {
    problems.push('authorization validity window is invalid');
  } else {
    if (issuedAt > now + MODEL_COMPARISON_CLOCK_SKEW_MS) problems.push('authorization is not yet valid');
    if (expiresAt < now) problems.push('authorization expired before verification');
  }
  const ok = problems.length === 0;
  return {
    ok,
    problems,
    record: ok ? {
      envelope: { payload: { ...JSON.parse(authorizationPayloadBytes(payload).toString('utf8')) }, signature },
      envelopeSha256: authorizationEnvelopeSha256(envelope),
      verificationKeyFingerprint: pinned.fingerprint,
      verifiedAt: new Date(now).toISOString(),
      expiredAtVerification: false,
      verified: {
        candidateId: payload.candidateId,
        journey: payload.journey,
        releaseSha: payload.releaseSha,
        origin: payload.origin,
        evidenceDocumentId: payload.evidenceDocumentId,
        comparisonNonce: payload.nonce,
      },
    } : null,
  };
}

const RECORD_KEYS = ['envelope', 'envelopeSha256', 'verificationKeyFingerprint', 'verifiedAt', 'expiredAtVerification', 'verified'];

/**
 * Independently re-validate a receipt's authorization record for one packet row. The recorded
 * "verified" block is compared to the re-verified envelope, never trusted on its own.
 */
export function validateAuthorizationRecord(record, { publicKey, row, releaseSha, origin, evidenceDocumentId }) {
  const problems = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return ['observer receipt has no authorization record (activation was not verified outside the page)'];
  }
  for (const key of RECORD_KEYS) if (!Object.hasOwn(record, key)) problems.push(`authorization.${key} is missing`);
  for (const key of Object.keys(record)) if (!RECORD_KEYS.includes(key)) problems.push(`authorization.${key} is not allowed`);
  if (typeof publicKey !== 'string') {
    problems.push('no pinned verification key was supplied to the validator');
    return problems;
  }
  let pinned;
  try { pinned = parsePinnedPublicKey(publicKey); } catch (error) { return [...problems, error.message]; }
  if (record.verificationKeyFingerprint !== pinned.fingerprint) {
    problems.push('authorization verificationKeyFingerprint is not the pinned key');
  }
  if (record.envelopeSha256 !== authorizationEnvelopeSha256(record.envelope)) {
    problems.push('authorization envelopeSha256 does not match the recorded envelope');
  }
  const verifiedAt = Date.parse(record.verifiedAt);
  const reverified = verifyModelComparisonAuthorization({
    envelope: record.envelope,
    publicKey,
    now: Number.isFinite(verifiedAt) ? verifiedAt : Number.NaN,
    expected: {
      candidateId: row?.candidateId,
      journey: row?.journey,
      releaseSha,
      origin,
      evidenceDocumentId,
      nonce: row?.comparisonNonce,
    },
  });
  if (!Number.isFinite(verifiedAt) || new Date(verifiedAt).toISOString() !== record.verifiedAt) {
    problems.push('authorization verifiedAt must be an ISO instant');
  }
  problems.push(...reverified.problems);
  if (record.expiredAtVerification !== false) problems.push('authorization expiredAtVerification must be false');
  const expectedVerified = {
    candidateId: row?.candidateId, journey: row?.journey, releaseSha, origin, evidenceDocumentId,
    comparisonNonce: row?.comparisonNonce,
  };
  if (JSON.stringify(record.verified) !== JSON.stringify(expectedVerified)) {
    problems.push('authorization verified block does not match the signed envelope and packet row');
  }
  return problems;
}
