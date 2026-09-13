/**
 * #1259 T2 — THE ENVELOPE MUST EMIT WITHOUT BEING WIRED.
 *
 * The defect these tests exist to prevent is not a wrong value; it is a CORRECT pipeline that emits
 * nothing. `AnalyticsBuffer` defaulted its envelope sources to `() => ({})`, so unless production code
 * called `setEnvelopeSources()` — and nothing did — every governed event carried a null release, null
 * model attribution, and `user` traffic. That is indistinguishable from never having built the
 * envelope, and it fails in the direction that HIDES our own traffic among real users.
 *
 * So every test here deliberately does NOT call `setEnvelopeSources`. They assert on what
 * `posthog.capture` actually received through the real seam. Re-defaulting the provider to `{}` must
 * fail them.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import posthog from 'posthog-js';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import { recordResolvedEngine, clearResolvedEngine } from '../runtimeAttribution';

vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(), identify: vi.fn(), reset: vi.fn(),
        reloadFeatureFlags: vi.fn(), _isIdentified: vi.fn(),
    },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn() }));

const RELEASE = 'a19324610634b9e05a375fff8838f2bbbae3a4f1';

/** Drive the REAL seam and return the props `posthog.capture` received for `event`. */
async function captured(event: string, props: Record<string, unknown>) {
    (posthog.capture as ReturnType<typeof vi.fn>).mockClear();
    analyticsBuffer.queue = [];
    analyticsBuffer.isFlushing = false;
    analyticsBuffer.ready = true;
    analyticsBuffer.push(event as Parameters<typeof analyticsBuffer.push>[0], props, 'HIGH');
    analyticsBuffer.flush();
    await vi.runAllTimersAsync();
    const call = (posthog.capture as ReturnType<typeof vi.fn>).mock.calls
        .find((c: unknown[]) => c[0] === event);
    return (call?.[1] ?? null) as Record<string, unknown> | null;
}

describe('the envelope emits on the DEFAULT path, with nothing wired', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        clearResolvedEngine();
        // The traffic claims are process-global on the buffer, not per-test state. Without an
        // explicit reset a canary case classifies every test that follows it, and the failure lands
        // in whichever test happens to run next.
        analyticsBuffer.setCanaryClaim(false);
        analyticsBuffer.setInternalTesterClaim(false);
        (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ = RELEASE;
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
        clearResolvedEngine();
        delete (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__;
    });

    it('CASUALTY: release_sha reaches PostHog without setEnvelopeSources ever being called', async () => {
        const props = await captured('checkout_returned_success', {});
        expect(props).not.toBeNull();
        expect(props?.release_sha).toBe(RELEASE);
    });

    it('CASUALTY: candidate_id is the identity the ENGINE published, not a config intention', async () => {
        recordResolvedEngine({
            candidateId: 'v4:base:int8',
            modelIdentity: {
                engine: 'transformers-js-v4',
                configuredRuntime: { version: '3.7.5' },
                configuredAssets: { pinDigest: 'deadbeef' },
            },
        });
        const props = await captured('checkout_returned_success', {});
        expect(props?.candidate_id).toBe('v4:base:int8');
        expect(props?.engine).toBe('transformers-js-v4');
        expect(props?.runtime_version).toBe('3.7.5');
    });

    it('an unresolved engine yields NULL attribution, never a guessed model', async () => {
        const props = await captured('checkout_returned_success', {});
        expect(props?.candidate_id).toBeNull();
        expect(props?.engine).toBeNull();
    });

    it('CASUALTY: a signed-in canary account is classified as canary, not user', async () => {
        // The classification is a SERVER-ASSIGNED claim now, not a bundled account list. Stubbing an
        // env var here proved the old mechanism; it proves nothing about the one that ships.
        analyticsBuffer.identify('canary-account-1');
        analyticsBuffer.setCanaryClaim(true);
        const props = await captured('checkout_returned_success', {});
        expect(props?.traffic_type).toBe('canary');
    });

    it('a real user is still classified as user — the default fails toward visibility', async () => {
        vi.stubEnv('VITE_CANARY_ACCOUNT_IDS', 'canary-account-1');
        analyticsBuffer.identify('a-real-person');
        const props = await captured('checkout_returned_success', {});
        expect(props?.traffic_type).toBe('user');
    });

    it('CASUALTY: a producer cannot forge the envelope — the seam value wins', async () => {
        recordResolvedEngine({ candidateId: 'v2:base.en', modelIdentity: { engine: 'transformers-js' } });
        const props = await captured('checkout_returned_success', {
            candidate_id: 'moonshine:streaming-medium',
            traffic_type: 'user',
            release_sha: 'not-the-real-release',
        });
        expect(props?.candidate_id).toBe('v2:base.en');
        expect(props?.release_sha).toBe(RELEASE);
    });
});
