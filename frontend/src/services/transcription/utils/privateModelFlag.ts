/**
 * Private model-eval flag + telemetry contract (model-eval lane).
 *
 * OFF by default — resolves to `PRIV_STT_MODELS.DEFAULT` (Private release default whisper-base.en),
 * so the default Private path is byte-identical. The test agent overrides the model for an
 * A/B run via either:
 *   (RETIRED: the window flag and `?privateModel=` selection were removed — see below.)
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

/**
 * The Private model key. ALWAYS the configured default — there is no per-visitor selection.
 *
 * This previously honoured `window.__PRIVATE_MODEL__` and `?privateModel=`, with NO dev/test gate, so
 * the parameter worked on the production site. That is two separate problems: a visitor could change
 * which model decoded their session, and the parameter names internal engine builds to anyone who
 * looks at a URL. Model selection is now one reviewable config value (see `candidateSelection`), so
 * both reads are gone rather than gated.
 */
export function resolvePrivateModel(): PrivateModelKey {
  return PRIV_STT_MODELS.DEFAULT as PrivateModelKey;
}

/** Retired: nothing can override the model per visitor any more, so this is always false. */
export function isPrivateModelOverridden(): boolean {
  return false;
}

/** Retired: there is no request channel left to read, so nothing is ever requested. */
export function getRequestedPrivateModel(): string | null {
  return null;
}

/**
 * Retired guard. It existed because a silent fallback made `?privateModel=` look honoured when it was
 * not. With the parameter gone there is no requested-but-unsupported state to reject: an unsupported
 * candidate is now refused at CONFIG selection, before a session starts.
 */
export function assertValidPrivateModelSelection(): void {
  /* no requested model can exist */
}

/** Where the model selection came from this session: window flag, URL param, or the default. */
export function resolvePrivateModelSource(): PrivateModelSelectionSource {
  return 'default';
}

/** Publish the model-eval telemetry snapshot (test-only; no behavior impact). */
export function publishPrivateModelTelemetry(telemetry: PrivateModelTelemetry): void {
  if (typeof window === 'undefined') return;
  window.__PRIVATE_MODEL_TELEMETRY__ = telemetry;
}
