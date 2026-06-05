import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolvePrivateModel,
  isPrivateModelOverridden,
  resolvePrivateModelSource,
  publishPrivateModelTelemetry,
  getRequestedPrivateModel,
  assertValidPrivateModelSelection,
  type PrivateModelTelemetry,
} from '../privateModelFlag';
import { PRIV_STT_MODELS } from '../../sttConstants';

type ModelWindow = Window & {
  __PRIVATE_MODEL__?: string;
  __PRIVATE_MODEL_TELEMETRY__?: PrivateModelTelemetry;
};

const w = window as ModelWindow;
const originalLocation = window.location;

function setSearch(search: string): void {
  Object.defineProperty(window, 'location', { configurable: true, value: { search } as unknown as Location });
}

describe('privateModelFlag', () => {
  beforeEach(() => {
    delete w.__PRIVATE_MODEL__;
    delete w.__PRIVATE_MODEL_TELEMETRY__;
    setSearch('');
  });
  afterEach(() => {
    delete w.__PRIVATE_MODEL__;
    delete w.__PRIVATE_MODEL_TELEMETRY__;
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  describe('resolvePrivateModel', () => {
    it('defaults to the production model when unset (byte-identical default path)', () => {
      expect(resolvePrivateModel()).toBe(PRIV_STT_MODELS.DEFAULT);
      expect(isPrivateModelOverridden()).toBe(false);
    });

    it('honors a valid window override', () => {
      w.__PRIVATE_MODEL__ = 'whisper-small.en';
      expect(resolvePrivateModel()).toBe('whisper-small.en');
      expect(isPrivateModelOverridden()).toBe(true);
    });

    it('honors a valid ?privateModel= override', () => {
      setSearch('?privateModel=whisper-base.en');
      expect(resolvePrivateModel()).toBe('whisper-base.en');
      expect(isPrivateModelOverridden()).toBe(true);
    });

    it('falls back to the default on an unknown model (no blind switch)', () => {
      w.__PRIVATE_MODEL__ = 'gpt-4o-whisper';
      expect(resolvePrivateModel()).toBe(PRIV_STT_MODELS.DEFAULT);
      setSearch('?privateModel=not-a-model');
      expect(resolvePrivateModel()).toBe(PRIV_STT_MODELS.DEFAULT);
    });
  });

  describe('publishPrivateModelTelemetry', () => {
    it('publishes the snapshot to window.__PRIVATE_MODEL_TELEMETRY__', () => {
      const snapshot: PrivateModelTelemetry = {
        model: 'whisper-small.en',
        runtime: 'transformers-js',
        approxMB: PRIV_STT_MODELS.CANDIDATES['whisper-small.en'].approxMB,
        overridden: true,
        selectionSource: 'url',
        loadTimeMs: 1820,
        fallbackPath: 'remote-only',
        cloudFallbackAttempted: false,
      };
      publishPrivateModelTelemetry(snapshot);
      expect(w.__PRIVATE_MODEL_TELEMETRY__).toEqual(snapshot);
      // Privacy invariant must be observable + always false.
      expect(w.__PRIVATE_MODEL_TELEMETRY__?.cloudFallbackAttempted).toBe(false);
    });
  });

  describe('resolvePrivateModelSource', () => {
    it("is 'default' with no flag, 'window' for the window flag, 'url' for the query param", () => {
      expect(resolvePrivateModelSource()).toBe('default');
      w.__PRIVATE_MODEL__ = 'whisper-base.en';
      expect(resolvePrivateModelSource()).toBe('window');
      delete w.__PRIVATE_MODEL__;
      setSearch('?privateModel=whisper-base.en');
      expect(resolvePrivateModelSource()).toBe('url');
    });
  });

  describe('getRequestedPrivateModel', () => {
    it('returns null when no flag is present, and the raw value when one is (valid or not)', () => {
      expect(getRequestedPrivateModel()).toBeNull();
      w.__PRIVATE_MODEL__ = 'whisper-base.en';
      expect(getRequestedPrivateModel()).toBe('whisper-base.en');
      delete w.__PRIVATE_MODEL__;
      setSearch('?privateModel=totally-made-up');
      expect(getRequestedPrivateModel()).toBe('totally-made-up');
    });
  });

  describe('assertValidPrivateModelSelection (STT-P6-HUMAN: no silent tiny fallback)', () => {
    it('is a no-op when no flag is set (default path unaffected)', () => {
      expect(() => assertValidPrivateModelSelection()).not.toThrow();
    });

    it('is a no-op for a supported candidate', () => {
      w.__PRIVATE_MODEL__ = 'whisper-base.en';
      expect(() => assertValidPrivateModelSelection()).not.toThrow();
      delete w.__PRIVATE_MODEL__;
      setSearch('?privateModel=whisper-small.en');
      expect(() => assertValidPrivateModelSelection()).not.toThrow();
    });

    it('THROWS (no silent tiny fallback) when an explicitly requested model is unsupported', () => {
      w.__PRIVATE_MODEL__ = 'whisper-large-v3';
      expect(() => assertValidPrivateModelSelection()).toThrow(/MODEL_LOAD_FAILED.*whisper-large-v3.*not supported/);
      delete w.__PRIVATE_MODEL__;
      setSearch('?privateModel=bogus');
      expect(() => assertValidPrivateModelSelection()).toThrow(/MODEL_LOAD_FAILED/);
    });
  });
});
