import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engineState = vi.hoisted(() => ({
  options: null as null | {
    onTranscriptUpdate: (update: unknown) => void;
    onReady: () => void;
    onError?: (error: { message: string }) => void;
  },
  checkAvailability: vi.fn(),
  init: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  terminate: vi.fn(),
  getTranscript: vi.fn(),
}));

class FakeBrowserEngine {
  constructor(options: {
    onTranscriptUpdate: (update: unknown) => void;
    onReady: () => void;
    onError?: (error: { message: string }) => void;
  }) {
    engineState.options = options;
  }
  checkAvailability = engineState.checkAvailability;
  init = engineState.init;
  start = engineState.start;
  stop = engineState.stop;
  terminate = engineState.terminate;
  getTranscript = engineState.getTranscript;
}

vi.mock('@/services/transcription/modes/NativeBrowser', () => ({ default: FakeBrowserEngine }));

import { CALIBRATION_TELEMETRY_SESSION_ID, createCalibrationSession } from '../calibrationSession';
import { useSessionStore } from '@/stores/useSessionStore';
import {
  __resetSessionTelemetryBusForTests,
  getSessionTelemetryBus,
  publishTelemetry,
} from '@/services/telemetry/sessionTelemetryBus';

const LOCK_KEY = 'speaksharp_active_session_lock';

function seedCalibrationTranscriptTelemetry() {
  getSessionTelemetryBus().reset(CALIBRATION_TELEMETRY_SESSION_ID);
  publishTelemetry({
    type: 'transcript.partial',
    mode: 'native',
    t: 1,
    text: 'raw temporary words',
    sequence: 0,
  });
  publishTelemetry({
    type: 'transcript.final',
    mode: 'native',
    t: 2,
    text: 'raw temporary words final',
    sequence: 1,
  });
}

function seedNativeBrowserTrace() {
  window.__NATIVE_BROWSER_TRACE__ = [
    {
      event: 'onresult_raw',
      rId: CALIBRATION_TELEMETRY_SESSION_ID,
      rawResults: [{ transcript: 'nested calibration words', isFinal: false }],
    },
    {
      event: 'onresult_raw',
      rId: 'successor-session',
      rawResults: [{ transcript: 'successor words', isFinal: true }],
    },
  ];
}

describe('isolated Browser calibration boundary', () => {
  const onTranscript = vi.fn();
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.__NATIVE_BROWSER_TRACE__ = [];
    __resetSessionTelemetryBusForTests();
    useSessionStore.getState().setEngineSelectionLock(false, null);
    engineState.options = null;
    engineState.checkAvailability.mockResolvedValue({ isAvailable: true });
    engineState.init.mockResolvedValue({ isOk: true, data: undefined });
    engineState.start.mockResolvedValue(undefined);
    engineState.stop.mockResolvedValue(undefined);
    engineState.terminate.mockResolvedValue(undefined);
    engineState.getTranscript.mockResolvedValue('final temporary words');
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    useSessionStore.getState().setEngineSelectionLock(false, null);
    localStorage.clear();
    sessionStorage.clear();
    delete window.__NATIVE_BROWSER_TRACE__;
    __resetSessionTelemetryBusForTests();
    vi.unstubAllGlobals();
  });

  it('purges its raw transcript telemetry on successful stop', async () => {
    const session = createCalibrationSession({ onTranscript });
    await session.start();
    seedCalibrationTranscriptTelemetry();
    seedNativeBrowserTrace();
    expect(getSessionTelemetryBus().getBufferedEvents()).toHaveLength(2);

    await session.stop();

    expect(getSessionTelemetryBus().currentSessionId).toBe('unset');
    expect(getSessionTelemetryBus().getBufferedEvents()).toEqual([]);
    expect(window.__NATIVE_BROWSER_TRACE__).toEqual([
      expect.objectContaining({ rId: 'successor-session' }),
    ]);
    expect(JSON.stringify(window.__NATIVE_BROWSER_TRACE__)).not.toContain('nested calibration words');
  });

  it('does not clear telemetry after another session has rebound the process bus', async () => {
    const session = createCalibrationSession({ onTranscript });
    await session.start();
    getSessionTelemetryBus().reset('successor-session');
    publishTelemetry({
      type: 'transcript.final',
      mode: 'private',
      t: 3,
      text: 'successor words',
      sequence: 0,
    });

    await session.stop();

    expect(getSessionTelemetryBus().currentSessionId).toBe('successor-session');
    expect(getSessionTelemetryBus().getBufferedEvents()).toHaveLength(1);
  });

  it('uses only the Browser leaf engine, emits ephemeral words, and leaves no active lock or network write', async () => {
    const localWrite = vi.spyOn(Storage.prototype, 'setItem');
    const session = createCalibrationSession({ onTranscript });
    await session.start();
    engineState.options?.onTranscriptUpdate({ transcript: { partial: 'temporary draft' } });
    const finalTranscript = await session.stop();

    expect(engineState.start).toHaveBeenCalledWith();
    expect(finalTranscript).toBe('final temporary words');
    expect(onTranscript).toHaveBeenLastCalledWith('final temporary words');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOCK_KEY)).toBeNull();
    expect(localWrite.mock.calls.filter(([key]) => key === LOCK_KEY).length).toBeGreaterThan(0);
    expect(localWrite.mock.calls.map(([key]) => String(key)).filter((key) => key !== LOCK_KEY && key !== 'speaksharp_tab_id')).toEqual([]);
  });

  it('returns an empty authoritative result when Browser captured no words', async () => {
    engineState.getTranscript.mockResolvedValue('   ');
    const session = createCalibrationSession({ onTranscript });

    await session.start();
    expect(await session.stop()).toBe('');
    expect(onTranscript).toHaveBeenLastCalledWith('');
    expect(localStorage.getItem(LOCK_KEY)).toBeNull();
  });

  it('reports ready only from the Browser acoustic-ready callback and only once', async () => {
    const onReady = vi.fn();
    const session = createCalibrationSession({ onTranscript, onReady });

    await session.start();
    expect(onReady).not.toHaveBeenCalled();

    engineState.options?.onReady();
    engineState.options?.onReady();
    expect(onReady).toHaveBeenCalledTimes(1);

    await session.dispose();
  });

  it('surfaces a runtime recognition error once while cleaning up the engine and mutex', async () => {
    const onError = vi.fn();
    const session = createCalibrationSession({ onTranscript, onError });

    await session.start();
    seedCalibrationTranscriptTelemetry();
    seedNativeBrowserTrace();
    engineState.options?.onError?.({ message: 'Browser recognition stopped.' });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Browser recognition stopped.'));
    await vi.waitFor(() => expect(engineState.terminate).toHaveBeenCalledTimes(1));
    expect(engineState.stop).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(LOCK_KEY)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getSessionTelemetryBus().getBufferedEvents()).toEqual([]);
    expect(window.__NATIVE_BROWSER_TRACE__).toEqual([
      expect.objectContaining({ rId: 'successor-session' }),
    ]);
  });

  it('rejects calibration while the same tab has an active or unresolved recording', async () => {
    useSessionStore.getState().setEngineSelectionLock(true, 'full_save');
    const session = createCalibrationSession({ onTranscript });

    await expect(session.start()).rejects.toThrow(/Finish the current recording or recovery step/);
    expect(engineState.checkAvailability).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOCK_KEY)).toBeNull();
  });

  it('rejects a fresh lock held by another tab without touching its lock', async () => {
    const otherLock = JSON.stringify({ tabId: 'another-tab', timestamp: Date.now(), state: 'RECORDING' });
    localStorage.setItem(LOCK_KEY, otherLock);
    const session = createCalibrationSession({ onTranscript });

    await expect(session.start()).rejects.toThrow(/active in another tab/);
    expect(engineState.checkAvailability).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOCK_KEY)).toBe(otherLock);
  });

  it('releases its mutex when Browser initialization fails', async () => {
    engineState.init.mockResolvedValue({ isOk: false, error: new Error('init failed') });
    const session = createCalibrationSession({ onTranscript });
    seedCalibrationTranscriptTelemetry();

    await expect(session.start()).rejects.toThrow('init failed');
    expect(engineState.terminate).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(LOCK_KEY)).toBeNull();
    expect(getSessionTelemetryBus().getBufferedEvents()).toEqual([]);
  });

  it('purges raw transcript telemetry when calibration is disposed', async () => {
    const session = createCalibrationSession({ onTranscript });
    await session.start();
    seedCalibrationTranscriptTelemetry();
    seedNativeBrowserTrace();

    await session.dispose();

    expect(getSessionTelemetryBus().getBufferedEvents()).toEqual([]);
    expect(window.__NATIVE_BROWSER_TRACE__).toEqual([
      expect.objectContaining({ rId: 'successor-session' }),
    ]);
  });

  it('closes cleanly during asynchronous initialization and releases its mutex', async () => {
    let finishInitialization: ((value: { isOk: true; data: undefined }) => void) | undefined;
    engineState.init.mockReturnValue(new Promise((resolve) => { finishInitialization = resolve; }));
    const session = createCalibrationSession({ onTranscript });

    const starting = session.start();
    await vi.waitFor(() => expect(engineState.init).toHaveBeenCalled());
    const disposing = session.dispose();
    finishInitialization?.({ isOk: true, data: undefined });

    await expect(starting).rejects.toThrow('Calibration was closed.');
    await disposing;
    expect(engineState.start).not.toHaveBeenCalled();
    expect(engineState.terminate).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(LOCK_KEY)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
