// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatNativeSessionInBackground,
  type NativeFormattingState,
} from '../nativeAsyncFormatter';
import {
  FORMATTER_LATENCY_BUDGET_MS,
  getNativeFormatterTelemetry,
  registerNativeTranscriptFormatter,
} from '../modes/nativeTranscriptFormatter';

afterEach(() => {
  registerNativeTranscriptFormatter(null);
  vi.useRealTimers();
  delete window.__NATIVE_FORMATTING_STATUS__;
});

describe('nativeAsyncFormatter — raw-first Native saved transcript formatting', () => {
  it('updates the saved session only after a word-preserving formatter succeeds', async () => {
    registerNativeTranscriptFormatter(async () => 'Um, basically the puppy chewed the shoes.');
    const updateSessionFn = vi.fn(async () => ({ success: true }));
    const onUpdated = vi.fn();

    const result = await formatNativeSessionInBackground({
      sessionId: 'sess-native-1',
      rawTranscript: 'um basically the puppy chewed the shoes',
      updateSessionFn,
      onUpdated,
    });

    expect(updateSessionFn).toHaveBeenCalledWith('sess-native-1', {
      transcript: 'Um, basically the puppy chewed the shoes.',
    });
    expect(onUpdated).toHaveBeenCalledWith('Um, basically the puppy chewed the shoes.');
    expect(result).toMatchObject({
      sessionId: 'sess-native-1',
      status: 'complete',
      changed: true,
      savedTranscriptUpdated: true,
    } satisfies Partial<NativeFormattingState>);
    expect(window.__NATIVE_FORMATTING_STATUS__).toMatchObject({
      status: 'complete',
      changed: true,
      savedTranscriptUpdated: true,
    });
  });

  it('keeps raw saved transcript when the formatter exceeds the 4s client budget', async () => {
    vi.useFakeTimers();
    registerNativeTranscriptFormatter(
      (raw) => new Promise<string>((resolve) => setTimeout(() => resolve(`${raw}.`), 20_000)),
    );
    const updateSessionFn = vi.fn(async () => ({ success: true }));
    const onUpdated = vi.fn();

    const pending = formatNativeSessionInBackground({
      sessionId: 'sess-native-timeout',
      rawTranscript: 'native formatter should not block save',
      updateSessionFn,
      onUpdated,
    });

    expect(window.__NATIVE_FORMATTING_STATUS__).toMatchObject({
      sessionId: 'sess-native-timeout',
      status: 'pending',
      changed: false,
      savedTranscriptUpdated: false,
    });

    await vi.advanceTimersByTimeAsync(FORMATTER_LATENCY_BUDGET_MS + 10);
    const result = await pending;

    expect(updateSessionFn).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
    expect(getNativeFormatterTelemetry()).toMatchObject({
      attempted: true,
      fallbackToRaw: true,
      errorCode: 'FORMATTER_TIMEOUT_CLIENT',
    });
    expect(result).toMatchObject({
      status: 'complete',
      changed: false,
      savedTranscriptUpdated: false,
    });
  });

  it('keeps raw saved transcript when the formatter changes words or drops fillers', async () => {
    registerNativeTranscriptFormatter(async () => 'Basically the puppy chewed the shoes.');
    const updateSessionFn = vi.fn(async () => ({ success: true }));

    const result = await formatNativeSessionInBackground({
      sessionId: 'sess-native-word-change',
      rawTranscript: 'um basically the puppy chewed the shoes',
      updateSessionFn,
    });

    expect(updateSessionFn).not.toHaveBeenCalled();
    expect(getNativeFormatterTelemetry()).toMatchObject({
      attempted: true,
      fallbackToRaw: true,
      errorCode: 'CLIENT_WORDS_CHANGED',
    });
    expect(result).toMatchObject({
      status: 'complete',
      changed: false,
      savedTranscriptUpdated: false,
    });
  });

  it('surfaces formatted text without a DB update when no persisted session id exists', async () => {
    registerNativeTranscriptFormatter(async () => 'Hello world.');
    const updateSessionFn = vi.fn(async () => ({ success: true }));
    const onUpdated = vi.fn();

    const result = await formatNativeSessionInBackground({
      sessionId: null,
      rawTranscript: 'hello world',
      updateSessionFn,
      onUpdated,
    });

    expect(updateSessionFn).not.toHaveBeenCalled();
    expect(onUpdated).toHaveBeenCalledWith('Hello world.');
    expect(result).toMatchObject({
      sessionId: null,
      status: 'complete',
      changed: true,
      savedTranscriptUpdated: false,
    });
  });
});
