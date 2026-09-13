import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  authorizationEnvelopeSha256, parsePinnedPublicKey, verifyModelComparisonAuthorization,
} from '../../scripts/human-test/modelComparisonAuthorityVerifier.mjs';
import {
  createModelComparisonAuthorization, modelComparisonPublicKey,
} from '../../scripts/human-test/sign-model-comparison-authorization.mjs';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const key = generateKeyPairSync('ed25519').privateKey;
const pinned = modelComparisonPublicKey(key);
const expected = {
  candidateId: 'v4:distil:q4', journey: 'focus_points', releaseSha: 'a'.repeat(40),
  origin: 'https://speaksharp-public.vercel.app',
};
const envelope = (overrides = {}) => createModelComparisonAuthorization({
  releaseSha: 'a'.repeat(40), privateKey: key, now: NOW - 5_000, ttlSeconds: 120,
  nonce: 'take-nonce-1234567890', candidateId: 'v4:distil:q4', journey: 'focus_points',
  evidenceDocumentId: '11111111-1111-4111-8111-111111111111', ...overrides,
});

describe('#1432 PM decision E — trusted Node verification of comparison authority', () => {
  it('CONTROL: a genuine envelope for the intended take verifies and yields a content-free record', () => {
    const value = envelope();
    const result = verifyModelComparisonAuthorization({ envelope: value, publicKey: pinned, expected, now: NOW });
    expect(result).toMatchObject({ ok: true, problems: [] });
    expect(result.record).toMatchObject({
      envelopeSha256: authorizationEnvelopeSha256(value),
      verificationKeyFingerprint: parsePinnedPublicKey(pinned).fingerprint,
      verifiedAt: '2026-09-13T12:00:00.000Z',
      expiredAtVerification: false,
      verified: { ...expected, evidenceDocumentId: '11111111-1111-4111-8111-111111111111', comparisonNonce: 'take-nonce-1234567890' },
    });
    expect(JSON.stringify(result.record)).not.toMatch(/PRIVATE KEY/);
  });

  it.each([
    ['a forged signature', (v) => ({ ...v, signature: Buffer.alloc(64, 1).toString('base64') }), {}, /signature does not verify/],
    ['a payload edited after signing', (v) => ({ ...v, payload: { ...v.payload, candidateId: 'v2:base.en' } }), {}, /signature does not verify/],
    ['another candidate than the intended take', (v) => v, { candidateId: 'v2:base.en' }, /candidateId must be "v2:base\.en"/],
    ['another release', (v) => v, { releaseSha: 'b'.repeat(40) }, /releaseSha must be/],
    ['another origin', (v) => v, { origin: 'https://preview.example.test' }, /origin must be/],
    ['another journey', (v) => v, { journey: 'open_mic' }, /journey must be "open_mic"/],
  ])('CASUALTY: refuses %s', (_label, mutate, expectedOverride, message) => {
    const result = verifyModelComparisonAuthorization({
      envelope: mutate(envelope()), publicKey: pinned, expected: { ...expected, ...expectedOverride }, now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.record).toBeNull();
    expect(result.problems.join('\n')).toMatch(message);
  });

  it('CASUALTY: refuses an expired or not-yet-valid authorization', () => {
    expect(verifyModelComparisonAuthorization({ envelope: envelope(), publicKey: pinned, expected, now: NOW + 10 * 60_000 }).problems)
      .toContain('authorization expired before verification');
    expect(verifyModelComparisonAuthorization({ envelope: envelope(), publicKey: pinned, expected, now: NOW - 10 * 60_000 }).problems)
      .toContain('authorization is not yet valid');
  });

  it('CASUALTY: refuses a key that is not a raw Ed25519 public key, and a different pinned key', () => {
    expect(verifyModelComparisonAuthorization({ envelope: envelope(), publicKey: 'not-a-key', expected, now: NOW }).problems)
      .toContain('verification key must be a raw base64 Ed25519 public key');
    const other = modelComparisonPublicKey(generateKeyPairSync('ed25519').privateKey);
    expect(verifyModelComparisonAuthorization({ envelope: envelope(), publicKey: other, expected, now: NOW }).ok).toBe(false);
  });

  it('the observer verifies in Node before it installs anything into the page', () => {
    const observer = readFileSync('scripts/human-test/observe-take.mjs', 'utf8');
    const verification = observer.indexOf('verifyModelComparisonAuthorization({');
    expect(verification).toBeGreaterThan(-1);
    expect(verification).toBeLessThan(observer.indexOf('modelComparisonArmExpression(signedAuthorization)'));
    expect(observer).toContain("arg('verification-key')");
    expect(observer).toContain('authorization: verifiedAuthorization.record');
  });
});
