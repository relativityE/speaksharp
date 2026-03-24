import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { TranscriptionPolicy } from '../TranscriptionPolicy';
import { MicStream } from '../utils/types';
import { testRegistry } from '../TestRegistry';
import { STTEngine } from '@/contracts/STTEngine';
import { Result } from '../modes/types';

class MockHeartbeatEngine extends STTEngine {
    constructor(public readonly type: 'whisper-turbo' | 'native' | 'cloud' = 'whisper-turbo') {
        super();
    }
    
    // Abstract hooks
    protected async onInit() { return Result.ok(undefined); }
    protected async onStart() {}
    protected async onStop() {}
    protected async onDestroy() {}
    async transcribe() { return Result.ok(''); }

    // Helper for testing heartbeat logic
    public setLiveness(val: number) { this.lastHeartbeat = val; }
}

describe('TranscriptionService - 8s Heartbeat (Task 7)', () => {
    let service: TranscriptionService;
    const mockOnStatusChange = vi.fn();
    let engine: MockHeartbeatEngine;

    const basePolicy: TranscriptionPolicy = {
        allowNative: true,
        allowCloud: false,
        allowPrivate: true,
        preferredMode: 'private',
        allowFallback: true,
        executionIntent: 'test'
    };

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-17T06:00:00Z'));
        vi.clearAllMocks();
        testRegistry.clear();

        engine = new MockHeartbeatEngine();
        testRegistry.register('private', () => engine);

        service = new TranscriptionService({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            onStatusChange: mockOnStatusChange,
            onModeChange: vi.fn(),
            session: null,
            navigate: vi.fn(),
            getAssemblyAIToken: vi.fn(),
            policy: { ...basePolicy },
            mockMic: {
                stream: {} as MediaStream,
                stop: vi.fn(),
                onFrame: vi.fn().mockReturnValue(() => { }),
            } as unknown as MicStream
        });
    });

    afterEach(async () => {
        await service.destroy();
        vi.useRealTimers();
    });

    it('should trigger frozen status after 8s of inactivity', async () => {
        await service.init();
        await service.startTranscription();
        
        // Advance 2s to start watchdog (it checks every 2s)
        await vi.advanceTimersByTimeAsync(2000);
        
        // Mock a freeze: set liveness to 10s ago
        engine.setLiveness(Date.now() - 10000);
        
        // Wait for next watchdog pulse
        await vi.advanceTimersByTimeAsync(2000);
        
        const frozenCall = mockOnStatusChange.mock.calls.find(c => c[0]?.isFrozen === true);
        expect(frozenCall).not.toBeUndefined();
        expect(frozenCall?.[0].message).toContain('Speech recognition is taking a moment');
    });

    it('should recover when engine becomes active again', async () => {
        await service.init();
        await service.startTranscription();
        
        // Trigger freeze
        engine.setLiveness(Date.now() - 10000);
        await vi.advanceTimersByTimeAsync(2000);
        expect(mockOnStatusChange).toHaveBeenCalledWith(expect.objectContaining({ isFrozen: true }));
        
        // Recover
        await vi.advanceTimersByTimeAsync(2000);
        engine.setLiveness(Date.now() + 500); // Future-proof to ensure delta < 2000
        
        // Next pulse
        await vi.advanceTimersByTimeAsync(2000);
        
        const recoveredCall = mockOnStatusChange.mock.calls.find(c => c[0]?.message === 'Speech recognition recovered');
        expect(recoveredCall).not.toBeUndefined();
        expect(recoveredCall?.[0].isFrozen).toBe(false);
    });

    it('should correctly handle multi-segment handoff (Task 8)', async () => {
        const onHistoryUpdate = vi.fn();
        service.updateCallbacks({ onHistoryUpdate });

        await service.init();
        await service.startTranscription();
        
        // 1. Simulate some Private transcript progress
        vi.spyOn(engine, 'getTranscript').mockResolvedValue('Chapter 1 text from Private');
        
        // 2. Mock Native engine for recovery
        const nativeEngine = new MockHeartbeatEngine('native');
        testRegistry.register('native', () => nativeEngine);

        // 3. Trigger segmented handoff
        await service.switchToNativeSegmented();

        // 4. Verify history preservation
        expect(onHistoryUpdate).toHaveBeenCalledWith(expect.arrayContaining([
            { mode: 'private', text: 'Chapter 1 text from Private', timestamp: expect.any(Number) }
        ]));
        expect(service.getTranscriptHistory()).toHaveLength(1);
        expect(service.getTranscriptHistory()[0]).toEqual(expect.objectContaining({ 
            mode: 'private', 
            text: 'Chapter 1 text from Private' 
        }));

        // 5. Verify transition to Native session
        expect(service.getMode()).toBe('native');
        expect(mockOnStatusChange).toHaveBeenCalledWith(expect.objectContaining({
            type: 'info',
            message: expect.stringContaining('Switched to non-private')
        }));
    });
});
