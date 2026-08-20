export type CanaryStartRpcPayload = {
    error?: unknown;
    new_session?: unknown;
    usage_exceeded?: unknown;
};

export type CanaryStartOutcome =
    | { ok: true; sessionId: string }
    | { ok: false; category: string };

export type CanaryUsagePayload = {
    subscription_status?: unknown;
    is_pro?: unknown;
    can_start?: unknown;
    error?: unknown;
    trial_active?: unknown;
    trial_expires_at?: unknown;
};

export type CanaryAccessLane = 'active-trial' | 'paid-continuation';

export type CanaryUsageOutcome =
    | { ok: true }
    | { ok: false; category: string };

const SAFE_CATEGORY = /^[a-z0-9_]{1,80}$/;

/** Content-free category for CI output; never echo arbitrary database/API text. */
export function sanitizeCanaryDenialCategory(value: unknown): string {
    if (typeof value !== 'string') return 'unknown';
    const normalized = value.trim().toLowerCase();
    return SAFE_CATEGORY.test(normalized) ? normalized : 'unknown';
}

/** Classify the advisory usage response without reflecting provider/database text into CI. */
export function classifyCanaryUsageEntitlement(
    payload: CanaryUsagePayload,
    lane: CanaryAccessLane,
): CanaryUsageOutcome {
    if (payload.subscription_status !== 'pro') return { ok: false, category: 'subscription_status' };
    if (payload.is_pro !== true) return { ok: false, category: 'is_pro' };
    if (payload.can_start !== true) {
        return { ok: false, category: sanitizeCanaryDenialCategory(payload.error) };
    }
    if (lane === 'active-trial') {
        if (payload.trial_active !== true) return { ok: false, category: 'trial_inactive' };
        if (typeof payload.trial_expires_at !== 'string' || payload.trial_expires_at.trim().length === 0) {
            return { ok: false, category: 'trial_expiry_missing' };
        }
    } else if (payload.trial_active !== false) {
        return { ok: false, category: 'paid_marked_trial' };
    }
    return { ok: true };
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
