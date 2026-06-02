import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

vi.unmock('../nativeTranscriptFormatter');

// Mock the supabase client so no network is hit.
const invokeMock = vi.fn();
vi.mock('../../../../lib/supabaseClient', () => ({
  getSupabaseClient: () => ({ functions: { invoke: invokeMock } }),
}));

import {
  createGeminiNativeFormatter,
  registerNativeProductionFormatter,
  assertNotPrivateMode,
  NATIVE_FORMATTER_INSTRUCTION,
  FORMAT_TRANSCRIPT_EDGE_FUNCTION,
} from '../nativeGeminiFormatter';
import {
  registerNativeTranscriptFormatter,
  hasNativeTranscriptFormatter,
  formatNativeTranscript,
} from '../nativeTranscriptFormatter';

beforeEach(() => invokeMock.mockReset());
afterEach(() => registerNativeTranscriptFormatter(null));

describe('nativeGeminiFormatter — Private guard', () => {
  it('assertNotPrivateMode throws for private', () => {
    expect(() => assertNotPrivateMode('private')).toThrow(/Private/i);
  });

  it('assertNotPrivateMode allows native/cloud/native-browser/undefined', () => {
    expect(() => assertNotPrivateMode('native')).not.toThrow();
    expect(() => assertNotPrivateMode('cloud')).not.toThrow();
    expect(() => assertNotPrivateMode(undefined)).not.toThrow();
  });

  it('registerNativeProductionFormatter REFUSES to register for Private mode', () => {
    expect(() => registerNativeProductionFormatter('private')).toThrow(/Private/i);
    expect(hasNativeTranscriptFormatter()).toBe(false); // nothing registered
  });

  it('registers for Native mode, skips non-Native (no Private leakage path)', () => {
    expect(registerNativeProductionFormatter('cloud')).toBeNull();
    expect(hasNativeTranscriptFormatter()).toBe(false);

    registerNativeProductionFormatter('native');
    expect(hasNativeTranscriptFormatter()).toBe(true);
  });
});

describe('nativeGeminiFormatter — adapter behavior', () => {
  it('calls the format-transcript edge fn with transcript + instruction', async () => {
    invokeMock.mockResolvedValue({ data: { formatted: 'Hello, world.' }, error: null });
    const fmt = createGeminiNativeFormatter();
    const out = await fmt('hello world');
    expect(out).toBe('Hello, world.');
    expect(invokeMock).toHaveBeenCalledWith(FORMAT_TRANSCRIPT_EDGE_FUNCTION, {
      body: { transcript: 'hello world', instruction: NATIVE_FORMATTER_INSTRUCTION },
    });
  });

  it('returns raw on empty input without calling the edge fn', async () => {
    const fmt = createGeminiNativeFormatter();
    expect(await fmt('   ')).toBe('   ');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('throws on invoke error so the seam falls back to raw', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('edge fn 500') });
    const fmt = createGeminiNativeFormatter();
    await expect(fmt('hello world')).rejects.toThrow('edge fn 500');
  });

  it('returns raw when the edge fn returns no formatted text', async () => {
    invokeMock.mockResolvedValue({ data: { formatted: '' }, error: null });
    const fmt = createGeminiNativeFormatter();
    expect(await fmt('keep me')).toBe('keep me');
  });

  it('end-to-end through the seam: edge fn word-change is REJECTED by the guard', async () => {
    // Edge fn "helpfully" drops the filler "um" -> guard must keep raw.
    invokeMock.mockResolvedValue({ data: { formatted: 'Basically the puppy chewed the shoes.' }, error: null });
    registerNativeProductionFormatter('native');
    const raw = 'um basically the puppy chewed the shoes';
    expect(await formatNativeTranscript(raw)).toBe(raw);
  });

  it('end-to-end through the seam: punctuation/casing restoration is ACCEPTED', async () => {
    invokeMock.mockResolvedValue({
      data: { formatted: 'Um, basically the puppy chewed the shoes.' },
      error: null,
    });
    registerNativeProductionFormatter('native');
    const raw = 'um basically the puppy chewed the shoes';
    expect(await formatNativeTranscript(raw)).toBe('Um, basically the puppy chewed the shoes.');
  });
});
