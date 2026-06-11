/**
 * Private model-eval flag + telemetry contract (model-eval lane).
 *
 * OFF by default — resolves to `PRIV_STT_MODELS.DEFAULT` (Private release default whisper-base.en),
 * so the default Private path is byte-identical. The test agent overrides the model for an
 * A/B run via either:
 *   - `window.__PRIVATE_MODEL__ = 'whisper-small.en'`
 *   - URL `?privateModel=whisper-small.en`
 * Selection is validated against `PRIV_STT_MODELS.CANDIDATES`. A session that explicitly requests
 * an UNKNOWN model is rejected at start (`assertValidPrivateModelSelection`) rather than silently
 * falling back to tiny — the silent fallback previously made invalid `?privateModel=…` requests look
 * honored (STT-P6-HUMAN). `resolvePrivateModel()` itself stays total (returns the default) so the
 * no-flag default path is byte-identical.
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

export type PrivateModelSelectionSource = 'default' | 'window' | 'url';

export interface PrivateModelTelemetry {
  /** The resolved model key actually loaded. */
  model: PrivateModelKey;
  /** The runtime that loaded it — always the local transformers-js (v2) engine for these candidates. */
  runtime: 'transformers-js';
  /** Approx download size (MB) for the resolved model. */
  approxMB: number;
  /** True when a non-default model was explicitly selected for this session. */
  overridden: boolean;
  /** How the model was selected this session (flag/URL/default). */
  selectionSource: PrivateModelSelectionSource;
  /** Measured model load time (ms); null until loaded. */
  loadTimeMs: number | null;
  /** The load fallback that applies: default tiny is bundled (local→remote); candidates are remote-only. */
  fallbackPath: 'local-then-remote' | 'remote-only';
  /** Privacy invariant: Private STT must NEVER attempt a Cloud fallback. Always false. */
  cloudFallbackAttempted: false;
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

/** The raw requested model flag (window then URL), or null when none was provided. */
export function getRequestedPrivateModel(): string | null {
  if (typeof window === 'undefined') return null;
  if (typeof window.__PRIVATE_MODEL__ === 'string' && window.__PRIVATE_MODEL__.length > 0) {
    return window.__PRIVATE_MODEL__;
  }
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('privateModel');
    if (fromQuery && fromQuery.length > 0) return fromQuery;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Reject an explicitly-requested-but-unsupported Private model instead of silently falling back to
 * the default (tiny). No flag, or a valid candidate → no-op; an unknown flag value → throw a
 * descriptive MODEL_LOAD_FAILED. Call once at Private session start. (STT-P6-HUMAN: a silent tiny
 * fallback made `?privateModel=…` look honored when it was not, so base-vs-tiny proofs were invalid.)
 */
export function assertValidPrivateModelSelection(): void {
  const requested = getRequestedPrivateModel();
  if (requested !== null && !isCandidate(requested)) {
    const supported = Object.keys(PRIV_STT_MODELS.CANDIDATES).join(', ');
    throw new Error(
      `MODEL_LOAD_FAILED: requested Private model "${requested}" is not supported ` +
        `(supported: ${supported}). Not falling back to ${PRIV_STT_MODELS.DEFAULT}.`,
    );
  }
}

/** Where the model selection came from this session: window flag, URL param, or the default. */
export function resolvePrivateModelSource(): PrivateModelSelectionSource {
  if (typeof window === 'undefined') return 'default';
  if (typeof window.__PRIVATE_MODEL__ === 'string' && isCandidate(window.__PRIVATE_MODEL__)) return 'window';
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('privateModel');
    if (fromQuery && isCandidate(fromQuery)) return 'url';
  } catch {
    /* ignore */
  }
  return 'default';
}

/** Publish the model-eval telemetry snapshot (test-only; no behavior impact). */
export function publishPrivateModelTelemetry(telemetry: PrivateModelTelemetry): void {
  if (typeof window === 'undefined') return;
  window.__PRIVATE_MODEL_TELEMETRY__ = telemetry;
}
