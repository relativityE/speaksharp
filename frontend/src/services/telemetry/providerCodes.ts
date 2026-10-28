/**
 * #1258 (PO 2026-10-12) — the coaching provider's own closed codes, as the Edge diagnostic reports them
 * (`backend/supabase/functions/get-ai-suggestions/providerDecode.ts`). The client re-checks every value against the same
 * vocabularies before it reaches analytics, so a server bug can never forward free text. Parity with the Edge lists is
 * pinned by `providerCodes.test.ts`.
 */
export const PROVIDER_ERROR_STATUSES = [
    'CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED',
    'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE',
    'DATA_LOSS', 'UNAUTHENTICATED', 'other', 'unparseable',
] as const;
export const PROVIDER_FINISH_REASONS = [
    'FINISH_REASON_UNSPECIFIED', 'STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'LANGUAGE', 'OTHER', 'BLOCKLIST',
    'PROHIBITED_CONTENT', 'SPII', 'MALFORMED_FUNCTION_CALL', 'IMAGE_SAFETY', 'other',
] as const;
export const PROVIDER_BLOCK_REASONS = [
    'BLOCK_REASON_UNSPECIFIED', 'SAFETY', 'OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY', 'other',
] as const;
/** One provider attempt's outcome: the server's closed failure reason, or `none` for an attempt that answered. */
export const PROVIDER_ATTEMPT_REASONS = [
    'none', 'provider_http_4xx', 'provider_http_5xx', 'provider_transport', 'provider_timeout', 'missing_text',
    'invalid_shape', 'over_character_ceiling', 'missing_model_version', 'request_cancelled', 'provider_malformed_response',
] as const;
/** #1258 option A: the retry wait ceiling the Edge budget allows, and the clamp the Edge applies to `retry_after_s`. */
export const PROVIDER_WAIT_MS_MAX = 600_000;
export const RETRY_AFTER_S_MAX = 60;
/** The documented google.api.ErrorReason values (PM RETURN 6134462030: a closed list, never a shape check). */
export const PROVIDER_ERROR_INFO_REASONS = [
    'SERVICE_DISABLED', 'BILLING_DISABLED', 'API_KEY_INVALID', 'API_KEY_SERVICE_BLOCKED', 'API_KEY_HTTP_REFERRER_BLOCKED',
    'API_KEY_IP_ADDRESS_BLOCKED', 'API_KEY_ANDROID_APP_BLOCKED', 'API_KEY_IOS_APP_BLOCKED', 'RATE_LIMIT_EXCEEDED',
    'RESOURCE_QUOTA_EXCEEDED', 'LOCATION_TAX_POLICY_VIOLATION', 'USER_PROJECT_DENIED', 'CONSUMER_SUSPENDED',
    'CONSUMER_INVALID', 'SECURITY_POLICY_VIOLATED', 'ACCESS_TOKEN_EXPIRED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
    'ACCOUNT_STATE_INVALID', 'ACCESS_TOKEN_TYPE_UNSUPPORTED', 'CREDENTIALS_MISSING', 'RESOURCE_PROJECT_INVALID',
    'SESSION_COOKIE_INVALID', 'USER_BLOCKED_BY_ADMIN', 'RESOURCE_USAGE_RESTRICTION_VIOLATED', 'SYSTEM_PARAMETER_UNSUPPORTED',
    'ORG_RESTRICTION_VIOLATION', 'ORG_RESTRICTION_HEADER_INVALID', 'SERVICE_NOT_VISIBLE', 'GCP_SUSPENDED',
    'LOCATION_POLICY_VIOLATED', 'MISSING_ORIGIN', 'OVERLOADED_CREDENTIALS', 'other',
] as const;
export const PROVIDER_TOKEN_MAX = 10_000_000;

/** Display-only fixed catalog. Never display a server/provider's free-text error. */
export const COACHING_CANONICAL_ERROR_STRINGS = Object.freeze({
    CANCELLED: 'The operation was cancelled.',
    UNKNOWN: 'Unknown error.',
    INVALID_ARGUMENT: 'The request contains an invalid argument.',
    DEADLINE_EXCEEDED: 'The service deadline was exceeded.',
    NOT_FOUND: 'The requested resource was not found.',
    ALREADY_EXISTS: 'The requested resource already exists.',
    PERMISSION_DENIED: 'The service denied permission for this request.',
    RESOURCE_EXHAUSTED: 'A service resource limit was reached.',
    FAILED_PRECONDITION: 'A required service precondition was not met.',
    ABORTED: 'The operation was aborted.',
    OUT_OF_RANGE: 'A request value is outside its allowed range.',
    UNIMPLEMENTED: 'The requested operation is not supported.',
    INTERNAL: 'The service reported an internal error.',
    UNAVAILABLE: 'The service is temporarily unavailable.',
    DATA_LOSS: 'The service reported unrecoverable data loss.',
    UNAUTHENTICATED: 'The service could not authenticate the request.',
});

/** Closed provenance must agree with the outer verdict and existing scalar diagnostics. */
export function coachingErrorMessage(server: Record<string, unknown> | null, wireCode: unknown, outerStatus: number | null): string | null {
    if (outerStatus !== 502 || server?.status !== outerStatus || typeof wireCode !== 'string'
        || server.reason !== wireCode) return null;
    const value = server.error_descriptor;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const d = value as Record<string, unknown>;
    const keys = Object.keys(d).sort();
    if (keys.join(',') !== 'canonical_status,http_status,local_code,origin') return null;
    const http = d.http_status;
    const validHttp = http === null || (Number.isInteger(http) && Number(http) >= 100 && Number(http) <= 599);
    if (!validHttp) return null;
    if (d.origin === 'local_timeout') return wireCode === 'provider_timeout' && d.local_code === wireCode
        && http === null && d.canonical_status === null ? 'The local coaching deadline was exceeded.' : null;
    if (http !== server.provider_status) return null;
    if (d.origin === 'local_normalization') {
        const reasons = ['provider_http_4xx', 'provider_http_5xx', 'missing_text', 'invalid_shape',
            'over_character_ceiling', 'missing_model_version', 'provider_malformed_response'];
        if (d.canonical_status !== 'UNKNOWN' || d.local_code !== wireCode || !reasons.includes(wireCode)) return null;
        if ((wireCode === 'provider_http_4xx' || wireCode === 'provider_http_5xx')
            && server.provider_error_status !== 'other' && server.provider_error_status !== 'unparseable') return null;
        return 'Unknown error.';
    }
    if (d.origin !== 'provider' || d.local_code !== null || typeof d.canonical_status !== 'string'
        || !Object.prototype.hasOwnProperty.call(COACHING_CANONICAL_ERROR_STRINGS, d.canonical_status)
        || d.canonical_status !== server.provider_error_status || typeof http !== 'number' || http < 400
        || wireCode !== (http >= 500 ? 'provider_http_5xx' : 'provider_http_4xx')) return null;
    if (d.canonical_status === 'RESOURCE_EXHAUSTED') {
        if (http === 402) return 'The service credit balance is depleted.';
        if (http === 429) return 'The service rate limit was exceeded.';
    }
    return COACHING_CANONICAL_ERROR_STRINGS[d.canonical_status as keyof typeof COACHING_CANONICAL_ERROR_STRINGS];
}

export interface ProviderCodeFields {
    provider_error_status: (typeof PROVIDER_ERROR_STATUSES)[number] | null;
    provider_error_reason: (typeof PROVIDER_ERROR_INFO_REASONS)[number] | null;
    provider_finish_reason: (typeof PROVIDER_FINISH_REASONS)[number] | null;
    provider_block_reason: (typeof PROVIDER_BLOCK_REASONS)[number] | null;
    provider_prompt_tokens: number | null;
    provider_output_tokens: number | null;
    provider_thinking_tokens: number | null;
    provider_total_tokens: number | null;
    attempt_1_reason: (typeof PROVIDER_ATTEMPT_REASONS)[number] | null;
    attempt_1_status: number | null;
    attempt_1_ms: number | null;
    attempt_2_reason: (typeof PROVIDER_ATTEMPT_REASONS)[number] | null;
    attempt_2_status: number | null;
    attempt_2_ms: number | null;
    attempt_3_reason: (typeof PROVIDER_ATTEMPT_REASONS)[number] | null;
    attempt_3_status: number | null;
    attempt_3_ms: number | null;
    /** #1258 option A — content-free retry facts; never the Retry-After header's raw value. */
    provider_wait_ms_total: number | null;
    retry_after_present: boolean | null;
    retry_after_malformed: boolean | null;
    retry_after_s: number | null;
    stopped_over_budget: boolean | null;
}

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null =>
    typeof value === 'string' && (list as readonly string[]).includes(value) ? value as T : null;
const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
const int = (value: unknown, min: number, max: number): number | null =>
    Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : null;

/** Every provider code field, re-validated; an unknown or malformed value is null, never forwarded. */
export function providerCodeFields(server: Record<string, unknown> | null): ProviderCodeFields {
    return {
        provider_error_status: oneOf(PROVIDER_ERROR_STATUSES, server?.provider_error_status),
        provider_error_reason: oneOf(PROVIDER_ERROR_INFO_REASONS, server?.provider_error_reason),
        provider_finish_reason: oneOf(PROVIDER_FINISH_REASONS, server?.provider_finish_reason),
        provider_block_reason: oneOf(PROVIDER_BLOCK_REASONS, server?.provider_block_reason),
        provider_prompt_tokens: int(server?.provider_prompt_tokens, 0, PROVIDER_TOKEN_MAX),
        provider_output_tokens: int(server?.provider_output_tokens, 0, PROVIDER_TOKEN_MAX),
        provider_thinking_tokens: int(server?.provider_thinking_tokens, 0, PROVIDER_TOKEN_MAX),
        provider_total_tokens: int(server?.provider_total_tokens, 0, PROVIDER_TOKEN_MAX),
        attempt_1_reason: oneOf(PROVIDER_ATTEMPT_REASONS, server?.attempt_1_reason),
        attempt_1_status: int(server?.attempt_1_status, 100, 599),
        attempt_1_ms: int(server?.attempt_1_ms, 0, 600_000),
        attempt_2_reason: oneOf(PROVIDER_ATTEMPT_REASONS, server?.attempt_2_reason),
        attempt_2_status: int(server?.attempt_2_status, 100, 599),
        attempt_2_ms: int(server?.attempt_2_ms, 0, 600_000),
        attempt_3_reason: oneOf(PROVIDER_ATTEMPT_REASONS, server?.attempt_3_reason),
        attempt_3_status: int(server?.attempt_3_status, 100, 599),
        attempt_3_ms: int(server?.attempt_3_ms, 0, 600_000),
        provider_wait_ms_total: int(server?.provider_wait_ms_total, 0, PROVIDER_WAIT_MS_MAX),
        retry_after_present: bool(server?.retry_after_present),
        retry_after_malformed: bool(server?.retry_after_malformed),
        retry_after_s: int(server?.retry_after_s, 0, RETRY_AFTER_S_MAX),
        stopped_over_budget: bool(server?.stopped_over_budget),
    };
}
