import { vi, describe, it, expect, beforeEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import { emitJourneyStep, normaliseRoute } from '../journeyStep';
import { projectEventProps } from '../../telemetryAllowlist';
import { beginJourney, __resetJourneyIdentityForTests } from '../journeyIdentity';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const rows = () => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((c) => c[0] === 'journey_step').map((c) => c[1] as Record<string, unknown>);
const drain = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

beforeEach(() => {
    vi.clearAllMocks();
    __resetJourneyIdentityForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
});

describe('F03 — two controls, the same words, different actions', () => {
    it('records the control identity ALONGSIDE what it actually did', () => {
        emitJourneyStep({ step: 'setup_submitted', ctaId: 'objective_setup_primary', ctaAction: 'navigate' });
        emitJourneyStep({ step: 'cta_click', ctaId: 'mic_card_primary', ctaAction: 'start_recording' });
        drain();
        const seen = rows();
        // The collision is only legible because BOTH the identity and the action are carried. Either
        // alone leaves the two controls indistinguishable, which is the state before this change.
        expect(seen.map((r) => [r.cta_id, r.cta_action])).toEqual([
            ['objective_setup_primary', 'navigate'],
            ['mic_card_primary', 'start_recording'],
        ]);
    });

    it('carries the entered point count where entry actually happens (F18)', () => {
        emitJourneyStep({ step: 'setup_submitted', ctaId: 'objective_setup_primary', pointsEntered: 4 });
        drain();
        expect(rows()[0].points_entered).toBe(4);
    });
});

describe('F08 — absence must be a measurement, not a missing event', () => {
    it('emits an EMPTY offering rather than staying silent', () => {
        emitJourneyStep({ step: 'post_session_options', optionsShown: [] });
        drain();
        expect(rows()).toHaveLength(1);
        expect(rows()[0].options_shown).toEqual([]);
    });

    it('an invented destination is REJECTED by the schema, not shipped', () => {
        const { props, dropped } = projectEventProps('journey_step', {
            step: 'post_session_options', options_shown: ['practice_next', 'teleport_to_mars'],
        });
        // A free-string list would let a producer record an option no user could have seen.
        expect(dropped).toContain('options_shown');
        expect(props).not.toHaveProperty('options_shown');
    });
});

describe('routes carry no identifiers', () => {
    it('replaces id-shaped segments so a session id cannot ride in a pathname', () => {
        expect(normaliseRoute('/analytics/9f2c4b1e8a7d6f5c')).toBe('/analytics/id');
        expect(normaliseRoute('/session/12345')).toBe('/session/id');

        // CASUALTY: the real shape. `/analytics/:sessionId` carries a standard HYPHENATED uuid, which the
        // previous hex-only test did not match — so the persisted session id was exported in
        // `journey_step.from_route`/`to_route`, and the route rule permits hyphens so nothing downstream
        // rejected it either.
        expect(normaliseRoute('/analytics/9f2c4b1e-8a7d-4c3b-9e1f-2a3b4c5d6e7f')).toBe('/analytics/id');
        expect(normaliseRoute('/analytics/9F2C4B1E-8A7D-4C3B-9E1F-2A3B4C5D6E7F')).toBe('/analytics/id');
        // Anything that is not a plain route word is redacted, including shapes nobody has thought of.
        expect(normaliseRoute('/session/aGVsbG8gd29ybGQ')).toBe('/session/id');
        expect(normaliseRoute('/u/user_42/detail')).toBe('/u/id/detail');
        // ...while ordinary route words survive, so the telemetry stays useful.
        expect(normaliseRoute('/focus-points/review')).toBe('/focus-points/review');
    });

    it('strips query and fragment, which is where content lives', () => {
        expect(normaliseRoute('/practice?goal=my%20private%20topic#notes')).toBe('/practice');
    });

    it('refuses anything that is not a path', () => {
        expect(normaliseRoute('https://example.com/x')).toBeNull();
        expect(normaliseRoute(null)).toBeNull();
        expect(normaliseRoute('')).toBeNull();
    });

    it('a raw id-bearing route would be REJECTED by the schema even if normalisation were skipped', () => {
        // Belt and braces: the route rule is the backstop for a caller that forgets to normalise.
        const { dropped } = projectEventProps('journey_step', {
            step: 'route_change', to_route: '/analytics/9f2c4b1e?x=1',
        });
        expect(dropped).toContain('to_route');
    });

    it('every emitted field survives the schema', () => {
        const { props, dropped } = projectEventProps('journey_step', {
            step: 'route_change', from_route: '/practice', to_route: '/analytics',
            product_mode: 'objective', cta_id: 'mic_card_primary', cta_action: 'start_recording',
            runtime_state_on_arrival: 'READY', options_shown: ['practice_next', 'view_analytics'],
            option_selected: 'view_analytics', points_entered: 4,
        });
        expect(dropped).toEqual([]);
        expect(Object.keys(props).sort()).toEqual([
            'cta_action', 'cta_id', 'from_route', 'option_selected', 'options_shown',
            'points_entered', 'product_mode', 'runtime_state_on_arrival', 'step', 'to_route',
        ]);
    });
});
