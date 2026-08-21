import { describe, it, expect } from 'vitest';
import { sanitizeStartError, toSanitizedCause } from '../sanitizeStartError';

describe('sanitizeStartError', () => {
  it('preserves a technical engine-start leaf message (worklet failure)', () => {
    const leaf = new Error("Unable to load a worklet's module.");
    const out = sanitizeStartError(leaf);
    expect(out).not.toBeNull();
    expect(out!.name).toBe('Error');
    expect(out!.message).toBe("Unable to load a worklet's module.");
  });

  it('keeps DOMException-style name/message (NotAllowedError)', () => {
    const out = sanitizeStartError({ name: 'NotAllowedError', message: 'Permission denied' });
    expect(out).toEqual({ name: 'NotAllowedError', message: 'Permission denied', frames: [] });
  });

  it('scrubs an email from the message', () => {
    const out = sanitizeStartError(new Error('failed for akin.oyedele@gmail.com'));
    expect(out!.message).toBe('failed for [email]');
    expect(out!.message).not.toContain('@gmail');
  });

  it('scrubs a bearer token from the message', () => {
    const out = sanitizeStartError(new Error('auth failed Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'));
    expect(out!.message).toContain('Bearer [redacted]');
    expect(out!.message).not.toContain('eyJhbGci');
  });

  it('scrubs URL query strings (may carry tokens/ids)', () => {
    const out = sanitizeStartError(new Error('GET https://x.supabase.co/functions/v1/check-usage-limit?apikey=SECRETVALUE123 failed'));
    expect(out!.message).toContain('check-usage-limit?[redacted]');
    expect(out!.message).not.toContain('SECRETVALUE123');
  });

  it('scrubs long opaque token/base64-ish blobs', () => {
    // NOTE: deliberately NOT a real-provider key shape (no sk_/pk_/ghp_ prefixes) so this fixture never
    // trips secret scanning — it only needs to be a 24+ char opaque blob to exercise the TOKEN_BLOB rule.
    const token = 'OpaqueBlob0123456789abcdefGHIJKLmnop';
    const out = sanitizeStartError(new Error(`token ${token} rejected`));
    expect(out!.message).toContain('[redacted]');
    expect(out!.message).not.toContain(token);
  });

  it('scrubs and caps stack frames to the top few', () => {
    const e = new Error('boom');
    e.stack = [
      'Error: boom',
      '  at f1 (https://app/main.js:1:2?token=SECRETTOKENVALUE1234567890)',
      '  at f2 (https://app/main.js:3:4)',
      '  at f3 (https://app/main.js:5:6)',
      '  at f4 (https://app/main.js:7:8)',
      '  at f5 (https://app/main.js:9:10)',
      '  at f6 (https://app/main.js:11:12)',
      '  at f7 (https://app/main.js:13:14)',
    ].join('\n');
    const out = sanitizeStartError(e);
    expect(out!.frames.length).toBeLessThanOrEqual(5);
    expect(out!.frames.join(' ')).not.toContain('SECRETTOKENVALUE');
    // top frame is preserved (line 0 "Error: boom" is dropped)
    expect(out!.frames[0]).toContain('f1');
  });

  it('caps an overlong message to 300 chars', () => {
    const out = sanitizeStartError(new Error('x'.repeat(5000)));
    expect(out!.message.length).toBeLessThanOrEqual(300);
  });

  it('handles string, null, and undefined inputs', () => {
    expect(sanitizeStartError('plain error')).toEqual({ name: 'Error', message: 'plain error', frames: [] });
    expect(sanitizeStartError(null)).toBeNull();
    expect(sanitizeStartError(undefined)).toBeNull();
  });
});

describe('toSanitizedCause — the ONLY thing attached as wrapper.cause (privacy boundary)', () => {
  it('produces a REDACTED clone (Error), never the raw leaf object', () => {
    const raw = new Error("Unable to load a worklet's module.");
    const cause = toSanitizedCause(raw);
    expect(cause).toBeInstanceOf(Error);
    expect(cause).not.toBe(raw); // must be a clone, not the raw reference
  });

  it('strips email/token/query from BOTH the cause message and stack (AC #4)', () => {
    // A "dirty" leaf that carries PII/secret-shaped material in message AND stack.
    const raw = new Error('start failed for akin.oyedele@gmail.com using ?apikey=SECRETVALUE123');
    raw.stack = [
      'Error: start failed for akin.oyedele@gmail.com',
      '  at fetchToken (https://app/main.js:1:2?token=OpaqueStackTokenValue0123456789)',
      '  at start (https://app/main.js:3:4)',
    ].join('\n');

    const cause = toSanitizedCause(raw)!;
    const serialized = `${cause.name}\n${cause.message}\n${cause.stack ?? ''}`;

    // The raw sensitive material must NOT survive into the cause (what Sentry serializes).
    expect(serialized).not.toContain('akin.oyedele@gmail.com');
    expect(serialized).not.toContain('SECRETVALUE123');
    expect(serialized).not.toContain('OpaqueStackTokenValue0123456789');
    expect(serialized).toContain('[email]');
    expect(serialized).toContain('?[redacted]');
  });

  it('still preserves the useful technical leaf (worklet module load failure)', () => {
    const cause = toSanitizedCause(new Error("Unable to load a worklet's module."))!;
    expect(cause.message).toBe("Unable to load a worklet's module.");
  });

  it('returns null when there is nothing to report', () => {
    expect(toSanitizedCause(null)).toBeNull();
    expect(toSanitizedCause(undefined)).toBeNull();
  });

  it('wrapper contract: generic wrapper message + sanitized cause (mirrors SpeechRuntimeController)', () => {
    const rawLeaf = new Error('boom for user@example.com');
    const wrapper = new Error('TRANSCRIPTION_START_DID_NOT_RECORD:FAILED');
    const safeCause = toSanitizedCause(rawLeaf);
    if (safeCause) (wrapper as Error & { cause?: unknown }).cause = safeCause;

    // Wrapper still captures with its own generic message.
    expect(wrapper.message).toBe('TRANSCRIPTION_START_DID_NOT_RECORD:FAILED');
    // The attached cause is the sanitized clone — NOT the raw leaf.
    expect((wrapper as Error & { cause?: unknown }).cause).toBe(safeCause);
    expect((wrapper as Error & { cause?: unknown }).cause).not.toBe(rawLeaf);
    expect((safeCause as Error).message).not.toContain('user@example.com');
  });
});
