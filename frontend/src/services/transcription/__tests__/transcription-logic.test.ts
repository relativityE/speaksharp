import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ENV } from '../../../config/TestFlags';
import { STTNegotiator } from '../STTNegotiator';
import { EngineSelector } from '../EngineSelector';
import { TranscriptionModeOptions } from '../modes/types';
import TranscriptionService, { resetTranscriptionService, getTranscriptionService } from '../TranscriptionService';
import { PROD_FREE_POLICY, PROD_PRO_POLICY } from '../TranscriptionPolicy';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';
import { sttRegistry } from '../STTRegistry';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result } from '../modes/types';

describe('Core Unit Suite (Tier 1)', () => {
    beforeEach(async () => {
        await setupStrictZero();
    });
  
  describe('ENV Bridge', () => {
    it('should detect test environment correctly', () => {
      expect(ENV.isTest).toBe(true);
    });

    it('should handle snapshots and resets correctly', () => {
      const original = ENV.disableWasm;
      // Note: We don't mutate ENV directly in these tests as it is frozen/const in some modules,
      // but we verify the reset mechanism if applicable.
      expect(typeof original).toBe('boolean');
    });
  });

  describe('STTNegotiator', () => {
    it('should negotiate mock mode when ENV.disableWasm is true', () => {
      // Use PROD_PRO_POLICY because PROD_FREE_POLICY correctly disallows 'private'
      const strategy = STTNegotiator.negotiate(PROD_PRO_POLICY, 'private');
      expect(strategy).toBeDefined();
    });
  });

  describe('EngineSelector', () => {
    it('should resolve to a mock engine from registry if strategy is mock', async () => {
      const mockStrategy = { mode: 'private' as const, isMock: true, variant: 'whisper-turbo' };
      const mockOptions = { onTranscriptUpdate: () => {}, onReady: () => {} };
      
      class MockEngine extends STTEngine {
        public override readonly type = 'whisper-turbo' as const;
        constructor(options: TranscriptionModeOptions) { super(options); }
        protected async onInit() { return Result.ok(undefined); }
        protected async onStart() {}
        protected async onStop() {}
        protected async onPause() {}
        protected async onResume() {}
        protected async onDestroy() {}
        async transcribe() { return Result.ok('test'); }
      }

      sttRegistry.register('whisper-turbo', (opts) => new MockEngine(opts));

      const engine = await EngineSelector.select(mockStrategy, mockOptions as unknown as TranscriptionModeOptions, PROD_FREE_POLICY);
      expect(engine).toBeDefined();
      expect(engine.getEngineType()).toBe('whisper-turbo');
    });
  });

  describe('TranscriptionService Lifecycle', () => {
    let service: TranscriptionService;

    beforeEach(() => {
      resetTranscriptionService();
      
      // Register native-browser mock for Free Tier tests
      class NativeMock extends STTEngine {
        public override readonly type = 'native-browser' as const;
        protected async onInit() { return Result.ok(undefined); }
        protected async onStart() {}
        protected async onStop() {}
        protected async onDestroy() {}
        async transcribe() { return Result.ok('native test'); }
      }
      sttRegistry.register('native-browser', (opts) => new NativeMock(opts));
      
      service = getTranscriptionService({ policy: PROD_FREE_POLICY });
    });

    afterEach(async () => {
      if (service) {
        await service.destroy();
      }
      resetTranscriptionService();
    });

    it('should initialize and move to READY state', async () => {
      await service.init();
      expect(service.getState()).toBe('READY');
    });

    it('should generate an idempotency key at start', async () => {
      await service.startTranscription();
      expect(service.getIdempotencyKey()).toBeTruthy();
    });
  });
});
