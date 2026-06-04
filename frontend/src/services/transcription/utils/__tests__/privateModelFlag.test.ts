import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolvePrivateModel,
  isPrivateModelOverridden,
  publishPrivateModelTelemetry,
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
        approxMB: PRIV_STT_MODELS.CANDIDATES['whisper-small.en'].approxMB,
        overridden: true,
        loadTimeMs: 1820,
      };
      publishPrivateModelTelemetry(snapshot);
      expect(w.__PRIVATE_MODEL_TELEMETRY__).toEqual(snapshot);
    });
  });
});
