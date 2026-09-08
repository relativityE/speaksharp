/**
 * #1432 — one-use authorization for the canonical Production comparison surface.
 *
 * The previous `Symbol.for(...)=true` arm was writable by ordinary page-world code. This verifies an
 * Ops-signed Ed25519 envelope before setting module-private authority. The public key may ship; the
 * signing key never enters the browser or repository.
 */

export const MODEL_COMPARISON_AUTH_KEY = 'speaksharp.model-comparison.authorization';
const VERSION = 'speaksharp.model-comparison-authorization.v1';
const MAX_TTL_MS = 5 * 60_000;
const CLOCK_SKEW_MS = 30_000;

interface AuthorizationPayload {
    version: typeof VERSION;
    releaseSha: string;
    origin: string;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
}

interface SignedAuthorization { payload: AuthorizationPayload; signature: string }

const consumed = new Set<string>();
let authorized = false;
let authorizedNonce: string | null = null;

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
        && typeof payload.issuedAt === 'string' && typeof payload.expiresAt === 'string'
        && typeof auth.signature === 'string' && auth.signature.length > 20;
};

export function hasModelComparisonAuthorization(): boolean { return authorized; }

/**
 * Content-free join between the signed browser authorization and governed lifecycle telemetry.
 * This is deliberately the authorization nonce, never a user or database session identifier.
 */
export function modelComparisonControlNonce(): string | null {
    return authorized ? authorizedNonce : null;
}

export async function consumeModelComparisonAuthorization(
    env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
    root: typeof globalThis = globalThis,
    now = Date.now(),
): Promise<boolean> {
    authorized = false;
    authorizedNonce = null;
    const carrier = root as unknown as Record<symbol, unknown>;
    const symbol = Symbol.for(MODEL_COMPARISON_AUTH_KEY);
    const value = carrier[symbol];
    try { delete carrier[symbol]; } catch { /* fail closed below */ }
    if (!validShape(value) || consumed.has(value.payload.nonce)) return false;

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
        consumed.add(value.payload.nonce);
        authorizedNonce = value.payload.nonce;
        authorized = true;
        return true;
    } catch { return false; }
}

/** Test-only reset; no Production caller can mint authority through it. */
export function resetModelComparisonAuthorizationForTest(): void {
    authorized = false;
    authorizedNonce = null;
    consumed.clear();
}
