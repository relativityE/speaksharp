/* @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMicStreamImpl } from '../audioUtils.impl';
import { isMicAcquisitionError, micAccessIssue } from '@/lib/micAccessErrors';

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'running';
  close = vi.fn(async () => undefined);
  constructor(_options: AudioContextOptions) { FakeAudioContext.instances.push(this); }
}
const originalAudioContext = window.AudioContext;
const originalMediaDevices = navigator.mediaDevices;

beforeEach(() => {
  FakeAudioContext.instances = [];
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  window.__SS_E2E__ = { isActive: true, engineType: 'real' };
});
afterEach(() => {
  delete window.__SS_E2E__;
  if (originalAudioContext) Object.defineProperty(window, 'AudioContext', { configurable: true, value: originalAudioContext });
  else Reflect.deleteProperty(window, 'AudioContext');
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices });
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

it.each([
  ['NotAllowedError', 'blocked'], ['NotFoundError', 'not_found'], ['NotReadableError', 'in_use'], ['SecurityError', 'blocked'],
] as const)('a getUserMedia %s is rethrown unchanged, marked as the mic\'s own failure, and its AudioContext is closed', async (name, issue) => {
  const denial = new DOMException('private diagnostic text', name);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true, value: { getUserMedia: vi.fn(async () => { throw denial; }) },
  });
  const thrown = await createMicStreamImpl({ sampleRate: 16_000, frameSize: 1024 }).catch((error: unknown) => error);
  expect(thrown).toBe(denial);
  expect(isMicAcquisitionError(thrown)).toBe(true);
  expect(micAccessIssue(thrown)).toBe(issue);
  await Promise.resolve(); await Promise.resolve();
  expect(FakeAudioContext.instances).toHaveLength(1);
  expect(FakeAudioContext.instances[0].close).toHaveBeenCalledTimes(1);
});
