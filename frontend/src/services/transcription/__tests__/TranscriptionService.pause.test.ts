import { describe, it, expect, vi, beforeEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { STTStrategy } from '../STTStrategy';
import { STTStrategyFactory } from '../STTStrategyFactory';
import { NavigateFunction } from 'react-router-dom';

vi.mock('../STTStrategyFactory');
vi.mock('../utils/audioUtils', () => ({
  createMicStream: vi.fn().mockResolvedValue({
    stop: vi.fn(),
    onFrame: vi.fn().mockReturnValue(() => {})
  })
}));

describe('TranscriptionService Pause/Resume', () => {
  let service: TranscriptionService;
  let mockStrategy: STTStrategy;
  let onTranscriptUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onTranscriptUpdate = vi.fn();
    
    // Setup Mock Strategy
    mockStrategy = {
      checkAvailability: vi.fn().mockResolvedValue({ isAvailable: true }),
      prepare: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined),
      getTranscript: vi.fn().mockResolvedValue('test transcript'),
      getLastHeartbeatTimestamp: vi.fn().mockReturnValue(Date.now()),
      getEngineType: vi.fn().mockReturnValue('mock')
    } as unknown as STTStrategy;

    vi.mocked(STTStrategyFactory.create).mockReturnValue(mockStrategy);

    service = new TranscriptionService({
      onTranscriptUpdate,
      onModelLoadProgress: vi.fn(),
      onReady: vi.fn(),
      session: null,
      navigate: vi.fn() as unknown as NavigateFunction,
      getAssemblyAIToken: vi.fn()
    });
  });

  async function moveToRecording() {
    await service.init();
    await service.startTranscription();
  }

  it('should transition to PAUSED and call strategy.pause()', async () => {
    await moveToRecording();
    expect(service.getState()).toBe('RECORDING');

    await service.pauseTranscription();

    expect(service.getState()).toBe('PAUSED');
    expect(mockStrategy.pause).toHaveBeenCalled();
  });

  it('should ignore transcript updates while PAUSED', async () => {
    await moveToRecording();
    await service.pauseTranscription();
    expect(service.getState()).toBe('PAUSED');

    // Manually trigger the internal processTranscript callback
    // We access it via the strategyCallbacks which were passed to the factory
    const callbacks = vi.mocked(STTStrategyFactory.create).mock.calls[0][1];
    
    callbacks.onTranscriptUpdate({ transcript: { final: 'Hidden text' } });

    expect(onTranscriptUpdate).not.toHaveBeenCalled();
  });

  it('should transition back to RECORDING and call strategy.resume()', async () => {
    await moveToRecording();
    await service.pauseTranscription();
    expect(service.getState()).toBe('PAUSED');

    await service.resumeTranscription();

    expect(service.getState()).toBe('RECORDING');
    expect(mockStrategy.resume).toHaveBeenCalled();
  });

  it('should process transcript updates after RESUME', async () => {
    await moveToRecording();
    await service.pauseTranscription();
    await service.resumeTranscription();
    
    const callbacks = vi.mocked(STTStrategyFactory.create).mock.calls[0][1];
    callbacks.onTranscriptUpdate({ transcript: { final: 'Visible text' } });

    expect(onTranscriptUpdate).toHaveBeenCalledWith(expect.objectContaining({
      transcript: { final: 'Visible text' }
    }));
  });

  it('should prevent pause if not in RECORDING state', async () => {
    expect(service.getState()).toBe('IDLE');
    await service.pauseTranscription();
    expect(service.getState()).toBe('IDLE');
    expect(mockStrategy.pause).not.toHaveBeenCalled();
  });

  it('should prevent resume if not in PAUSED state', async () => {
    await moveToRecording();
    expect(service.getState()).toBe('RECORDING');
    await service.resumeTranscription();
    expect(service.getState()).toBe('RECORDING');
    expect(mockStrategy.resume).not.toHaveBeenCalled();
  });
});
