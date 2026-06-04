import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isPrivateVadPrototypeEnabled,
  publishPrivateVadTelemetry,
  type PrivateVadTelemetry,
} from '../privateVadFlag';

type VadWindow = Window & {
  __PRIVATE_VAD_PROTOTYPE__?: boolean;
  __PRIVATE_VAD_TELEMETRY__?: PrivateVadTelemetry;
};

const w = window as VadWindow;
const originalLocation = window.location;

/** Stub only `window.location.search` (the flag reads nothing else). */
function setSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { search } as unknown as Location,
  });
}

describe('privateVadFlag', () => {
  beforeEach(() => {
    delete w.__PRIVATE_VAD_PROTOTYPE__;
    delete w.__PRIVATE_VAD_TELEMETRY__;
    setSearch('');
  });
  afterEach(() => {
    delete w.__PRIVATE_VAD_PROTOTYPE__;
    delete w.__PRIVATE_VAD_TELEMETRY__;
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  describe('isPrivateVadPrototypeEnabled', () => {
    it('is OFF by default (no window flag, no query param) — RMS path stays default', () => {
      expect(isPrivateVadPrototypeEnabled()).toBe(false);
    });

    it('is ON when window.__PRIVATE_VAD_PROTOTYPE__ === true', () => {
      w.__PRIVATE_VAD_PROTOTYPE__ = true;
      expect(isPrivateVadPrototypeEnabled()).toBe(true);
    });

    it('does not enable on a truthy-but-not-true window value', () => {
      (w as unknown as { __PRIVATE_VAD_PROTOTYPE__: unknown }).__PRIVATE_VAD_PROTOTYPE__ = 1;
      expect(isPrivateVadPrototypeEnabled()).toBe(false);
    });

    it('is ON when ?privateVad=1', () => {
      setSearch('?privateVad=1');
      expect(isPrivateVadPrototypeEnabled()).toBe(true);
    });

    it('is OFF when ?privateVad=0 or any other value', () => {
      setSearch('?privateVad=0');
      expect(isPrivateVadPrototypeEnabled()).toBe(false);
      setSearch('?privateVad=true');
      expect(isPrivateVadPrototypeEnabled()).toBe(false);
    });
  });

  describe('publishPrivateVadTelemetry', () => {
    it('publishes the snapshot to window.__PRIVATE_VAD_TELEMETRY__ for the A/B harness', () => {
      const snapshot: PrivateVadTelemetry = {
        vadEnabled: true,
        vadModel: 'silero-vad',
        vadRuntime: '@ricky0123/vad-web',
        vadRuntimeVersion: null,
        vadOnsetMs: 120,
        vadMeanSpeechProb: 0.82,
        vadSpeechSegments: [{ startMs: 100, endMs: 900 }],
        vadFellBackToRms: false,
      };
      publishPrivateVadTelemetry(snapshot);
      expect(w.__PRIVATE_VAD_TELEMETRY__).toEqual(snapshot);
    });
  });
});
