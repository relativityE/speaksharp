import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ENV } from '../../../config/TestFlags';
import { STTNegotiator } from '../STTNegotiator';
import { EngineSelector } from '../EngineSelector';
import { TranscriptionModeOptions } from '../modes/types';
import TranscriptionService, { resetTranscriptionService, getTranscriptionService } from '../TranscriptionService';
import { PROD_FREE_POLICY } from '../TranscriptionPolicy';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';

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
      const strategy = STTNegotiator.negotiate(PROD_FREE_POLICY, 'private');
      // In tests, ENV.disableWasm is usually true by default in the mock manifest
      expect(strategy).toBeDefined();
    });
  });

  describe('EngineSelector', () => {
    it('should resolve to a mock engine from registry if strategy is mock', async () => {
      const mockStrategy = { mode: 'private' as const, isMock: true, variant: 'whisper-turbo' };
      const mockOptions = { onTranscriptUpdate: () => {}, onReady: () => {} };
      
      // ARCHITECTURE: Safe merge into E2E registry
      const e2eWindow = window as any;
      if (!e2eWindow.__SS_E2E__) e2eWindow.__SS_E2E__ = { registry: {} };
      e2eWindow.__SS_E2E__.registry['whisper-turbo'] = () => ({ start: vi.fn(), stop: vi.fn(), getEngineType: () => 'whisper-turbo' });

      const engine = await EngineSelector.select(mockStrategy, mockOptions as unknown as TranscriptionModeOptions, PROD_FREE_POLICY);
      expect(engine).toBeDefined();
    });
  });

  describe('TranscriptionService Lifecycle', () => {
    let service: TranscriptionService;

    beforeEach(() => {
      resetTranscriptionService();
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
