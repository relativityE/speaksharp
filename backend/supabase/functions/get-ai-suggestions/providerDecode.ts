/**
 * #1258 (PO 2026-10-12) — DECODE THE PROVIDER'S ANSWER, NEVER COPY IT.
 *
 * Alpha runs on 9fc1072ea recorded a coaching failure only as `provider_timeout` or a bare HTTP status, so a Gemini rate
 * limit, a rejected request, a revoked key and an overloaded model all looked alike. Gemini states its reason in fields
 * drawn from CLOSED vocabularies: `error.status` (the google.rpc canonical code), `error.details[].reason`
 * (google.rpc.ErrorInfo), `candidates[0].finishReason`, `promptFeedback.blockReason`, and the numeric `usageMetadata`.
 *
 * Only those fields are read, and each is kept only when it is a member of its vocabulary (or, for ErrorInfo reasons,
 * an UPPER_SNAKE token): anything else becomes `other`. The free-text `error.message` and every other body field are
 * never read into a variable, logged or returned — the #1258 rule that the provider's body can echo anything stands.
 */

/** google.rpc.Code names, as Gemini returns them in `error.status`. */
export const PROVIDER_ERROR_STATUSES = [
  'CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE',
  'DATA_LOSS', 'UNAUTHENTICATED',
] as const;
export const PROVIDER_FINISH_REASONS = [
  'FINISH_REASON_UNSPECIFIED', 'STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'LANGUAGE', 'OTHER', 'BLOCKLIST',
  'PROHIBITED_CONTENT', 'SPII', 'MALFORMED_FUNCTION_CALL', 'IMAGE_SAFETY',
] as const;
export const PROVIDER_BLOCK_REASONS = [
  'BLOCK_REASON_UNSPECIFIED', 'SAFETY', 'OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY',
] as const;

/** An ErrorInfo reason is an UPPER_SNAKE identifier (e.g. RATE_LIMIT_EXCEEDED, API_KEY_INVALID). Nothing else passes. */
const ERROR_INFO_REASON = /^[A-Z][A-Z0-9_]{1,63}$/;
const ERROR_INFO_TYPE = 'type.googleapis.com/google.rpc.ErrorInfo';
/** Bound the bytes read from an error body before parsing; Gemini's error JSON is far smaller. */
export const PROVIDER_ERROR_BODY_MAX_BYTES = 16_384;
const TOKEN_COUNT_MAX = 10_000_000;

export interface ProviderErrorCodes {
  /** The canonical code, `other` when present but unknown, `unparseable` when the body is not Gemini's error JSON. */
  error_status: (typeof PROVIDER_ERROR_STATUSES)[number] | 'other' | 'unparseable';
  /** The first ErrorInfo reason, `other` when it is not an UPPER_SNAKE token, null when none is given. */
  error_reason: string | null;
}

export interface ProviderAnswerCodes {
  finish_reason: (typeof PROVIDER_FINISH_REASONS)[number] | 'other' | null;
  block_reason: (typeof PROVIDER_BLOCK_REASONS)[number] | 'other' | null;
  prompt_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens: number | null;
  total_tokens: number | null;
}

const member = <T extends string>(list: readonly T[], value: unknown): T | 'other' | null => {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? value as T : 'other';
};

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= TOKEN_COUNT_MAX ? value : null;

/** Classify a non-OK provider body. Only `error.status` and ErrorInfo `reason` are read. */
export function decodeProviderError(bodyText: string | null): ProviderErrorCodes {
  let parsed: unknown;
  try {
    parsed = bodyText === null ? null : JSON.parse(bodyText);
  } catch {
    return { error_status: 'unparseable', error_reason: null };
  }
  const error = (parsed as { error?: unknown } | null)?.error;
  if (!error || typeof error !== 'object') return { error_status: 'unparseable', error_reason: null };
  const status = member(PROVIDER_ERROR_STATUSES, (error as { status?: unknown }).status);
  const details = (error as { details?: unknown }).details;
  let reason: string | null = null;
  if (Array.isArray(details)) {
    const info = details.find((d) => d && typeof d === 'object' && (d as { '@type'?: unknown })['@type'] === ERROR_INFO_TYPE);
    const raw = info ? (info as { reason?: unknown }).reason : undefined;
    if (raw !== undefined && raw !== null) reason = typeof raw === 'string' && ERROR_INFO_REASON.test(raw) ? raw : 'other';
  }
  return { error_status: status ?? 'unparseable', error_reason: reason };
}

/** Classify an OK provider answer. Only the finish/block reasons and the token counts are read. */
export function decodeProviderAnswer(responseData: unknown): ProviderAnswerCodes {
  const data = (responseData && typeof responseData === 'object' ? responseData : {}) as {
    candidates?: Array<{ finishReason?: unknown }>;
    promptFeedback?: { blockReason?: unknown };
    usageMetadata?: Record<string, unknown>;
  };
  const usage = data.usageMetadata && typeof data.usageMetadata === 'object' ? data.usageMetadata : {};
  return {
    finish_reason: member(PROVIDER_FINISH_REASONS, Array.isArray(data.candidates) ? data.candidates[0]?.finishReason : undefined),
    block_reason: member(PROVIDER_BLOCK_REASONS, data.promptFeedback?.blockReason),
    prompt_tokens: count(usage.promptTokenCount),
    output_tokens: count(usage.candidatesTokenCount),
    thinking_tokens: count(usage.thoughtsTokenCount),
    total_tokens: count(usage.totalTokenCount),
  };
}

/** Read at most `PROVIDER_ERROR_BODY_MAX_BYTES` of a body as text; the rest is cancelled, never buffered. */
export async function readBoundedBody(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < PROVIDER_ERROR_BODY_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (size > PROVIDER_ERROR_BODY_MAX_BYTES) return null;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
