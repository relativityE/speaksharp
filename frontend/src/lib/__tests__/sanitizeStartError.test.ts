import { describe, it, expect } from 'vitest';
import { sanitizeStartError } from '../sanitizeStartError';

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
    const out = sanitizeStartError(new Error('GET https://x.supabase.co/functions/v1/assemblyai-token?apikey=SECRETVALUE123 failed'));
    expect(out!.message).toContain('assemblyai-token?[redacted]');
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

describe('engine-start wrapper/cause contract', () => {
  it('wrapper preserves its own message AND carries the leaf as cause; sanitize extracts the leaf with no PII', () => {
    // Mirrors SpeechRuntimeController: wrapper with the leaf attached as `cause`.
    const leaf = new Error("Unable to load a worklet's module.");
    const wrapper = new Error('TRANSCRIPTION_START_DID_NOT_RECORD:FAILED');
    (wrapper as Error & { cause?: unknown }).cause = leaf;

    // AC: the wrapper itself still captures (unchanged message/identity).
    expect(wrapper.message).toBe('TRANSCRIPTION_START_DID_NOT_RECORD:FAILED');
    // AC: the cause contains the leaf.
    expect((wrapper as Error & { cause?: unknown }).cause).toBe(leaf);

    // Mirrors useSessionLifecycle: sanitized context extracted from the cause.
    const sanitized = sanitizeStartError((wrapper as Error & { cause?: unknown }).cause);
    expect(sanitized!.message).toBe("Unable to load a worklet's module.");

    // AC #4: no transcript/audio/token/email/PII in the sanitized payload.
    const blob = JSON.stringify(sanitized);
    expect(blob).not.toMatch(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/); // no email
    expect(blob).not.toMatch(/Bearer\s+\S+/i);                  // no bearer token
  });
});
