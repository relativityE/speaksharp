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
 * Structured Private producing-identity check for a LIVE recording. The verdict is anchored on the identity
 * emitted by the ACTUAL INSTANTIATED running engine — `__PRIVATE_STT_RUNTIME_DEBUG__.provider` (the v2 engine's
 * own `PrivateRuntimeDecision.provider`, published by PrivateSTT when it selects/instantiates; it also carries
 * the v4 path) — NOT a `provider`/`engine` manufactured from the `serviceMode` label. This is the P1.2
 * correction: a generic `serviceMode='private'` cannot detect a mislabeled Browser/Cloud/missing handoff, so
 * the running engine's structured provider is the authority. Requires ALL of:
 *   - producing mode is Private (`serviceMode` from `__SPEECH_RUNTIME_DEBUG__`);
 *   - the INSTANTIATED engine provider is the on-device Transformers.js family — exactly `transformers-js` (v2)
 *     or `transformers-js-v4`. Missing/ambiguous/`web-speech-api`/`assemblyai` (i.e. `serviceMode='private'`
 *     but a Browser/Cloud/absent running engine) is REJECTED. Transformers.js is never inferred from
 *     mode/tier/UI label/persisted `engine`;
 *   - the model actually running (`modelId` from `__STT_IDENTITY__`, P1.1 — NOT the nonexistent
 *     `privateModelKey`) is the default, i.e. NOT the emergency `whisper-tiny.en` fallback;
 *   - no runtime fallback/handoff (neither the v4 runtime fallback flag nor the engine identity's own
 *     `fallbackOccurred`).
 * Device type is intentionally NOT constrained here (the persisted row separately proves `device_type='browser'`).
 */
export function isPrivateRuntimeIdentity(input: {
    serviceMode?: unknown;
    modelId?: unknown;
    runtimeProvider?: unknown;
    fallbackOccurred?: unknown;
}): { ok: boolean; serviceMode: string; modelId: string | null; runtimeProvider: string | null; reason: string } {
    const serviceMode = String(input?.serviceMode ?? '').toLowerCase();
    const modelId = input?.modelId != null ? String(input.modelId) : null;
    const runtimeProvider = input?.runtimeProvider != null ? String(input.runtimeProvider) : null;
    const isPrivate = serviceMode === 'private';
    // Instantiated-engine proof: the running strategy's OWN provider must be the on-device Transformers.js
    // family (exact match), never a serviceMode-derived label. Missing/ambiguous/cloud/web-speech is rejected.
    const isTransformersRuntime = !!runtimeProvider && /^transformers-js(-v4)?$/i.test(runtimeProvider);
    const notFallbackModel = !!modelId && !/tiny/i.test(modelId);
    const noFallbackHandoff = input?.fallbackOccurred !== true;
    const ok = isPrivate && isTransformersRuntime && notFallbackModel && noFallbackHandoff;
    const reason = ok ? ''
        : !isPrivate ? `producing serviceMode is '${serviceMode}', expected 'private'`
            : !isTransformersRuntime ? `instantiated running engine provider '${runtimeProvider}' is not the on-device Transformers.js engine (a serviceMode='private' label with a Browser/Cloud/missing/ambiguous running engine is rejected)`
                : !notFallbackModel ? `running model '${modelId}' is the emergency tiny fallback, not the default`
                    : 'a runtime fallback/handoff occurred';
    return { ok, serviceMode, modelId, runtimeProvider, reason };
}
