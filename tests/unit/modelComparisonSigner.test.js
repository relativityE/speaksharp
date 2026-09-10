import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  createModelComparisonAuthorization,
  MODEL_COMPARISON_AUTH_VERSION,
  MODEL_COMPARISON_PRODUCTION_ORIGIN,
  modelComparisonPublicKey,
} from '../../scripts/human-test/sign-model-comparison-authorization.mjs';

describe('#1432 model-comparison authorization signer', () => {
  const keys = () => generateKeyPairSync('ed25519');

  it('signs the exact ordered payload for one release, origin, nonce, and bounded window', () => {
    const { privateKey, publicKey } = keys();
    const authorization = createModelComparisonAuthorization({
      releaseSha: 'a'.repeat(40), privateKey, now: Date.parse('2026-09-08T12:00:00.000Z'),
      ttlSeconds: 90, nonce: 'signed-run-1234567890', candidateId: 'v4:distil:q4', journey: 'focus_points',
      evidenceDocumentId: '11111111-1111-4111-8111-111111111111',
    });
    expect(authorization.payload).toEqual({
      version: MODEL_COMPARISON_AUTH_VERSION,
      releaseSha: 'a'.repeat(40),
      origin: MODEL_COMPARISON_PRODUCTION_ORIGIN,
      nonce: 'signed-run-1234567890',
      candidateId: 'v4:distil:q4',
      journey: 'focus_points',
      evidenceDocumentId: '11111111-1111-4111-8111-111111111111',
      issuedAt: '2026-09-08T12:00:00.000Z',
      expiresAt: '2026-09-08T12:01:30.000Z',
    });
    expect(verify(
      null,
      Buffer.from(JSON.stringify(authorization.payload)),
      publicKey,
      Buffer.from(authorization.signature, 'base64'),
    )).toBe(true);
    expect(Buffer.from(modelComparisonPublicKey(privateKey), 'base64')).toHaveLength(32);
  });

  it.each([
    ['wrong origin', { origin: 'https://preview.example.test' }, /origin must be/],
    ['zero TTL', { ttlSeconds: 0 }, /ttl-seconds/],
    ['overlong TTL', { ttlSeconds: 301 }, /ttl-seconds/],
    ['wrong key type', { privateKey: generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey }, /Ed25519/],
    ['wrong candidate', { candidateId: 'v4:base:q4' }, /three comparison candidates/],
    ['wrong journey', { journey: 'dashboard' }, /journey/],
    ['invalid evidence document', { evidenceDocumentId: 'document-one' }, /evidence-document/],
  ])('fails closed on %s', (_label, override, message) => {
    const { privateKey } = keys();
    expect(() => createModelComparisonAuthorization({
      releaseSha: 'b'.repeat(40), privateKey, nonce: 'signed-run-1234567890',
      candidateId: 'v4:distil:q4', journey: 'open_mic',
      evidenceDocumentId: '11111111-1111-4111-8111-111111111111', ...override,
    })).toThrow(message);
  });
});
