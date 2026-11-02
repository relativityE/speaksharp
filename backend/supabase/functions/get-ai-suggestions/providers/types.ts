import type { ProviderAnswerCodes, ProviderErrorCodes } from '../providerDecode.ts';

/**
 * PROVIDER-ADAPTER GROUNDWORK (not completed cross-provider drop-in support).
 *
 * One provider attempt, normalized. The handler owns everything around an attempt — quota-once, the retry budget and
 * waits, cancellation, classification of the answer text, model provenance rules and persistence — so swapping the
 * adapter cannot change those contracts. An adapter only turns (prompt, key, signal) into this closed result.
 *
 * Persisting a second provider still needs the follow-on SQL/frontend scope (the authority receipt CHECK allows
 * `google_gemini` only); the registry refuses any provider the database cannot persist.
 */
export interface ProviderAttemptResult {
  /** The HTTP status that actually arrived. */
  status: number;
  /** True for a 2xx answer. */
  ok: boolean;
  /** A non-2xx answer's closed error codes (decoded, never the body). */
  errorCodes: ProviderErrorCodes | null;
  /** A 2xx answer whose body could not be read as JSON (malformed, truncated or stalled). */
  bodyUnreadable: boolean;
  /** A readable 2xx answer: the candidate text (unvalidated — the handler classifies it), the safe model id, closed codes. */
  answer: { text: unknown; modelVersion: string | null; codes: ProviderAnswerCodes } | null;
}

export interface ProviderAttemptInput {
  prompt: string;
  apiKey: string;
  /** The caller's abort composed with this attempt's timeout. */
  signal: AbortSignal;
  /**
   * Called the moment an answer arrives, BEFORE any body is read, so a body that later fails still leaves the status and the wait
   * hint the handler already saw. `retryAfterHeader` is the raw Retry-After of a non-2xx answer (null when absent) — for the wait
   * decision only, never logged or returned — and `undefined` for a 2xx answer.
   */
  onResponse: (status: number, retryAfterHeader: string | null | undefined) => void;
}

export interface CoachingProvider {
  /** The persisted provider id (authority receipt, diagnostics). */
  readonly id: string;
  /** The NAME of the environment variable holding this provider's key; the value is read only by the handler. */
  readonly keyVariable: string;
  /** Throws exactly what the transport throws (an abort, a timeout, a network failure) — never a body or a key. */
  attempt(input: ProviderAttemptInput): Promise<ProviderAttemptResult>;
}

/** A model id safe to log and persist (unchanged from the handler's previous inline rule). */
export const SAFE_MODEL_ID = /^[A-Za-z0-9._:-]{1,128}$/;
