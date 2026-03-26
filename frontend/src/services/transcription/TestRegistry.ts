import { ITranscriptionEngine, TranscriptionModeOptions } from './modes/types';
import { SSE2EManifest } from '@/config/TestFlags';

/**
 * STRICT ZERO: Read-only Test Registry
 *
 * Registry must be pre-populated at T=0 via window.__SS_E2E__.
 * No runtime mutation allowed.
 */

type EngineFactory = (options: TranscriptionModeOptions) => ITranscriptionEngine;

function getManifest() {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { __SS_E2E__: SSE2EManifest }).__SS_E2E__;
}

/**
 * Retrieve engine factory
 */
export function getEngine(mode: string): EngineFactory | undefined {
  const manifest = getManifest();
  if (!manifest?.registry) return undefined;

  return (manifest.registry as Record<string, unknown>)[mode] as
    | EngineFactory
    | undefined;
}

/**
 * Returns the active engineType from the manifest.
 */
export function getEngineType(): string | undefined {
  return getManifest()?.engineType;
}
