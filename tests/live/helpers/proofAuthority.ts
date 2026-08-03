// #1089 / #1151 — pure decision helpers for the exact-SHA Private recording proof, extracted so each P1
// correction has a unit-level falsification test independent of the live run.

/**
 * The persisted Private-v2 identity records `device_type = 'browser'` — the recording runs in the browser
 * (the ENGINE is Private/Transformers.js-WASM, proven separately from the runtime). The persisted column is
 * exactly `'browser'`, NOT a value containing `wasm`.
 */
export function isPrivateV2PersistedDeviceType(value: unknown): boolean {
    return value === 'browser';
}

/**
 * Extract the authenticated user's UID from Supabase auth storage entries (localStorage `sb-*-auth-token`),
 * so cleanup authority is captured from the session IMMEDIATELY after signup — before any navigation or
 * list-users assertion that could fail and orphan the account. Supports both the object-session shape
 * (`{ user: { id } }` / `{ currentSession: { user: { id } } }`) and JWT `sub` fallback.
 */
export function extractUidFromAuthStorage(entries: Array<{ key: string; value: string }>): string | null {
    for (const { key, value } of entries) {
        if (!/sb-.*-auth-token/.test(key)) continue;
        let parsed: unknown;
        try { parsed = JSON.parse(value); } catch { continue; }
        const p = parsed as Record<string, unknown> & {
            user?: { id?: string };
            currentSession?: { user?: { id?: string }; access_token?: string };
            access_token?: string;
        };
        const direct = p?.user?.id ?? p?.currentSession?.user?.id ?? null;
        if (direct) return direct;
        const token = p?.access_token ?? p?.currentSession?.access_token ?? null;
        if (typeof token === 'string' && token.split('.').length === 3) {
            try {
                const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
                if (claims?.sub) return String(claims.sub);
            } catch { /* fall through */ }
        }
    }
    return null;
}

/**
 * After deleting the run-owned UID, ONLY the expected GoTrue not-found shape proves deletion: HTTP status
 * 404 AND a not-found code/message. A 500/401/429 that merely contains "user not found" text is NOT proof
 * (fail closed); network/auth/rate-limit errors likewise fail the run.
 */
export function isNotFoundError(error: { status?: number; code?: string; message?: string } | null | undefined): boolean {
    if (!error) return false;
    if (error.status !== 404) return false; // the documented not-found status is REQUIRED
    const s = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
    return /user_not_found|not[_\s-]?found|does not exist|no user/i.test(s);
}

/**
 * Structured Private producing-identity check for a LIVE recording. Uses the authoritative producing-mode
 * (`serviceMode` from `__SPEECH_RUNTIME_DEBUG__`) plus the STRUCTURED resolved engine identity
 * (`provider`/`engine` from `__STT_IDENTITY__`) and the Private model identity — NOT a stringify that would
 * wrongly reject the valid `device_type='browser'`. Requires ALL of:
 *   - producing mode is Private;
 *   - the resolved engine is the on-device **Transformers.js (WASM/WebGPU)** family — provider matches
 *     `transformers.js` and engine is `transformers-js` (v2) or `transformers-js-v4`. A generic `serviceMode`
 *     of 'private' is INSUFFICIENT: a mislabeled cloud / web-speech engine must be rejected here;
 *   - the default (non-tiny) Private model, i.e. NOT the emergency `whisper-tiny.en` fallback;
 *   - no runtime fallback/handoff (neither the v4 runtime fallback flag nor the engine identity's own
 *     `fallbackOccurred`).
 * Device type is intentionally NOT constrained here (the persisted row separately proves `device_type='browser'`).
 */
export function isPrivateRuntimeIdentity(input: {
    serviceMode?: unknown;
    privateModelKey?: unknown;
    fallbackOccurred?: unknown;
    provider?: unknown;
    engine?: unknown;
}): { ok: boolean; serviceMode: string; privateModelKey: string | null; provider: string | null; engine: string | null; reason: string } {
    const serviceMode = String(input?.serviceMode ?? '').toLowerCase();
    const privateModelKey = input?.privateModelKey != null ? String(input.privateModelKey) : null;
    const provider = input?.provider != null ? String(input.provider) : null;
    const engine = input?.engine != null ? String(input.engine) : null;
    const isPrivate = serviceMode === 'private';
    // On-device backend proof: Transformers.js (WASM/WebGPU) family, never a cloud/web-speech engine.
    const isTransformersProvider = !!provider && /transformers\.?js/i.test(provider);
    const isTransformersEngine = !!engine && /^transformers-js(-v4)?$/i.test(engine);
    const notFallbackModel = !!privateModelKey && !/tiny/i.test(privateModelKey);
    const noFallbackHandoff = input?.fallbackOccurred !== true;
    const ok = isPrivate && isTransformersProvider && isTransformersEngine && notFallbackModel && noFallbackHandoff;
    const reason = ok ? ''
        : !isPrivate ? `producing serviceMode is '${serviceMode}', expected 'private'`
            : !isTransformersProvider ? `resolved provider '${provider}' is not the Transformers.js (on-device WASM/WebGPU) family`
                : !isTransformersEngine ? `resolved engine '${engine}' is not transformers-js/-v4 (on-device)`
                    : !notFallbackModel ? `private model '${privateModelKey}' is the emergency tiny fallback, not the default`
                        : 'a runtime fallback/handoff occurred';
    return { ok, serviceMode, privateModelKey, provider, engine, reason };
}
