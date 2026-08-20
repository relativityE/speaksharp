/**
 * #1045 / #1033 — Private metadata propagation regression guard.
 *
 * Root cause of Private sessions recording `attribution_status='unverified'` (→ ineligible for Progress):
 * `PrivateSTT.getMetadata()` returns a complete tuple, but the production wrapper `PrivateWhisper` did
 * NOT delegate `getMetadata()`, so `TranscriptionService.getMetadata()` (which asks the OUTER strategy)
 * fell back to null and `captureFinalizingIdentity` could not confirm the engine tuple.
 *
 * This is a REAL-WRAPPER COMPOSITION test: it does NOT exercise `STTStrategyFactory` (the suite globally
 * mocks the PrivateWhisper module — see tests/setup.ts). It manually composes the production wiring
 * (`new PrivateWhisper(options, new PrivateSTT(options))` via `vi.importActual` for the real wrapper) and
 * injects it as `service.strategy`, then asserts the EXACT Private-v2 identity flows through — so an
 * incorrect or blank tuple cannot pass. Metadata itself is never mocked.
 *
 * Scope is Private only: the browser's Web Speech API does not expose a provable provider/model identity
 * (it may use browser-vendor servers), so Native/Browser stays honestly `unverified` — #1037 will
 * establish its evidence boundary. Eligibility remains verified-only.
 */
import { describe, it, expect, vi } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import type { STTStrategy } from '../STTStrategy';
import { PrivateSTT } from '../engines/PrivateSTT';
import type { TranscriptionModeOptions } from '../modes/types';
import type { NavigateFunction } from 'react-router-dom';

/** The exact durable identity a default Private-v2 (whisper-base.en) recording must carry. */
const EXPECTED_PRIVATE_V2 = {
  engineVersion: 'private_v2:whisper-base.en',
  modelName: 'whisper-base.en',
  deviceType: 'browser',
} as const;

const options = {
  onTranscriptUpdate: () => {},
  onModelLoadProgress: () => {},
  onReady: () => {},
  serviceId: 'metadata-test',
  runId: 'metadata-test',
} as unknown as TranscriptionModeOptions;

/** The REAL PrivateWhisper wrapper (tests/setup.ts globally mocks the module for the rest of the suite). */
async function realPrivateWhisper(): Promise<STTStrategy> {
  const mod = await vi.importActual<typeof import('../modes/PrivateWhisper')>('../modes/PrivateWhisper');
  const PrivateWhisper = mod.default;
  return new PrivateWhisper(options, new PrivateSTT(options)) as unknown as STTStrategy;
}

describe('#1045 Private metadata propagation (verified attribution)', () => {
  it('the Private ENGINE returns the exact Private-v2 tuple (source of truth)', () => {
    const engine = new PrivateSTT(options);
    expect(engine.getMetadata()).toEqual(EXPECTED_PRIVATE_V2);
  });

  it('the REAL PrivateWhisper wrapper DELEGATES the exact engine tuple (the fix)', async () => {
    const strat = (await realPrivateWhisper()) as unknown as { getMetadata?: () => unknown };
    expect(typeof strat.getMetadata, 'PrivateWhisper must expose getMetadata').toBe('function');
    expect(strat.getMetadata!()).toEqual(EXPECTED_PRIVATE_V2);
  });

  it('TranscriptionService.getMetadata() returns the exact Private tuple through the real wrapper (no null fallback)', async () => {
    const service = new TranscriptionService({
      onTranscriptUpdate: vi.fn(),
      onModelLoadProgress: vi.fn(),
      onReady: vi.fn(),
      session: null,
      navigate: vi.fn() as unknown as NavigateFunction,
      getAssemblyAIToken: vi.fn(),
    });
    (service as unknown as { strategy: STTStrategy }).strategy = await realPrivateWhisper();
    expect(service.getMetadata()).toEqual(EXPECTED_PRIVATE_V2);
  });
});
