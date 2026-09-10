/**
 * #1432 — one-use authorization for the canonical Production comparison surface.
 *
 * The previous `Symbol.for(...)=true` arm was writable by ordinary page-world code. This verifies an
 * Ops-signed Ed25519 envelope before setting module-private authority. The public key may ship; the
 * signing key never enters the browser or repository.
 */

export const MODEL_COMPARISON_AUTH_KEY = 'speaksharp.model-comparison.authorization';
export const MODEL_COMPARISON_REPLAY_KEY = 'speaksharp.model-comparison.consumed.v1';
const VERSION = 'speaksharp.model-comparison-authorization.v1';
const MAX_TTL_MS = 5 * 60_000;
const CLOCK_SKEW_MS = 30_000;
const COMPARISON_CANDIDATES = new Set(['v2:base.en', 'v4:distil:q4', 'moonshine:streaming-medium']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION_BINDING_VERSION = 'speaksharp.model-comparison-session-binding.v1';

export type ModelComparisonJourney = 'open_mic' | 'focus_points';

interface AuthorizationPayload {
    version: typeof VERSION;
    releaseSha: string;
    origin: string;
    nonce: string;
    candidateId: string;
    journey: ModelComparisonJourney;
    evidenceDocumentId: string;
    issuedAt: string;
    expiresAt: string;
}

interface SignedAuthorization { payload: AuthorizationPayload; signature: string }

let armed: AuthorizationPayload | null = null;
let activeNonce: string | null = null;
let activeEvidenceDocumentId: string | null = null;

const decodeBase64 = (value: string): ArrayBuffer => {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return buffer;
};

const serializedPayload = (payload: AuthorizationPayload): ArrayBuffer => {
    const encoded = new TextEncoder().encode(JSON.stringify({
        version: payload.version,
        releaseSha: payload.releaseSha,
        origin: payload.origin,
        nonce: payload.nonce,
        candidateId: payload.candidateId,
        journey: payload.journey,
        evidenceDocumentId: payload.evidenceDocumentId,
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
    }));
    const buffer = new ArrayBuffer(encoded.byteLength);
    new Uint8Array(buffer).set(encoded);
    return buffer;
};

const validShape = (value: unknown): value is SignedAuthorization => {
    if (!value || typeof value !== 'object') return false;
    const auth = value as Partial<SignedAuthorization>;
    const payload = auth.payload as Partial<AuthorizationPayload> | undefined;
    return !!payload && payload.version === VERSION
        && typeof payload.releaseSha === 'string' && /^[0-9a-f]{40}$/.test(payload.releaseSha)
        && typeof payload.origin === 'string'
        && typeof payload.nonce === 'string' && /^[A-Za-z0-9._:-]{16,128}$/.test(payload.nonce)
        && typeof payload.candidateId === 'string' && COMPARISON_CANDIDATES.has(payload.candidateId)
        && (payload.journey === 'open_mic' || payload.journey === 'focus_points')
        && typeof payload.evidenceDocumentId === 'string' && UUID_V4.test(payload.evidenceDocumentId)
        && typeof payload.issuedAt === 'string' && typeof payload.expiresAt === 'string'
        && typeof auth.signature === 'string' && auth.signature.length > 20;
};

export function hasModelComparisonAuthorization(): boolean { return armed !== null; }

/**
 * Content-free join between the signed browser authorization and governed lifecycle telemetry.
 * This is deliberately the authorization nonce, never a user or database session identifier.
 */
export function modelComparisonControlNonce(): string | null {
    return activeNonce;
}

/** Signed document identifier shared by the six authorized rows in one down-selection packet. */
export function modelComparisonEvidenceDocumentId(): string | null {
    return activeEvidenceDocumentId;
}

/**
 * Privacy-safe proof that the signed take produced one exact persisted session.
 *
 * Canonical bytes are pinned as a JSON array so browser and trusted Node readback cannot disagree
 * about separators or field order. The raw database id never enters telemetry. Privacy relies on the
 * session id being an unguessable UUIDv4; the signed nonce is correlation authority, not a secret.
 */
export async function modelComparisonSessionBindingSha256(
    persistedSessionId: string | null,
    root: typeof globalThis = globalThis,
): Promise<string | null> {
    if (!activeNonce || !persistedSessionId || !UUID_V4.test(persistedSessionId) || !root.crypto?.subtle) return null;
    try {
        const canonical = JSON.stringify([SESSION_BINDING_VERSION, activeNonce, persistedSessionId]);
        const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
        // Evidence failure must HOLD the comparison row; it must never turn a saved user session into
        // an application failure or create a model-specific harness penalty.
        return null;
    }
}

type ReplayLedger = Record<string, string>;

function claimDurableNonce(payload: AuthorizationPayload, root: typeof globalThis, now: number): boolean {
    let storage: Storage;
    try {
        storage = root.localStorage;
        const raw = storage.getItem(MODEL_COMPARISON_REPLAY_KEY);
        const parsed = raw === null ? {} : JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
        const ledger = Object.fromEntries(Object.entries(parsed as ReplayLedger).filter(([, expiresAt]) =>
            typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) >= now - CLOCK_SKEW_MS,
        ));
        if (Object.prototype.hasOwnProperty.call(ledger, payload.nonce)) return false;
        ledger[payload.nonce] = payload.expiresAt;
        // This ledger is denial state, not authority: deleting it cannot mint a valid signature.
        // The controlled test protocol permits one browser tab, so this also closes document reload
        // replay without inventing a server-side capability service for the release experiment.
        storage.setItem(MODEL_COMPARISON_REPLAY_KEY, JSON.stringify(ledger));
        const persisted = JSON.parse(storage.getItem(MODEL_COMPARISON_REPLAY_KEY) ?? 'null') as ReplayLedger | null;
        return persisted?.[payload.nonce] === payload.expiresAt;
    } catch {
        // Production comparison authority must survive a document/module replacement. If durable
        // same-origin storage cannot make the nonce use visible to the next document, fail closed.
        return false;
    }
}

export async function consumeModelComparisonAuthorization(
    env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
    root: typeof globalThis = globalThis,
    now = Date.now(),
): Promise<boolean> {
    armed = null;
    activeNonce = null;
    activeEvidenceDocumentId = null;
    const carrier = root as unknown as Record<symbol, unknown>;
    const symbol = Symbol.for(MODEL_COMPARISON_AUTH_KEY);
    const value = carrier[symbol];
    try { delete carrier[symbol]; } catch { /* fail closed below */ }
    if (!validShape(value)) return false;

    const release = (root as typeof globalThis & { __APP_RELEASE__?: string }).__APP_RELEASE__;
    const origin = (root as typeof globalThis & { location?: Location }).location?.origin;
    if (value.payload.releaseSha !== release || value.payload.origin !== origin) return false;
    const issuedAt = Date.parse(value.payload.issuedAt);
    const expiresAt = Date.parse(value.payload.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
        || issuedAt > now + CLOCK_SKEW_MS || expiresAt < now
        || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TTL_MS) return false;

    const keyText = env.VITE_MODEL_COMPARISON_PUBLIC_KEY;
    if (typeof keyText !== 'string' || keyText.length < 20 || !root.crypto?.subtle) return false;
    try {
        const key = await root.crypto.subtle.importKey('raw', decodeBase64(keyText), { name: 'Ed25519' }, false, ['verify']);
        const valid = await root.crypto.subtle.verify(
            { name: 'Ed25519' }, key, decodeBase64(value.signature), serializedPayload(value.payload),
        );
        if (!valid) return false;
        // Claim before exposing the surface. The module-private capability below is then usable for
        // exactly one candidate/journey switch; the durable claim prevents the signed bearer from
        // becoming fresh again after a reload or `vi.resetModules()`.
        if (!claimDurableNonce(value.payload, root, now)) return false;
        armed = value.payload;
        return true;
    } catch { return false; }
}

/** Consume the verified capability at the actual switch boundary, exactly once and for its signed row. */
export function consumeModelComparisonTakeAuthorization(
    candidateId: string,
    journey: ModelComparisonJourney | undefined,
    now = Date.now(),
): boolean {
    const capability = armed;
    // Any attempt spends the module-private arm. A caller cannot probe alternate rows until one fits.
    armed = null;
    if (!capability || capability.candidateId !== candidateId || capability.journey !== journey) return false;
    const expiresAt = Date.parse(capability.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
    activeNonce = capability.nonce;
    activeEvidenceDocumentId = capability.evidenceDocumentId;
    return true;
}

/** Test-only reset; no Production caller can mint authority through it. */
export function resetModelComparisonAuthorizationForTest(): void {
    armed = null;
    activeNonce = null;
    activeEvidenceDocumentId = null;
}

/** Test-only reset of the off-module replay authority. */
export function resetModelComparisonReplayLedgerForTest(root: typeof globalThis = globalThis): void {
    try { root.localStorage.removeItem(MODEL_COMPARISON_REPLAY_KEY); } catch { /* no storage in this test */ }
}
