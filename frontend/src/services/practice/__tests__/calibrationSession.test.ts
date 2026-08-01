import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engineState = vi.hoisted(() => ({
  options: null as null | { onTranscriptUpdate: (update: unknown) => void },
  checkAvailability: vi.fn(),
  init: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  terminate: vi.fn(),
  getTranscript: vi.fn(),
}));

class FakeBrowserEngine {
  constructor(options: { onTranscriptUpdate: (update: unknown) => void }) {
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

import { createCalibrationSession } from '../calibrationSession';
import { useSessionStore } from '@/stores/useSessionStore';

const LOCK_KEY = 'speaksharp_active_session_lock';

describe('isolated Browser calibration boundary', () => {
  const onTranscript = vi.fn();
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
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
    vi.unstubAllGlobals();
  });

  it('uses only the Browser leaf engine, emits ephemeral words, and leaves no active lock or network write', async () => {
    const localWrite = vi.spyOn(Storage.prototype, 'setItem');
    const session = createCalibrationSession({ onTranscript });
    await session.start();
    engineState.options?.onTranscriptUpdate({ transcript: { partial: 'temporary draft' } });
    await session.stop();

    expect(engineState.start).toHaveBeenCalledWith();
    expect(onTranscript).toHaveBeenLastCalledWith('final temporary words');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOCK_KEY)).toBeNull();
    expect(localWrite.mock.calls.filter(([key]) => key === LOCK_KEY).length).toBeGreaterThan(0);
    expect(localWrite.mock.calls.map(([key]) => String(key)).filter((key) => key !== LOCK_KEY && key !== 'speaksharp_tab_id')).toEqual([]);
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

    await expect(session.start()).rejects.toThrow('init failed');
    expect(engineState.terminate).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(LOCK_KEY)).toBeNull();
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
