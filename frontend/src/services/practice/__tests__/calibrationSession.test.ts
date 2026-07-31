import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engineState = vi.hoisted(() => ({
  options: null as null | { onTranscriptUpdate: (update: unknown) => void },
  checkAvailability: vi.fn().mockResolvedValue({ isAvailable: true }),
  init: vi.fn().mockResolvedValue({ isOk: true, data: undefined }),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  terminate: vi.fn().mockResolvedValue(undefined),
  getTranscript: vi.fn().mockResolvedValue('final temporary words'),
}));

const micState = vi.hoisted(() => ({
  stream: {
    state: 'ready',
    sampleRate: 16_000,
    onFrame: vi.fn(() => vi.fn()),
    offFrame: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
    _mediaStream: null,
  },
  create: vi.fn(),
}));

class FakeEngine {
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

vi.mock('@/services/transcription/modes/NativeBrowser', () => ({ default: FakeEngine }));
vi.mock('@/services/transcription/modes/PrivateWhisper', () => ({ default: FakeEngine }));
vi.mock('@/services/transcription/utils/audioUtils', () => ({
  createMicStream: () => micState.create(),
}));

import { createCalibrationSession } from '../calibrationSession';

describe('isolated calibration transcription boundary', () => {
  const onTranscript = vi.fn();
  let fetchSpy: ReturnType<typeof vi.fn>;
  let localWrite: ReturnType<typeof vi.spyOn>;
  let sessionWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    engineState.options = null;
    engineState.checkAvailability.mockResolvedValue({ isAvailable: true });
    engineState.init.mockResolvedValue({ isOk: true, data: undefined });
    engineState.getTranscript.mockResolvedValue('final temporary words');
    micState.create.mockResolvedValue(micState.stream);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    localWrite = vi.spyOn(window.localStorage, 'setItem');
    sessionWrite = vi.spyOn(window.sessionStorage, 'setItem');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs Browser calibration without any application network or storage write', async () => {
    const session = createCalibrationSession('browser', { onTranscript });
    await session.start();
    engineState.options?.onTranscriptUpdate({ transcript: { partial: 'temporary draft' } });
    await session.stop();

    expect(engineState.start).toHaveBeenCalledWith();
    expect(micState.create).not.toHaveBeenCalled();
    expect(onTranscript).toHaveBeenLastCalledWith('final temporary words');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localWrite).not.toHaveBeenCalled();
    expect(sessionWrite).not.toHaveBeenCalled();
  });

  it('runs Private calibration with only the local mic/engine and no provider or persistence write', async () => {
    const session = createCalibrationSession('private', { onTranscript });
    await session.start();
    await session.stop();

    expect(micState.create).toHaveBeenCalledTimes(1);
    expect(engineState.start).toHaveBeenCalledWith(micState.stream);
    expect(micState.stream.stop).toHaveBeenCalledTimes(1);
    expect(engineState.terminate).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localWrite).not.toHaveBeenCalled();
    expect(sessionWrite).not.toHaveBeenCalled();
  });

  it('closes cleanly during asynchronous engine initialization', async () => {
    let finishInitialization: ((value: { isOk: true; data: undefined }) => void) | undefined;
    engineState.init.mockReturnValue(new Promise((resolve) => { finishInitialization = resolve; }));
    const session = createCalibrationSession('browser', { onTranscript });

    const starting = session.start();
    await vi.waitFor(() => expect(engineState.init).toHaveBeenCalled());
    const disposing = session.dispose();
    finishInitialization?.({ isOk: true, data: undefined });

    await expect(starting).rejects.toThrow('Calibration was closed.');
    await disposing;
    expect(engineState.start).not.toHaveBeenCalled();
    expect(engineState.terminate).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
