import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../STTRegistry', () => ({
  getEngine: vi.fn(() => undefined),
}));

import { STTStrategyFactory } from '../STTStrategyFactory';
import NativeBrowser from '../modes/NativeBrowser';
import type { TranscriptionModeOptions } from '../modes/types';
import type { TranscriptionPolicy } from '../TranscriptionPolicy';

const options = {
  onReady: vi.fn(),
  onError: vi.fn(),
  onTranscriptUpdate: vi.fn(),
} as unknown as TranscriptionModeOptions;

const policy = {} as TranscriptionPolicy;

describe('STTStrategyFactory explicit real-engine E2E lane', () => {
  beforeEach(() => {
    window.__SS_E2E__ = {
      isActive: true,
      engineType: 'mock',
      registry: {},
    };
  });

  it('keeps ordinary test runs fail-closed when their deterministic mock is missing', () => {
    expect(() => STTStrategyFactory.create('native', options, policy))
      .toThrow(/Missing mock for engine key "native-browser"/);
  });

  it('constructs the production Browser engine only for an explicit real-engine lane', () => {
    window.__SS_E2E__!.engineType = 'real';

    expect(STTStrategyFactory.create('native', options, policy)).toBeInstanceOf(NativeBrowser);
  });
});
