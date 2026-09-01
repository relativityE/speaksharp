// @vitest-environment happy-dom
//
// PRIVATE STT TELEMETRY — content safety and honest provenance on the CONFIG-SELECTED v4 path.
//
// This carries forward the PII assertion that used to live in the flag operational proof. That file
// reached v4 by turning a flag on, which no longer selects anything, so the assertion moved here where
// selection can be mocked openly. Mocking is safe in THIS file precisely because it makes no claim
// about bypasses — the negative claims stay in the unmocked suite next door.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupStrictZero } from '../../../../../../tests/setupStrictZero';
import type { PrivateSTT as PrivateSTTType } from '../PrivateSTT';
import { STTEngine } from '../../../../contracts/STTEngine';

// Spy the ACTUAL posthog.capture payloads PrivateSTT emits (not just the sanitizer in isolation).
const posthogCapture = vi.fn();
vi.mock('posthog-js', () => ({
    default: { capture: (...a: unknown[]) => posthogCapture(...a), isFeatureEnabled: () => false },
}));

vi.mock('@xenova/transformers', () => ({}));

vi.mock('@/config/TestFlags', async (importOriginal) => {
    interface SSWindow { __SS_E2E__?: { isActive?: boolean; engineType?: string } }
    interface TestGlobal { __TEST__?: boolean }
    const actual = await importOriginal<typeof import('@/config/TestFlags')>();
    return {
        ...actual,
        ENV: {
            ...actual.ENV,
            get isE2E(): boolean { return !!(window as unknown as SSWindow).__SS_E2E__?.isActive; },
            get isTest(): boolean { return this.isE2E || !!(globalThis as unknown as TestGlobal).__TEST__; },
            get engineType(): string { return ((window as unknown as SSWindow).__SS_E2E__?.isActive && (window as unknown as SSWindow).__SS_E2E__?.engineType) || 'system'; },
            get disableWasm(): boolean { return this.isTest && this.engineType !== 'real'; },
        },
    };
});

// CONFIG selects v4 for this suite. `v4VariantFor` and `assertDeviceAvailable` stay REAL, so a
// candidate the runtime cannot instantiate would fail here rather than be mocked past.
vi.mock('../../candidateSelection', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../candidateSelection')>();
    const { CANDIDATES } = await import('../../candidateRegistry');
    return {
        ...actual,
        effectiveCandidate: () => ({ candidate: CANDIDATES['v4:base:q4'], fallbackCause: null }),
    };
});

const v4Construct = vi.fn();
const v4Init = vi.fn();
class StubV4 extends STTEngine {
    type = 'transformers-js-v4' as const;
    constructor(o?: ConstructorParameters<typeof STTEngine>[0]) { super(o); v4Construct(o); }
    checkAvailability = vi.fn().mockResolvedValue({ available: true });
    protected onInit = v4Init;
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onPause = vi.fn().mockResolvedValue(undefined);
    onResume = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = vi.fn().mockResolvedValue({ isOk: true, data: 'v4' });
}
class StubTJ extends STTEngine {
    type = 'transformers-js' as const;
    checkAvailability = vi.fn().mockResolvedValue({ available: true });
    protected onInit = vi.fn().mockResolvedValue({ isOk: true, data: undefined });
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onPause = vi.fn().mockResolvedValue(undefined);
    onResume = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = vi.fn().mockResolvedValue({ isOk: true, data: 'v2' });
}
function setGpu(usable: boolean): void {
    Object.defineProperty(globalThis.navigator, 'gpu', {
        value: usable ? { requestAdapter: vi.fn().mockResolvedValue({ name: 'adapter' }) } : undefined,
        configurable: true, writable: true,
    });
}
const PII_KEYS = ['email', 'transcript', 'audio', 'stack', 'errorstack', 'sk_live', 'pk_live', 'whsec', 'token', 'jwt', 'password', 'secret', 'apikey', 'referencetext', 'distinctid', 'userid', 'sessiontoken'];

describe('config-selected v4 telemetry is content-free and honestly attributed', () => {
    let pstt: PrivateSTTType | null = null;
    beforeEach(async () => {
        (globalThis as { __TEST__?: boolean }).__TEST__ = true;
        vi.clearAllMocks();
        v4Init.mockResolvedValue({ isOk: true, data: undefined });
        await setupStrictZero();
        const { sttRegistry } = await import('../../STTRegistry');
        sttRegistry.register('transformers-js', (o) => new StubTJ(o));
        sttRegistry.register('transformers-js-v4', (o) => new StubV4(o));
        const win = window as unknown as { __SS_E2E__: { isActive: boolean; engineType: string } };
        win.__SS_E2E__.isActive = true; win.__SS_E2E__.engineType = 'real';
        window.localStorage.clear();
        window.history.replaceState({}, '', '/');
        setGpu(false);
    });
    afterEach(async () => {
        vi.unstubAllEnvs();
        if (pstt) { await pstt.terminate(); pstt = null; }
        if (typeof window !== 'undefined') { delete (window as unknown as Record<string, unknown>).__SS_E2E__; window.localStorage.clear(); }
    });

    it('CASUALTY: capture payloads carry NO PII, and provenance reads config', async () => {
        // A forced init failure drives the fallback telemetry, which is where the payloads appear.
        v4Init.mockResolvedValue({ isOk: false, error: new Error('forced v4 init failure for telemetry') });
        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        expect(posthogCapture, 'PrivateSTT must emit v4 telemetry').toHaveBeenCalled();
        let attempt: Record<string, unknown> | undefined;
        for (const [event, payload] of posthogCapture.mock.calls as Array<[string, Record<string, unknown>]>) {
            expect(String(event)).toMatch(/^private_stt_v4_/);
            const blob = JSON.stringify(payload ?? {}).toLowerCase();
            for (const bad of PII_KEYS) {
                expect(blob, `posthog "${event}" payload must not contain "${bad}"`).not.toContain(bad);
            }
            expect(blob, 'no @-style email values').not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
            if (event === 'private_stt_v4_attempt') attempt = payload;
        }
        // The run was chosen by a checked-in file, and the artifact must say so rather than naming a
        // flag that no longer decides anything.
        expect(attempt, 'canonical attempt event records config provenance')
            .toMatchObject({ selectionSource: 'config' });
    });
});
