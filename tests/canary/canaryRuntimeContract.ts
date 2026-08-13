export type CanaryStartRpcPayload = {
    error?: unknown;
    new_session?: unknown;
    usage_exceeded?: unknown;
};

export type CanaryStartOutcome =
    | { ok: true; sessionId: string }
    | { ok: false; category: string };

const SAFE_CATEGORY = /^[a-z0-9_]{1,80}$/;

/** Content-free category for CI output; never echo arbitrary database/API text. */
export function sanitizeCanaryDenialCategory(value: unknown): string {
    if (typeof value !== 'string') return 'unknown';
    const normalized = value.trim().toLowerCase();
    return SAFE_CATEGORY.test(normalized) ? normalized : 'unknown';
}

/** Classify the authoritative create-session response before any secondary UI assertion. */
export function classifyCanaryStartResponse(
    status: number,
    payload: CanaryStartRpcPayload | null,
): CanaryStartOutcome {
    if (status < 200 || status >= 300) return { ok: false, category: `rpc_http_${status}` };
    if (!payload || typeof payload !== 'object') return { ok: false, category: 'rpc_invalid_response' };
    if (payload.usage_exceeded === true || payload.error != null) {
        return { ok: false, category: sanitizeCanaryDenialCategory(payload.error) };
    }
    const id = (payload.new_session as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
        return { ok: false, category: 'rpc_missing_session' };
    }
    return { ok: true, sessionId: id };
}
