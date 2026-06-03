/**
 * Regression tests for the Private live cumulative-transcript fix.
 *
 * Bug (human proof speaksharp-private-human-41dc1997-rerun.json): while recording,
 * the visible Private transcript showed only the latest sentence and "reset" as the
 * speaker continued — the rolling-decode window's provisional text REPLACED the
 * accumulated draft when the window slid to new speech (low overlap). The full text
 * only appeared after Stop (the separate whole-utterance decode). These tests lock in
 * the NO-SHRINK invariant: once enough context has accumulated, live provisional
 * text must keep prior speech instead of resetting to only the latest window.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';

// Unmock for THIS file so we test the real merge function (mirrors PrivateWhisper.test.ts),
// and stub the heavy engine deps so importing the real module resolves.
vi.unmock('../PrivateWhisper');
vi.mock('whisper-turbo', () => ({}));
vi.mock('@xenova/transformers', () => ({}));
const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  checkAvailability: vi.fn(),
  transcribe: vi.fn(),
  isMeaningfullySilent: vi.fn().mockReturnValue(false),
  processAudioFrame: vi.fn(),
}));
vi.mock('../../audio/pauseDetector', () => ({
  PauseDetector: vi.fn().mockImplementation(() => ({
    isMeaningfullySilent: mocks.isMeaningfullySilent,
    processAudioFrame: mocks.processAudioFrame,
    getCurrentSilenceDurationSeconds: vi.fn().mockReturnValue(0),
  })),
}));
vi.mock('../../engines/PrivateSTT', () => {
  const MockPrivateSTT = vi.fn().mockImplementation(() => ({
    init: mocks.init,
    checkAvailability: mocks.checkAvailability,
    transcribe: mocks.transcribe,
    getEngineType: vi.fn().mockReturnValue('whisper-turbo'),
  }));
  return { PrivateSTT: MockPrivateSTT, createPrivateSTT: vi.fn(() => new MockPrivateSTT()) };
});

import PrivateWhisperDefault, { mergeLiveProvisionalTranscript } from '../PrivateWhisper';

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

describe('mergeLiveProvisionalTranscript — no-shrink invariant', () => {
  it('is importable alongside the default export', () => {
    expect(typeof PrivateWhisperDefault).toBe('function');
    expect(typeof mergeLiveProvisionalTranscript).toBe('function');
  });

  it('appends genuinely new speech instead of replacing (window slide, low overlap)', () => {
    const previous = 'speak sharp microphone proof starts now';
    const next = 'basically I want to make one simple point';
    const merged = mergeLiveProvisionalTranscript(previous, next);
    // Must keep everything already shown AND add the new words — never shrink.
    expect(wordCount(merged)).toBeGreaterThanOrEqual(wordCount(previous));
    expect(merged.toLowerCase()).toContain('microphone proof starts now');
    expect(merged.toLowerCase()).toContain('one simple point');
  });

  it('never shrinks when a short new window follows a long accumulated draft', () => {
    const previous =
      'the main idea is that every transcript should stay readable keep prior sentences';
    const next = 'and preserve the final words'; // new window, no overlap
    const merged = mergeLiveProvisionalTranscript(previous, next);
    expect(wordCount(merged)).toBeGreaterThanOrEqual(wordCount(previous));
    expect(merged.toLowerCase()).toContain('stay readable keep prior sentences');
  });

  it('reproduces the failing sequence: cumulative draft only grows', () => {
    // Approximate the proof's growing-then-resetting emit sequence after enough
    // context has accumulated. Very early unconfirmed openers may still revise.
    const windows = [
      'speak sharp microphone proof starts now',
      'I want to make one simple point',
      'before we move on',
      'the main idea is that every transcript should stay readable',
    ];
    let visible = '';
    let lastLen = 0;
    for (const w of windows) {
      visible = mergeLiveProvisionalTranscript(visible, w);
      const len = wordCount(visible);
      // Monotonic: the visible draft must never lose words it already showed.
      expect(len).toBeGreaterThanOrEqual(lastLen);
      lastLen = len;
    }
    expect(visible.toLowerCase()).toContain('microphone proof');
    expect(visible.toLowerCase()).toContain('stay readable');
  });

  it('still accepts a fuller revision that extends the current text (does not shrink)', () => {
    const previous = 'I went to the';
    const next = 'I went to the store today';
    const merged = mergeLiveProvisionalTranscript(previous, next);
    expect(wordCount(merged)).toBeGreaterThanOrEqual(wordCount(previous));
    expect(merged.toLowerCase()).toContain('store today');
  });

  it('handles empty inputs without throwing', () => {
    expect(mergeLiveProvisionalTranscript('', 'hello world')).toBe('hello world');
    expect(mergeLiveProvisionalTranscript('hello world', '')).toBe('hello world');
  });
});
