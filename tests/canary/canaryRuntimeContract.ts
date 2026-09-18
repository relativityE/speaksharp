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

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * #1258 — THE TAKE'S OWN EVIDENCE.
 *
 * The oracle these replace could reach "Smoke test passed" without proving this take saved. It
 * raced three end states where two resolved on ABSENCE (`No speech was detected`, and every racer
 * swallowing its own timeout with `.catch(() => null)`); it ran the schema check only
 * `if (page.url().includes('/analytics'))`; and inside that it ran only
 * `if (sessions.length > 0)` — so an empty list, which is exactly what a silently failed save
 * produces, skipped the one assertion that proved a save happened. It then read `sessions[0]`,
 * which is the newest row by ordering, not the row this take created.
 *
 * These judges are pure so the casualties can prove them without a browser. The spec supplies the
 * observations; it never decides.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

export type DurableSessionVerdict =
    | {
        ok: true;
        totalWords: number;
    }
    | { ok: false; category: string };

/**
 * Bind the durable row to THIS take's session id. Not `sessions[0]`: a row ordered first is the
 * newest row the account has, which on a re-run is the PREVIOUS take. An empty list is the
 * signature of a save that failed silently and must fail here, never skip.
 */
export function judgeDurableSession(sessions: unknown, sessionId: string): DurableSessionVerdict {
    if (!Array.isArray(sessions)) return { ok: false, category: 'session_list_not_an_array' };
    if (sessions.length === 0) return { ok: false, category: 'take_did_not_save' };
    const matches = sessions.filter(
        (row): row is Record<string, unknown> =>
            !!row && typeof row === 'object' && (row as { id?: unknown }).id === sessionId,
    );
    if (matches.length === 0) return { ok: false, category: 'take_session_id_absent' };
    if (matches.length > 1) return { ok: false, category: 'take_session_id_duplicated' };
    const row = matches[0];
    for (const field of [
        'id', 'user_id', 'total_words', 'duration', 'created_at',
    ] as const) {
        if (row[field] === undefined || row[field] === null) return { ok: false, category: `schema_missing_${field}` };
    }
    const words = Number(row.total_words);
    if (!Number.isFinite(words)) return { ok: false, category: 'total_words_not_numeric' };
    // Fixture audio contains speech. A saved row of zero words is a save that captured nothing.
    if (words <= 0) return { ok: false, category: 'saved_zero_words' };
    return { ok: true, totalWords: words };
}

export type SessionAttributionAuthorityVerdict =
    | {
        ok: true;
        authorityVersion: 'attrib_v1';
        engineClass: 'private';
        engineVersion: string;
        modelId: string;
        provider: string;
    }
    | { ok: false; category: string };

/**
 * Judge the server-owned attribution row for THIS take. The legacy `sessions.attribution_status`
 * and adjacent engine fields are client-facing compatibility data; they are not the authority that
 * consumers trust. The row below is owner-readable but only the guarded server path may write it.
 */
export function judgeSessionAttributionAuthority(
    rows: unknown,
    sessionId: string,
): SessionAttributionAuthorityVerdict {
    if (!Array.isArray(rows)) return { ok: false, category: 'authority_list_not_an_array' };
    const matches = rows.filter(
        (row): row is Record<string, unknown> =>
            !!row && typeof row === 'object' && (row as { session_id?: unknown }).session_id === sessionId,
    );
    if (matches.length === 0) return { ok: false, category: 'candidate_authority_absent' };
    if (matches.length > 1) return { ok: false, category: 'candidate_authority_duplicated' };
    const row = matches[0];
    for (const field of [
        'session_id', 'user_id', 'authority_version', 'engine_class', 'engine',
        'engine_version', 'model_id', 'provider', 'attested_at',
    ] as const) {
        if (row[field] === undefined || row[field] === null) {
            return { ok: false, category: `authority_schema_missing_${field}` };
        }
    }
    if (row.authority_version !== 'attrib_v1') {
        return { ok: false, category: 'candidate_authority_version_invalid' };
    }
    if (row.engine_class !== 'private' || row.engine !== 'private') {
        return { ok: false, category: 'candidate_authority_not_private' };
    }
    const provider = String(row.provider).toLowerCase();
    if (!provider.startsWith('transformers-js')) {
        return { ok: false, category: 'candidate_authority_provider_invalid' };
    }
    return {
        ok: true,
        authorityVersion: 'attrib_v1',
        engineClass: 'private',
        engineVersion: String(row.engine_version),
        modelId: String(row.model_id),
        provider,
    };
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * #1258 — PROHIBITED EGRESS, JUDGED BY DESTINATION POLICY.
 *
 * A transcript posted to a third party looks like ordinary JSON, and it can also leave in a QUERY
 * STRING with no body at all — so neither content type nor body presence can be the discriminator.
 * The destination is. Origins are supplied by the caller from build configuration; this module
 * hardcodes none, because `*.supabase.co` would admit any project and a generic PostHog or
 * Hugging Face suffix would admit any tenant.
 *
 * `resourceType()` is SUPPORTING EVIDENCE ONLY. An audio upload commonly appears as `fetch` or
 * `xhr`, so a `media` classification is reported but never relied upon as proof.
 *
 * FAIL CLOSED: an unparseable URL, an undetermined body state, or an origin outside every declared
 * class is prohibited. Silence is never a pass.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** Exact origins (`scheme://host[:port]`), never suffixes. Supplied by the spec from configuration. */
export type CanaryEgressPolicy = {
    /** Our app and the exact configured Supabase project. May carry request bodies. */
    firstParty: readonly string[];
    /** The exact configured analytics origin. Governed, content-free, may carry bodies. */
    governedTelemetry: readonly string[];
    /** Exact model-asset origins. Private must be ready before the take, so any later request is prohibited. */
    modelAssets: readonly string[];
};

export type EgressObservation = {
    /** Already redacted to the origin only. Neither path nor query content may enter evidence. */
    redacted: string;
    origin: string;
    /** `null` means the body state could not be determined — judged as prohibited, never skipped. */
    bodyBytes: number | null;
    /** Supporting evidence only. */
    resourceType: string;
    /** True when the request carried a query string: a bodyless exfiltration channel. */
    hasQuery: boolean;
    /** Shape-only result computed before redaction. Query contents are never retained in evidence. */
    queryContainsEncodedAudio: boolean;
    /** Shape-only result computed before redaction. Path contents are never retained in evidence. */
    pathContainsEncodedAudio: boolean;
};

/** A WebSocket or EventSource opened during the take. Later frames are invisible to request checks. */
export type ChannelObservation = { redacted: string; origin: string; kind: 'websocket' | 'eventsource' };

export type EgressVerdict =
    | { ok: true; inspected: number; channels: number }
    | { ok: false; category: string; url: string };

/**
 * Redact an observed payload URL while resolving browser-valid relative requests against the app.
 *
 * Origin-only is deliberate: a malicious request can encode transcript text in its pathname, so even
 * `origin + pathname` would copy private content into the canary artifact and assertion output.
 */
export function sanitizeCanaryPayloadUrl(rawUrl: unknown, appUrl: string): string {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) return '<unparseable>';
    try {
        const parsed = new URL(rawUrl, appUrl);
        return parsed.origin;
    } catch {
        return '<unparseable>';
    }
}

const AUDIO_QUERY_KEY = /^(audio|audioData|audio_data|audioBytes|audio_bytes|pcm|pcmData|pcm_data|samples|audioSamples|audio_samples)$/i;

type AudioShapeVerdict = 'audio' | 'clean' | 'opaque';

function isNumericSampleArray(value: unknown): boolean {
    return Array.isArray(value)
        && value.length >= 32
        && value.every((sample) => typeof sample === 'number' && Number.isFinite(sample));
}

function isNumericSampleObject(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const entries = Object.entries(value);
    return entries.length >= 32 && entries.every(([key, sample], index) => (
        key === String(index) && typeof sample === 'number' && Number.isFinite(sample)
    ));
}

function isEncodedAudioScalar(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed.length === 0) return false;
    if (/^data:(audio|video)\/[a-z0-9.+-]+;base64,/i.test(trimmed)) return true;
    const unpadded = trimmed.replace(/={1,2}$/, '');
    if (trimmed.length >= 256 && unpadded.length % 4 !== 1
        && /^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return true;
    return false;
}

function isEncodedAudioChunkArray(value: unknown): boolean {
    if (!Array.isArray(value) || value.length < 2) return false;
    let encodedChars = 0;
    for (const chunk of value) {
        if (typeof chunk !== 'string') return false;
        const trimmed = chunk.trim();
        if (!trimmed || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return false;
        encodedChars += trimmed.length;
    }
    return encodedChars >= 256;
}

function inspectAudioEnvelope(
    value: unknown,
    depth: number,
    budget: { remaining: number },
    audioContext: boolean,
): AudioShapeVerdict {
    if (depth > 4 || budget.remaining <= 0) return 'opaque';
    budget.remaining -= 1;
    if (audioContext && (
        (typeof value === 'string' && isEncodedAudioScalar(value))
        || isNumericSampleArray(value)
        || isNumericSampleObject(value)
        || isEncodedAudioChunkArray(value)
    )) return 'audio';
    if (!value || typeof value !== 'object') return 'clean';
    let verdict: AudioShapeVerdict = 'clean';
    for (const [key, nested] of Object.entries(value)) {
        const result = inspectAudioEnvelope(nested, depth + 1, budget, audioContext || AUDIO_QUERY_KEY.test(key));
        if (result === 'audio') return 'audio';
        if (result === 'opaque') verdict = 'opaque';
    }
    return verdict;
}

function inspectAudioEnvelopeText(value: string): AudioShapeVerdict {
    const trimmed = value.trim();
    if (trimmed.length < 2 || !(
        (trimmed.startsWith('{') && trimmed.endsWith('}'))
        || (trimmed.startsWith('[') && trimmed.endsWith(']'))
    )) return 'clean';
    if (trimmed.length > 1_000_000) return 'opaque';
    try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isNumericSampleArray(parsed) || isNumericSampleObject(parsed)) return 'audio';
        return inspectAudioEnvelope(parsed, 0, { remaining: 128 }, false);
    } catch {
        return 'opaque';
    }
}

function isEncodedAudioQueryValue(value: string): boolean {
    return isEncodedAudioScalar(value) || inspectAudioEnvelopeText(value) !== 'clean';
}

/**
 * Inspect query NAME AND VALUE SHAPES before URL redaction, but retain only the boolean verdict. This closes the
 * bodyless approved-origin channel without copying a path, parameter name, or value into CI evidence.
 */
export function canaryQueryContainsEncodedAudio(rawUrl: unknown, appUrl: string): boolean {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) return false;
    try {
        const parsed = new URL(rawUrl, appUrl);
        let combinedQuery = '';
        for (const [key, value] of parsed.searchParams.entries()) {
            if (AUDIO_QUERY_KEY.test(key) && value.trim().length > 0) return true;
            if (isEncodedAudioQueryValue(key)) return true;
            if (isEncodedAudioQueryValue(value)) return true;
            if (combinedQuery.length + key.length + value.length <= 1_000_000) {
                combinedQuery += key + value;
            }
        }
        // Splitting one base64 payload across repeated innocuous names or values must not evade the classifier.
        return isEncodedAudioQueryValue(combinedQuery);
    } catch {
        return false;
    }
}

/**
 * Inspect path SEGMENT SHAPES before URL redaction, retaining only the boolean verdict. Paths are
 * decoded one segment at a time so an encoded slash cannot make payload content enter evidence.
 */
export function canaryPathContainsEncodedAudio(rawUrl: unknown, appUrl: string): boolean {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) return false;
    try {
        const parsed = new URL(rawUrl, appUrl);
        let combined = '';
        for (const rawSegment of parsed.pathname.split('/')) {
            if (rawSegment.length === 0) continue;
            let segment = rawSegment;
            try { segment = decodeURIComponent(rawSegment); } catch { /* inspect the encoded form */ }
            if (isEncodedAudioQueryValue(segment)) return true;
            if (combined.length + segment.length <= 1_000_000) combined += segment;
        }
        // Splitting one encoded value across path segments must not evade the classifier.
        return isEncodedAudioQueryValue(combined);
    } catch {
        return false;
    }
}

function classifyOrigin(origin: string, policy: CanaryEgressPolicy): 'first-party' | 'telemetry' | 'model' | 'unknown' {
    if (policy.firstParty.includes(origin)) return 'first-party';
    if (policy.governedTelemetry.includes(origin)) return 'telemetry';
    if (policy.modelAssets.includes(origin)) return 'model';
    return 'unknown';
}

export function judgeCanaryEgress(
    observations: readonly EgressObservation[],
    channels: readonly ChannelObservation[],
    policy: CanaryEgressPolicy,
): EgressVerdict {
    // An ungoverned duplex channel defeats request-body inspection entirely: the open is observable,
    // the frames are not. Only first-party origins may open one.
    for (const c of channels) {
        if (classifyOrigin(c.origin, policy) !== 'first-party') {
            return { ok: false, category: `ungoverned_${c.kind}`, url: c.redacted };
        }
    }
    for (const o of observations) {
        if (o.origin === '') return { ok: false, category: 'unparseable_egress_url', url: o.redacted };
        if (o.hasQuery && o.queryContainsEncodedAudio) {
            return { ok: false, category: 'encoded_audio_query', url: o.redacted };
        }
        if (o.pathContainsEncodedAudio) {
            return { ok: false, category: 'encoded_audio_path', url: o.redacted };
        }
        const cls = classifyOrigin(o.origin, policy);
        // Unknown destinations are prohibited OUTRIGHT — bodyless included. A query string is a
        // complete exfiltration channel and needs no body.
        if (cls === 'unknown') return { ok: false, category: 'undeclared_destination', url: o.redacted };
        if (cls === 'model') {
            // Private is fully ready before this observation window opens. Any model-origin request
            // during the take is therefore unexpected, and a path can carry private text even with no
            // body or query. A zero-route allowlist is both narrower and more auditable than attempting
            // to recognise every CDN redirect while recording.
            return { ok: false, category: 'model_origin_request_during_take', url: o.redacted };
        }
        if (o.bodyBytes === null) return { ok: false, category: 'undetermined_body_state', url: o.redacted };
    }
    return { ok: true, inspected: observations.length, channels: channels.length };
}

/**
 * Read a verdict's failure category WITHOUT relying on discriminated-union narrowing.
 * `tsconfig.e2e.json` sets no `strict`/`strictNullChecks`, so `ok: true | false` widens to
 * `boolean` and neither a ternary nor an `if` narrows these unions — which is why the existing
 * `startOutcome.category` reference has never typechecked under that project. `in` works regardless.
 */
export function verdictCategory(verdict: { ok: boolean }): string {
    if (verdict.ok) return 'none';
    return 'category' in verdict && typeof (verdict as { category?: unknown }).category === 'string'
        ? (verdict as { category: string }).category
        : 'unclassified';
}

/** The redacted host/path of a failed egress verdict, or an empty string when it passed. */
export function verdictUrl(verdict: { ok: boolean }): string {
    return !verdict.ok && 'url' in verdict && typeof (verdict as { url?: unknown }).url === 'string'
        ? (verdict as { url: string }).url
        : '';
}
