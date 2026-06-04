/**
 * Private model-eval flag + telemetry contract (model-eval lane).
 *
 * OFF by default — resolves to `PRIV_STT_MODELS.DEFAULT` (current production whisper-tiny.en),
 * so the default Private path is byte-identical. The test agent overrides the model for an
 * A/B run via either:
 *   - `window.__PRIVATE_MODEL__ = 'distil-small.en'`
 *   - URL `?privateModel=distil-small.en`
 * Unknown values fall back to the default (no blind/unsafe switch). Selection is validated
 * against `PRIV_STT_MODELS.CANDIDATES`.
 *
 * Side-effect-free + dependency-free so it can be imported on the main thread and passed
 * into the worker init message (the worker has no `window`/URL of its own).
 */
import { PRIV_STT_MODELS } from '../sttConstants';

export type PrivateModelKey = keyof typeof PRIV_STT_MODELS.CANDIDATES;

declare global {
  interface Window {
    __PRIVATE_MODEL__?: string;
    /** Published per Private session for the model-eval A/B harness (test-only). */
    __PRIVATE_MODEL_TELEMETRY__?: PrivateModelTelemetry;
  }
}

export interface PrivateModelTelemetry {
  /** The resolved model key actually loaded. */
  model: PrivateModelKey;
  /** Approx download size (MB) for the resolved model. */
  approxMB: number;
  /** True when a non-default model was explicitly selected for this session. */
  overridden: boolean;
  /** Measured model load time (ms); null until loaded. */
  loadTimeMs: number | null;
}

function isCandidate(value: string): value is PrivateModelKey {
  return Object.prototype.hasOwnProperty.call(PRIV_STT_MODELS.CANDIDATES, value);
}

/** Resolve the selected Private model key (default when unset/invalid). */
export function resolvePrivateModel(): PrivateModelKey {
  const def = PRIV_STT_MODELS.DEFAULT as PrivateModelKey;
  if (typeof window === 'undefined') return def;

  const fromWindow = window.__PRIVATE_MODEL__;
  if (typeof fromWindow === 'string' && isCandidate(fromWindow)) return fromWindow;

  try {
    const fromQuery = new URLSearchParams(window.location.search).get('privateModel');
    if (fromQuery && isCandidate(fromQuery)) return fromQuery;
  } catch {
    /* ignore */
  }
  return def;
}

/** True when a non-default model is explicitly selected. */
export function isPrivateModelOverridden(): boolean {
  return resolvePrivateModel() !== (PRIV_STT_MODELS.DEFAULT as PrivateModelKey);
}

/** Publish the model-eval telemetry snapshot (test-only; no behavior impact). */
export function publishPrivateModelTelemetry(telemetry: PrivateModelTelemetry): void {
  if (typeof window === 'undefined') return;
  window.__PRIVATE_MODEL_TELEMETRY__ = telemetry;
}
