import {
    MODEL_COMPARISON_AUTH_KEY, consumeModelComparisonAuthorization,
    resetModelComparisonAuthorizationForTest, resetModelComparisonReplayLedgerForTest,
} from '../modelComparisonAuthorization';

const RELEASE = 'a'.repeat(40);
const hex24 = (): string => Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

/**
 * Place a run-issued authorization (minted inside an owner-dispatched `rc-gates.yml` run) where trusted Node would
 * inject it. No signature exists: the page gate is defense-in-depth only.
 */
export function placeAuthorization(overrides: Record<string, unknown> = {}) {
    const now = Date.now();
    const runId = 4242;
    const authorization = {
        schemaVersion: 'speaksharp-model-comparison-run-authorization-v1',
        repository: 'relativityE/speaksharp',
        workflowPath: '.github/workflows/rc-gates.yml',
        workflowRef: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main',
        workflowSha: 'b'.repeat(40),
        runId,
        runAttempt: 1,
        actor: 'relativityE',
        releaseSha: RELEASE,
        origin: window.location.origin,
        candidateId: 'v4:distil:q4',
        journey: 'open_mic',
        evidenceDocumentId: '11111111-1111-4111-8111-111111111111',
        nonce: `run-${runId}-1-${hex24()}`,
        issuedAt: new Date(now - 1_000).toISOString(),
        ...overrides,
    };
    Object.defineProperty(window, '__APP_RELEASE__', { value: RELEASE, configurable: true, writable: true });
    Object.defineProperty(window, Symbol.for(MODEL_COMPARISON_AUTH_KEY), { value: authorization, configurable: true });
    return { authorization };
}

export async function authorizeProduction(overrides: Record<string, unknown> = {}) {
    const placed = placeAuthorization(overrides);
    return { ...placed, accepted: await consumeModelComparisonAuthorization() };
}

export function resetAuthorization(): void {
    resetModelComparisonAuthorizationForTest();
    resetModelComparisonReplayLedgerForTest(window);
    delete (window as unknown as Record<symbol, unknown>)[Symbol.for(MODEL_COMPARISON_AUTH_KEY)];
    delete (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__;
}
