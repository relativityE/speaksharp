/**
 * #1045 / #1033 — metadata propagation regression guard for the adapter-boundary omission that made every
 * Private/Native session `unverified`, hence ineligible for Progress.
 *
 * Root cause: `PrivateSTT.getMetadata()` returns a complete tuple, but the production wrapper
 * `PrivateWhisper` did NOT delegate `getMetadata()`, and `NativeBrowser` had none — so
 * `TranscriptionService.getMetadata()` (which asks the OUTER strategy) fell back to null and the verified
 * attribution tuple check failed. Cloud verified only because `CloudAssemblyAI` exposes `getMetadata()`.
 *
 * These tests exercise the REAL engine + REAL wrappers (not a stubbed strategy, no mocked metadata):
 *   - the Private ENGINE returns a complete tuple (the source of truth);
 *   - the REAL `PrivateWhisper` wrapper DELEGATES it (via vi.importActual, since tests/setup.ts globally
 *     mocks the wrapper for the rest of the suite);
 *   - the REAL `NativeBrowser` wrapper returns an honest on-device tuple;
 *   - `TranscriptionService.getMetadata()` returns those tuples through the controller boundary (no null).
 */
import { describe, it, expect, vi } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import type { STTStrategy } from '../STTStrategy';
import { PrivateSTT } from '../engines/PrivateSTT';
import RealNativeBrowser from '../modes/NativeBrowser';
import type { TranscriptionModeOptions } from '../modes/types';
import type { NavigateFunction } from 'react-router-dom';

type MetaTuple = { engineVersion: string; modelName: string; deviceType: string } | null | undefined;

const options = {
  onTranscriptUpdate: () => {},
  onModelLoadProgress: () => {},
  onReady: () => {},
  serviceId: 'metadata-test',
  runId: 'metadata-test',
} as unknown as TranscriptionModeOptions;

function assertCompleteTuple(meta: MetaTuple, label: string): void {
  expect(meta, `${label}: metadata must not be null (would record unverified)`).toBeTruthy();
  const m = meta as { engineVersion: string; modelName: string; deviceType: string };
  for (const field of ['engineVersion', 'modelName', 'deviceType'] as const) {
    expect(typeof m[field], `${label}: ${field} must be a string`).toBe('string');
    expect(m[field].trim().length, `${label}: ${field} must be non-blank`).toBeGreaterThan(0);
  }
}

/** The REAL PrivateWhisper wrapper (tests/setup.ts globally mocks the module for the rest of the suite). */
async function realPrivateWhisper(): Promise<STTStrategy> {
  const mod = await vi.importActual<typeof import('../modes/PrivateWhisper')>('../modes/PrivateWhisper');
  const PrivateWhisper = mod.default;
  return new PrivateWhisper(options, new PrivateSTT(options)) as unknown as STTStrategy;
}

describe('#1045 metadata propagation (verified attribution)', () => {
  it('the Private ENGINE returns a complete tuple (source of truth)', () => {
    const engine = new PrivateSTT(options);
    assertCompleteTuple(engine.getMetadata(), 'private-engine');
    expect(engine.getMetadata().deviceType).toBe('browser');
  });

  it('the REAL PrivateWhisper wrapper DELEGATES the engine tuple (the fix)', async () => {
    const strat = (await realPrivateWhisper()) as unknown as { getMetadata?: () => MetaTuple };
    expect(typeof strat.getMetadata, 'PrivateWhisper must expose getMetadata').toBe('function');
    assertCompleteTuple(strat.getMetadata!(), 'private-wrapper');
  });

  it('the REAL NativeBrowser wrapper returns an honest on-device tuple', () => {
    const nb = new RealNativeBrowser(options) as unknown as { getMetadata?: () => MetaTuple };
    expect(typeof nb.getMetadata, 'NativeBrowser must expose getMetadata').toBe('function');
    assertCompleteTuple(nb.getMetadata!(), 'native-wrapper');
    expect((nb.getMetadata!() as { deviceType: string }).deviceType).toBe('browser');
  });

  it('TranscriptionService.getMetadata() returns complete tuples for Private and Browser (no null fallback)', async () => {
    const service = new TranscriptionService({
      onTranscriptUpdate: vi.fn(),
      onModelLoadProgress: vi.fn(),
      onReady: vi.fn(),
      session: null,
      navigate: vi.fn() as unknown as NavigateFunction,
      getAssemblyAIToken: vi.fn(),
    });
    const strategies: Array<[string, STTStrategy]> = [
      ['private', await realPrivateWhisper()],
      ['native', new RealNativeBrowser(options) as unknown as STTStrategy],
    ];
    for (const [label, strat] of strategies) {
      (service as unknown as { strategy: STTStrategy }).strategy = strat;
      const meta = service.getMetadata() as MetaTuple;
      expect(meta, `service:${label}: getMetadata must not fall back to null`).not.toBeNull();
      assertCompleteTuple(meta, `service:${label}`);
    }
  });
});
