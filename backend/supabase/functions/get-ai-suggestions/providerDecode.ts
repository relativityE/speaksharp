/**
 * #1258 (PO 2026-10-12) — DECODE THE PROVIDER'S ANSWER, NEVER COPY IT.
 *
 * Alpha runs on 9fc1072ea recorded a coaching failure only as `provider_timeout` or a bare HTTP status, so a Gemini rate
 * limit, a rejected request, a revoked key and an overloaded model all looked alike. Gemini states its reason in fields
 * drawn from CLOSED vocabularies: `error.status` (the google.rpc canonical code), `error.details[].reason`
 * (google.rpc.ErrorInfo), `candidates[0].finishReason`, `promptFeedback.blockReason`, and the numeric `usageMetadata`.
 *
 * Only those fields are read, and each is kept only when it is a member of its CLOSED vocabulary; anything else becomes
 * `other`. (PM RETURN 6134462030: an UPPER_SNAKE shape check let a provider-chosen token such as SECRET_TRANSCRIPT_WORDS
 * through unchanged, so ErrorInfo reasons are admitted only from the documented list below.) The free-text `error.message` and every other body field are
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

/**
 * The documented `google.api.ErrorReason` values (googleapis/google/api/error_reason.proto), which Google APIs, Gemini
 * included, report as the ErrorInfo `reason`. Only these pass; any other reason, whatever its shape, becomes `other`.
 */
export const PROVIDER_ERROR_INFO_REASONS = [
  'SERVICE_DISABLED', 'BILLING_DISABLED', 'API_KEY_INVALID', 'API_KEY_SERVICE_BLOCKED', 'API_KEY_HTTP_REFERRER_BLOCKED',
  'API_KEY_IP_ADDRESS_BLOCKED', 'API_KEY_ANDROID_APP_BLOCKED', 'API_KEY_IOS_APP_BLOCKED', 'RATE_LIMIT_EXCEEDED',
  'RESOURCE_QUOTA_EXCEEDED', 'LOCATION_TAX_POLICY_VIOLATION', 'USER_PROJECT_DENIED', 'CONSUMER_SUSPENDED',
  'CONSUMER_INVALID', 'SECURITY_POLICY_VIOLATED', 'ACCESS_TOKEN_EXPIRED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  'ACCOUNT_STATE_INVALID', 'ACCESS_TOKEN_TYPE_UNSUPPORTED', 'CREDENTIALS_MISSING', 'RESOURCE_PROJECT_INVALID',
  'SESSION_COOKIE_INVALID', 'USER_BLOCKED_BY_ADMIN', 'RESOURCE_USAGE_RESTRICTION_VIOLATED', 'SYSTEM_PARAMETER_UNSUPPORTED',
  'ORG_RESTRICTION_VIOLATION', 'ORG_RESTRICTION_HEADER_INVALID', 'SERVICE_NOT_VISIBLE', 'GCP_SUSPENDED',
  'LOCATION_POLICY_VIOLATED', 'MISSING_ORIGIN', 'OVERLOADED_CREDENTIALS',
] as const;
const ERROR_INFO_TYPE = 'type.googleapis.com/google.rpc.ErrorInfo';
/** Bound the bytes read from an error body before parsing; Gemini's error JSON is far smaller. */
export const PROVIDER_ERROR_BODY_MAX_BYTES = 16_384;
const TOKEN_COUNT_MAX = 10_000_000;

export interface ProviderErrorCodes {
  /** The canonical code, `other` when present but unknown, `unparseable` when the body is not Gemini's error JSON. */
  error_status: (typeof PROVIDER_ERROR_STATUSES)[number] | 'other' | 'unparseable';
  /** The first ErrorInfo reason, `other` when it is not a documented ErrorReason, null when none is given. */
  error_reason: (typeof PROVIDER_ERROR_INFO_REASONS)[number] | 'other' | null;
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
  let reason: ProviderErrorCodes['error_reason'] = null;
  if (Array.isArray(details)) {
    const info = details.find((d) => d && typeof d === 'object' && (d as { '@type'?: unknown })['@type'] === ERROR_INFO_TYPE);
    reason = member(PROVIDER_ERROR_INFO_REASONS, info ? (info as { reason?: unknown }).reason : undefined);
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

/**
 * #1258 (Codex P2 r4289041570, PM 6204153627) — the WHOLE diagnostic error-body read is bounded by this one deadline, so
 * decoding a provider's error never extends the failure path (a 5xx whose body stalls or trickles must not hold the retry).
 */
export const PROVIDER_ERROR_BODY_DEADLINE_MS = 1_000;

/**
 * Read at most `PROVIDER_ERROR_BODY_MAX_BYTES` of a body as text, within ONE deadline for the whole read (not per chunk).
 * Anything over the byte ceiling, a read failure, or the deadline returns null — the caller's closed "unparseable" path.
 * Cancellation is requested but never awaited, so a `cancel()` that never settles cannot hold the return; late read or
 * cancel rejections are absorbed, and nothing is logged.
 */
export async function readBoundedBody(response: Response, deadlineMs: number = PROVIDER_ERROR_BODY_DEADLINE_MS): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let stopped = false;
  const release = () => {
    stopped = true;
    reader.cancel().catch(() => undefined);
  };
  const consume = async (): Promise<Uint8Array[] | null> => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (!stopped && size <= PROVIDER_ERROR_BODY_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (stopped) return null;
      if (done || !value) return chunks;
      chunks.push(value);
      size += value.byteLength;
    }
    return stopped || size > PROVIDER_ERROR_BODY_MAX_BYTES ? null : chunks;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reading = consume().catch(() => null);
  const deadline = new Promise<'deadline'>((resolve) => { timer = setTimeout(() => resolve('deadline'), deadlineMs); });
  try {
    const outcome = await Promise.race([reading, deadline]);
    if (outcome === 'deadline' || outcome === null) return null;
    let total = 0;
    for (const chunk of outcome) total += chunk.byteLength;
    if (total > PROVIDER_ERROR_BODY_MAX_BYTES) return null;
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of outcome) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  } finally {
    clearTimeout(timer);
    release();
  }
}
