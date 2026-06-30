import { describe, it, expect, vi, beforeEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { STTStrategy } from '../STTStrategy';
import { STTStrategyFactory } from '../STTStrategyFactory';
import { Result } from '../modes/types';
import { NavigateFunction } from 'react-router-dom';
import { detectRepetitionRisk } from '@/utils/repetitionRisk';

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
      init: vi.fn().mockResolvedValue(Result.ok(undefined)),
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

  it('should preserve latest partial transcript when stopping without provider final text', async () => {
    vi.mocked(mockStrategy.getTranscript).mockResolvedValue('');
    await moveToRecording();

    const callbacks = vi.mocked(STTStrategyFactory.create).mock.calls[0][1];
    callbacks.onTranscriptUpdate({ transcript: { partial: 'Visible cloud transcript' } });

    const result = await service.stopTranscription();

    expect(result?.transcript).toBe('Visible cloud transcript');
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

  it('PRESERVES a repetition loop in the saved transcript (flag-only, no mutation) and flags the risk', async () => {
    // #891 data-integrity decision: the authoritative final stop transcript is NO LONGER collapsed.
    // A hallucinated loop cannot be reliably distinguished from genuine repeated speech (emphasis/
    // correction), so we PRESERVE the raw saved text and only FLAG repetition risk via the
    // non-mutating detector. (Previously this collapsed the doubling — that silently altered saved
    // user speech, which the team reverted for data integrity.)
    const doubled = 'We should literally like, wait, um, basically, we should literally like, wait, um, basically.';
    expect(detectRepetitionRisk(doubled).repetitionRisk).toBe(true); // sanity: input IS doubled
    vi.mocked(mockStrategy.getTranscript).mockResolvedValue(doubled);
    await moveToRecording();

    const result = await service.stopTranscription();
    const out = result?.transcript ?? '';

    expect(out).toBeTruthy(); // not the empty-catch path
    // saved text is PRESERVED, not collapsed — BOTH occurrences remain
    expect((out.toLowerCase().match(/we should literally like/g) || []).length).toBe(2);
    expect(out.length).toBeGreaterThanOrEqual(doubled.length - 2); // not shortened (allow a trailing trim)
    // repetition risk is still FLAGGED (non-mutating)
    expect(detectRepetitionRisk(out).repetitionRisk).toBe(true);
  });
});
