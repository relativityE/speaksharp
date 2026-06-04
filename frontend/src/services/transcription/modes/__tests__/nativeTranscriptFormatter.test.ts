import { describe, it, expect, afterEach, vi } from 'vitest';

vi.unmock('../nativeTranscriptFormatter');

import {
  formatNativeTranscript,
  registerNativeTranscriptFormatter,
  reportNativeFormatterProviderMeta,
  getNativeFormatterTelemetry,
  hasNativeTranscriptFormatter,
  isWordPreserving,
  transcriptWordSequence,
  FORMATTER_LATENCY_BUDGET_MS,
} from '../nativeTranscriptFormatter';

afterEach(() => {
  // Always restore identity behavior between tests.
  registerNativeTranscriptFormatter(null);
});

describe('nativeTranscriptFormatter latency budget (Native quick-start)', () => {
  it('falls back to raw with FORMATTER_TIMEOUT_CLIENT when the formatter exceeds the budget', async () => {
    vi.useFakeTimers();
    registerNativeTranscriptFormatter(
      (raw) => new Promise<string>((resolve) => setTimeout(() => resolve(`${raw}.`), 20_000)),
    );
    const pending = formatNativeTranscript('hello world');
    await vi.advanceTimersByTimeAsync(FORMATTER_LATENCY_BUDGET_MS + 10);
    const result = await pending;

    expect(result).toBe('hello world'); // raw fallback, words unchanged
    const telemetry = getNativeFormatterTelemetry();
    expect(telemetry?.fallbackToRaw).toBe(true);
    expect(telemetry?.errorCode).toBe('FORMATTER_TIMEOUT_CLIENT');
    vi.useRealTimers();
  });

  it('does NOT time out a fast formatter (formats within budget)', async () => {
    registerNativeTranscriptFormatter(async (raw) => `${raw.trim()}.`);
    expect(await formatNativeTranscript('hello world')).toBe('hello world.');
    expect(getNativeFormatterTelemetry()?.fallbackToRaw).toBe(false);
  });
});

describe('nativeTranscriptFormatter', () => {
  it('is identity by default (no behavior change until a formatter is registered)', async () => {
    expect(hasNativeTranscriptFormatter()).toBe(false);
    const input = 'point. Starts Now basically i want to make one point';
    expect(await formatNativeTranscript(input)).toBe(input);
  });

  it('applies a registered formatter to the saved transcript', async () => {
    registerNativeTranscriptFormatter((raw) => raw.toUpperCase());
    expect(hasNativeTranscriptFormatter()).toBe(true);
    expect(await formatNativeTranscript('hello world')).toBe('HELLO WORLD');
  });

  it('supports async (network/model) formatters', async () => {
    registerNativeTranscriptFormatter(async (raw) => `${raw.trim()}.`);
    expect(await formatNativeTranscript('no terminal punctuation')).toBe('no terminal punctuation.');
  });

  it('falls back to the original text when the formatter throws', async () => {
    registerNativeTranscriptFormatter(() => {
      throw new Error('model offline');
    });
    expect(await formatNativeTranscript('keep me')).toBe('keep me');
  });

  it('falls back to the original text when an async formatter rejects', async () => {
    registerNativeTranscriptFormatter(async () => {
      throw new Error('network timeout');
    });
    expect(await formatNativeTranscript('still here')).toBe('still here');
  });

  it('never blanks a non-empty transcript when the formatter returns empty', async () => {
    registerNativeTranscriptFormatter(() => '   ');
    expect(await formatNativeTranscript('original words')).toBe('original words');
  });

  it('returns empty input unchanged without invoking the formatter', async () => {
    const formatter = vi.fn((raw: string) => raw.toUpperCase());
    registerNativeTranscriptFormatter(formatter);
    expect(await formatNativeTranscript('')).toBe('');
    expect(await formatNativeTranscript('   ')).toBe('   ');
    expect(formatter).not.toHaveBeenCalled();
  });

  it('registerNativeTranscriptFormatter returns the previous formatter for restoration', async () => {
    const first = (raw: string) => `${raw}!`;
    const prevNull = registerNativeTranscriptFormatter(first);
    expect(prevNull).toBeNull();
    const prevFirst = registerNativeTranscriptFormatter(null);
    expect(prevFirst).toBe(first);
  });

  // --- Word-preservation guard (saved-transcript safety contract) ---

  it('ACCEPTS punctuation + casing restoration (run-on -> sentences), same words', async () => {
    registerNativeTranscriptFormatter(
      () => 'Starts now. I want to make one point. Basically the puppy chewed the shoes.',
    );
    const raw = 'starts now i want to make one point basically the puppy chewed the shoes';
    expect(await formatNativeTranscript(raw)).toBe(
      'Starts now. I want to make one point. Basically the puppy chewed the shoes.',
    );
  });

  it('REJECTS output that drops a filler word -> returns raw', async () => {
    // "um" removed by the formatter -> word change -> guard rejects.
    registerNativeTranscriptFormatter(() => 'Basically the puppy chewed the shoes.');
    const raw = 'um basically the puppy chewed the shoes';
    expect(await formatNativeTranscript(raw)).toBe(raw);
  });

  it('REJECTS output that adds a word -> returns raw', async () => {
    registerNativeTranscriptFormatter((raw) => `${raw} extra`);
    expect(await formatNativeTranscript('keep these words')).toBe('keep these words');
  });

  it('REJECTS output that reorders / "corrects" words -> returns raw', async () => {
    registerNativeTranscriptFormatter(() => 'going to the store'); // "gonna" -> "going to"
    expect(await formatNativeTranscript('gonna the store')).toBe('gonna the store');
  });

  it('isWordPreserving: true for punctuation/casing-only, false for word edits', () => {
    expect(isWordPreserving('hello world', 'Hello, world.')).toBe(true);
    expect(isWordPreserving('um like basically', 'Um, like, basically.')).toBe(true);
    expect(isWordPreserving('um like basically', 'like basically')).toBe(false); // dropped um
    expect(isWordPreserving('one two', 'one two three')).toBe(false); // added word
    expect(isWordPreserving('a b c', 'a c b')).toBe(false); // reordered
  });

  it('transcriptWordSequence strips punctuation/case', () => {
    expect(transcriptWordSequence('Um, the Puppy—chewed it!')).toEqual(['um', 'the', 'puppy', 'chewed', 'it']);
  });

  describe('proof telemetry (__NATIVE_FORMATTER_LAST__)', () => {
    it('records an ACCEPTED attempt with provider meta + wordPreserving=true, fallbackToRaw=false', async () => {
      registerNativeTranscriptFormatter((raw) => {
        // adapter reports provider-side metadata during the call
        reportNativeFormatterProviderMeta({
          provider: 'gemini',
          functionName: 'format-transcript',
          formatterVersion: 'format-transcript@1.0.0',
          requestId: 'req-123',
          latencyMs: 42,
          inputChars: raw.length,
          outputChars: raw.length + 2,
          serverWordPreserving: true,
        });
        return `${raw}.`;
      });
      const out = await formatNativeTranscript('hello world');
      expect(out).toBe('hello world.');
      const t = getNativeFormatterTelemetry();
      expect(t.attempted).toBe(true);
      expect(t.provider).toBe('gemini');
      expect(t.functionName).toBe('format-transcript');
      expect(t.requestId).toBe('req-123');
      expect(t.serverWordPreserving).toBe(true);
      expect(t.wordPreserving).toBe(true);
      expect(t.fallbackToRaw).toBe(false);
      expect(t.latencyMs).toBe(42);
    });

    it('records a FALLBACK attempt (word change) with fallbackToRaw=true + errorCode', async () => {
      registerNativeTranscriptFormatter((raw) => `${raw} extra`);
      const out = await formatNativeTranscript('keep these words');
      expect(out).toBe('keep these words');
      const t = getNativeFormatterTelemetry();
      expect(t.attempted).toBe(true);
      expect(t.fallbackToRaw).toBe(true);
      expect(t.wordPreserving).toBe(false);
      expect(t.errorCode).toBe('CLIENT_WORDS_CHANGED');
    });

    it('publishes attempted:false / NO_FORMATTER when no formatter is registered (never silently null)', async () => {
      registerNativeTranscriptFormatter(null); // ensure unregistered
      const out = await formatNativeTranscript('hello world');
      expect(out).toBe('hello world'); // raw, unchanged
      const t = getNativeFormatterTelemetry();
      expect(t.attempted).toBe(false);
      expect(t.fallbackToRaw).toBe(true);
      expect(t.errorCode).toBe('NO_FORMATTER');
      expect(t.inputChars).toBe('hello world'.length);
    });

    it('records a FALLBACK attempt (formatter throws) carrying the thrown code', async () => {
      registerNativeTranscriptFormatter(() => {
        const e = new Error('boom') as Error & { code?: string };
        e.code = 'FORMATTER_PROVIDER_ERROR';
        throw e;
      });
      const out = await formatNativeTranscript('hello world');
      expect(out).toBe('hello world');
      const t = getNativeFormatterTelemetry();
      expect(t.attempted).toBe(true);
      expect(t.fallbackToRaw).toBe(true);
      expect(t.errorCode).toBe('FORMATTER_PROVIDER_ERROR');
    });

    it('surfaces the adapter-reported specific code + providerStatus (no collapse to generic)', async () => {
      // Mirrors the real 502: the adapter reports the specific edge-fn code +
      // Gemini status, then throws a FunctionsHttpError that has NO `.code`. The
      // specific code + providerStatus must survive to telemetry, not collapse to
      // a generic FORMATTER_ERROR (review of the 2026-06-03 Native proof).
      registerNativeTranscriptFormatter((raw) => {
        reportNativeFormatterProviderMeta({ errorCode: 'FORMATTER_PROVIDER_ERROR', providerStatus: 502 });
        if (raw) throw new Error('format-transcript returned 502'); // no .code
        return raw;
      });
      const out = await formatNativeTranscript('hello world');
      expect(out).toBe('hello world');
      const t = getNativeFormatterTelemetry();
      expect(t.errorCode).toBe('FORMATTER_PROVIDER_ERROR');
      expect(t.providerStatus).toBe(502);
      expect(t.fallbackToRaw).toBe(true);
    });
  });
});
