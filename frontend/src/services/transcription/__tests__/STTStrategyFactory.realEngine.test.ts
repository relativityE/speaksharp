import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../STTRegistry', () => ({
  getEngine: vi.fn(() => undefined),
}));

import { STTStrategyFactory } from '../STTStrategyFactory';
import type { TranscriptionModeOptions } from '../modes/types';
import type { TranscriptionPolicy } from '../TranscriptionPolicy';

const options = {
  onReady: vi.fn(),
  onError: vi.fn(),
  onTranscriptUpdate: vi.fn(),
} as unknown as TranscriptionModeOptions;

const policy = {} as TranscriptionPolicy;

// #1320: Native/Web-Speech is retired, so the native-browser real-engine escape hatch is gone. There is
// now NO real-engine hatch at all — every test mode requires a registered mock or fails closed. These
// guards lock that boundary so a manifest can never silently construct a real engine.
describe('STTStrategyFactory fail-closed boundary (no real-engine hatch)', () => {
  beforeEach(() => {
    window.__SS_E2E__ = {
      isActive: true,
      engineType: 'mock',
      registry: {},
    };
  });

  it('keeps ordinary test runs fail-closed when their deterministic mock is missing', () => {
    expect(() => STTStrategyFactory.create('private', options, policy))
      .toThrow(/Missing mock for engine key/);
  });

  it('stays fail-closed for Private even in an explicit real lane — never constructs a real engine', () => {
    window.__SS_E2E__!.engineType = 'real';
    expect(() => STTStrategyFactory.create('private', options, policy)).toThrow(/Missing mock for engine key/);
  });
});
