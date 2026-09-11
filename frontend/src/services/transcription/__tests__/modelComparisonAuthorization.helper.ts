import { generateKeyPairSync, sign } from 'node:crypto';
import { vi } from 'vitest';
import {
    MODEL_COMPARISON_AUTH_KEY, consumeModelComparisonAuthorization,
    resetModelComparisonAuthorizationForTest, resetModelComparisonReplayLedgerForTest,
} from '../modelComparisonAuthorization';

const RELEASE = 'a'.repeat(40);

export function placeSignedAuthorization(overrides: Record<string, unknown> = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const now = Date.now();
    const payload = {
        version: 'speaksharp.model-comparison-authorization.v1',
        releaseSha: RELEASE,
        origin: window.location.origin,
        nonce: `nonce-${now}-${Math.random().toString(16).slice(2)}`,
        candidateId: 'v4:distil:q4',
        journey: 'open_mic',
        evidenceDocumentId: '11111111-1111-4111-8111-111111111111',
        issuedAt: new Date(now - 1_000).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
        ...overrides,
    };
    const signature = sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('base64');
    const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    Object.defineProperty(window, '__APP_RELEASE__', { value: RELEASE, configurable: true, writable: true });
    Object.defineProperty(window, Symbol.for(MODEL_COMPARISON_AUTH_KEY), {
        value: { payload, signature }, configurable: true,
    });
    // Test-only build-environment injection. Production installers read immutable `import.meta.env`
    // and expose no parameter through which page code can manufacture an internal build or key.
    vi.stubEnv('VITE_MODEL_COMPARISON_PUBLIC_KEY', rawPublicKey);
    return { env: { VITE_MODEL_COMPARISON_PUBLIC_KEY: rawPublicKey }, authorization: { payload, signature } };
}

export async function authorizeProduction(overrides: Record<string, unknown> = {}) {
    const placed = placeSignedAuthorization(overrides);
    return { ...placed, accepted: await consumeModelComparisonAuthorization() };
}

export function resetAuthorization(): void {
    resetModelComparisonAuthorizationForTest();
    resetModelComparisonReplayLedgerForTest(window);
    delete (window as unknown as Record<symbol, unknown>)[Symbol.for(MODEL_COMPARISON_AUTH_KEY)];
    delete (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__;
}
