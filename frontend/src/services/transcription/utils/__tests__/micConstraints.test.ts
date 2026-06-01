// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.unmock('../audioUtils.impl');

import { resolveAudioConstraints, RAW_AUDIO_CONSTRAINTS } from '../audioUtils.impl';

function setSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search },
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  setSearch('');
  window.localStorage.clear();
});

describe('resolveAudioConstraints (test-only mic-constraint toggle)', () => {
  it('defaults to raw constraints with no flag (product behavior unchanged)', () => {
    setSearch('');
    const { mode, constraints } = resolveAudioConstraints();
    expect(mode).toBe('raw');
    expect(constraints).toEqual(RAW_AUDIO_CONSTRAINTS);
  });

  it('raw constraints disable all DSP and force mono (drop-in parity)', () => {
    expect(RAW_AUDIO_CONSTRAINTS).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    });
  });

  it('?privateMicConstraints=default selects browser-default DSP for the A/B', () => {
    setSearch('?privateMicConstraints=default');
    const { mode, constraints } = resolveAudioConstraints();
    expect(mode).toBe('default');
    // `true` => browser-default audio constraints (DSP on).
    expect(constraints).toBe(true);
  });

  it('localStorage fallback selects default when query param is absent', () => {
    setSearch('');
    window.localStorage.setItem('speaksharp.test.micConstraints', 'default');
    expect(resolveAudioConstraints().mode).toBe('default');
  });

  it('query param takes precedence; unknown values fall back to raw', () => {
    setSearch('?privateMicConstraints=raw');
    window.localStorage.setItem('speaksharp.test.micConstraints', 'default');
    expect(resolveAudioConstraints().mode).toBe('raw');

    setSearch('?privateMicConstraints=bogus');
    expect(resolveAudioConstraints().mode).toBe('raw');
  });
});
