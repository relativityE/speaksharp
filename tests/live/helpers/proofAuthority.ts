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

// ── fix 2 (RETURN) — EXACT repository identity mappings; no substring/regex acceptance ───────────────────────
// Mirror the app's own durable identity: PrivateSTT.getMetadata() sets engine_variant from the engine type and
// buildEngineVersion() composes `${variant}:${model}`. These dictionaries ARE the repository mappings, checked by
// exact value.
export const PRIVATE_VARIANT_BY_RUNTIME_PROVIDER = Object.freeze({
    'transformers-js': 'private_v2',
    'transformers-js-v4': 'private_v4',
} as const);
// The non-fallback persisted models per arm (whisper-tiny.en is the v2 EMERGENCY fallback and must never persist;
// v4 has no tiny variant). Exact membership, not a regex.
export const PRIVATE_MODELS_BY_ARM = Object.freeze({
    private_v2: Object.freeze(['whisper-base.en', 'whisper-small.en'] as const),
    private_v4: Object.freeze(['base_q4', 'distil_q4'] as const),
});
export const PRIVATE_V2_FALLBACK_MODEL = 'whisper-tiny.en';

/** Exact `engine_version` composition, identical to the app's buildEngineVersion(). */
export function composeEngineVersion(variant: string, model: string): string { return `${variant}:${model}`; }

type PrivateVariant = keyof typeof PRIVATE_MODELS_BY_ARM;

/**
 * EXACT Private v2/v4 identity mapping (RETURN item 2). Uses the repository dictionaries + exact string equality —
 * NO substring/regex acceptance. Requires ALL:
 *   - the INSTANTIATED runtime provider maps to a known arm variant (`transformers-js`→`private_v2`,
 *     `transformers-js-v4`→`private_v4`);
 *   - the persisted `engine_version` is EXACTLY `${variant}:${model}` where variant equals the runtime's arm
 *     (so a runtime-v4 run persisted as v2, or vice-versa, is rejected) and model EXACTLY equals `model_name`;
 *   - `model_name` is an EXACT member of that arm's non-fallback model set (and is NOT `whisper-tiny.en`);
 *   - the running model id is present and not the tiny fallback (liveness; the HF model path differs from the
 *     persisted variant name, so it is NOT equated to `model_name`);
 *   - `engine` is EXACTLY 'private' and `device_type` is EXACTLY 'browser'.
 */
export function matchesPrivatePersistedArm(input: {
    runtimeProvider?: unknown; runtimeModelId?: unknown;
    persistedEngine?: unknown; persistedEngineVersion?: unknown; persistedModelName?: unknown; persistedDeviceType?: unknown;
}): { ok: boolean; arm: 'v2' | 'v4' | null; expectedEngineVersion: string | null; reason: string } {
    const provider = String(input.runtimeProvider ?? '');
    const variant = (PRIVATE_VARIANT_BY_RUNTIME_PROVIDER as Record<string, PrivateVariant>)[provider] ?? null;
    const arm = variant === 'private_v2' ? 'v2' : variant === 'private_v4' ? 'v4' : null;
    const model = String(input.persistedModelName ?? '');
    const engineVersion = String(input.persistedEngineVersion ?? '');
    const runtimeModel = String(input.runtimeModelId ?? '');
    const expectedEngineVersion = variant ? composeEngineVersion(variant, model) : null;
    if (variant === null) return { ok: false, arm, expectedEngineVersion, reason: `runtime provider ${JSON.stringify(input.runtimeProvider)} is not a known Private arm` };
    if (model === PRIVATE_V2_FALLBACK_MODEL) return { ok: false, arm, expectedEngineVersion, reason: `persisted model is the tiny fallback (${model})` };
    if (!(PRIVATE_MODELS_BY_ARM[variant] as readonly string[]).includes(model)) return { ok: false, arm, expectedEngineVersion, reason: `model_name ${JSON.stringify(model)} is not an exact ${variant} model` };
    if (engineVersion !== expectedEngineVersion) return { ok: false, arm, expectedEngineVersion, reason: `engine_version ${JSON.stringify(engineVersion)} != exact ${JSON.stringify(expectedEngineVersion)}` };
    if (runtimeModel === '' || runtimeModel.split('/').pop() === PRIVATE_V2_FALLBACK_MODEL) return { ok: false, arm, expectedEngineVersion, reason: `running model is absent or the tiny fallback (${JSON.stringify(input.runtimeModelId)})` };
    if (input.persistedEngine !== 'private') return { ok: false, arm, expectedEngineVersion, reason: `engine must be exactly 'private' (${JSON.stringify(input.persistedEngine)})` };
    if (input.persistedDeviceType !== 'browser') return { ok: false, arm, expectedEngineVersion, reason: `device_type must be exactly 'browser' (${JSON.stringify(input.persistedDeviceType)})` };
    return { ok: true, arm, expectedEngineVersion, reason: '' };
}

/**
 * Bounded cleanup-recovery decision (RETURN item 1) over a FULLY-paginated user list. Given all listed users, the
 * exact created email (lowercased), and the run-owned email prefix, returns the deterministic verdict for one
 * poll attempt: 'one' (unique run-owned match → uid), 'zero' (retry), 'ambiguous' (>1 → fail closed), or
 * 'not_run_owned' (the sole match is not a run-owned account → refuse to delete). The caller polls on 'zero' up
 * to a bound and fails on persistent 'zero'.
 */
export function resolveRecoveryMatch(
    users: Array<{ id?: string; email?: string | null }>, createdEmailLower: string, runOwnedPrefix: string,
): { status: 'one'; uid: string } | { status: 'zero' } | { status: 'ambiguous'; count: number } | { status: 'not_run_owned'; email: string | null } {
    const matches = (users ?? []).filter((u) => (u?.email ?? '').toLowerCase() === createdEmailLower);
    if (matches.length === 0) return { status: 'zero' };
    if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
    const only = matches[0];
    const email = only?.email ?? null;
    if (!(email ?? '').toLowerCase().startsWith(runOwnedPrefix)) return { status: 'not_run_owned', email };
    if (!only?.id) return { status: 'zero' };
    return { status: 'one', uid: only.id };
}

/**
 * A CONTENT-SAFE snapshot of a persisted session for reload-equality checks (P1 fix 4): identifiers +
 * measurements + engine identity, with the transcript reduced to its trimmed LENGTH only — never the raw text.
 */
export function contentSafeSessionSnapshot(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
    const r = row ?? {};
    return {
        id: r.id ?? null,
        status: r.status ?? null,
        transcriptLen: String(r.transcript ?? '').trim().length,
        engine: r.engine ?? null,
        engineVersion: r.engine_version ?? null,
        modelName: r.model_name ?? null,
        deviceType: r.device_type ?? null,
    };
}

/** Content-safe equality of two session snapshots (P1 fix 4) — deep-equal on the content-safe fields only. */
export function contentSafeSnapshotsEqual(
    a: Record<string, unknown>, b: Record<string, unknown>,
): { ok: boolean; reason: string } {
    const keys = ['id', 'status', 'transcriptLen', 'engine', 'engineVersion', 'modelName', 'deviceType'];
    for (const k of keys) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
            return { ok: false, reason: `content-safe field '${k}' changed across reload: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}` };
        }
    }
    return { ok: true, reason: '' };
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
