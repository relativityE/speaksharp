import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import {
    projectEventProps, isContentFreeValue, isGovernedEvent, isValidForEventField, EVENT_ALLOWLIST, EVENT_SCHEMAS, GOVERNED_EVENTS,
} from '../telemetryAllowlist';
import { getSessionCoachingAssignment, SESSION_COACHING_EXPERIMENT_FLAG } from '../sessionCoachingExperiment';
import { getScoreLabel } from '@/utils/speakingScore';

/**
 * Fixtures are taken from the REAL producer. Hand-written fixtures are why the invented vocabulary survived:
 * the tests asserted 'guided'/'control' were valid variants, which they were — under an allowlist that did
 * not contain the only variant the app ever assigns.
 */
const REAL_ASSIGNMENT = getSessionCoachingAssignment();

/**
 * #1259 T1 — the outcome-loop telemetry boundary.
 *
 * The mutant that matters is T1: an unapproved `notes` property injected at a real producer must not reach
 * the PostHog call. Under the previous key-name denylist it DID — `notes` matches nothing in
 * /(transcript|audio|wav|blob|base64)/i.
 */

describe('#1259 T1 — approved fields survive (events stay analyzable)', () => {
    it('keeps every approved field on session_saved', () => {
        const input = {
            mode: 'private', duration_seconds: 61, word_count: 180, wpm: 118,
            filler_count: 4, clarity_score: 82, is_new_streak_day: true, streak_count: 3,
            session_coaching_experiment: 'session_coaching_v1',
            // Real producer values, not invented ones — see the vocabulary regression below.
            session_coaching_variant: REAL_ASSIGNMENT.variant,
            session_coaching_assignment_source: REAL_ASSIGNMENT.source,
        };
        const { props, dropped } = projectEventProps('session_saved', input);
        expect(props).toEqual(input);
        expect(dropped).toEqual([]);
    });

    it('keeps the diagnosable fields on recording_start_failed', () => {
        const { props } = projectEventProps('recording_start_failed', {
            // UPPERCASE, as RuntimeState actually is. The lowercase 'ready' this fixture used to pass was
            // accepted by an invented vocabulary and would have dropped every real value in production.
            mode: 'private', runtime_state: 'FAILED_VISIBLE',
            error_name: 'NotAllowedError', start_leaf_name: 'micPermission',
        });
        // error_name is a constructor name (bounded); it survives so failures stay diagnosable.
        expect(props.error_name).toBe('NotAllowedError');
        expect(props.start_leaf_name).toBe('micPermission');
        expect(props.runtime_state).toBe('FAILED_VISIBLE');
        expect(Object.keys(props)).toHaveLength(4);
    });

    it('keeps the conversion funnel intact', () => {
        const { props, dropped } = projectEventProps('checkout_started', {
            source: 'analytics_cta', plan: 'pro', route: '/analytics', tier: 'free',
            trial_state: 'active', session_coaching_experiment: 'x',
            session_coaching_variant: REAL_ASSIGNMENT.variant, session_coaching_assignment_source: REAL_ASSIGNMENT.source,
        });
        expect(dropped).toEqual([]);
        expect(props.plan).toBe('pro');
    });
});

describe('#1259 T1 — content is rejected', () => {
    it('MUTANT T1: an unapproved `notes` property never survives projection', () => {
        const { props, dropped } = projectEventProps('session_saved', {
            mode: 'private', duration_seconds: 61,
            notes: 'so um I think the the quarterly number is wrong',
        });
        expect(props).not.toHaveProperty('notes');
        expect(dropped).toContain('notes');
        expect(props).toEqual({ mode: 'private', duration_seconds: 61 });
    });

    it.each([
        ['transcript text', 'transcript', 'um so I wanted to say'],
        ['recommendation text', 'recommendation', 'Try pausing before your main point'],
        ['free-form error text', 'error_message', 'duplicate key value violates constraint "sessions_pkey" DETAIL: (transcript)=(...)'],
        ['rejection reason', 'reason', 'TypeError: cannot read properties of undefined'],
        ['crash message', 'message', 'Cannot read property transcript of null'],
        ['arbitrary metadata', 'meta_whatever', 'anything at all'],
        ['unknown key', 'brand_new_field', 'value'],
    ])('rejects %s', (_label, key, value) => {
        const { props, dropped } = projectEventProps('session_saved', { mode: 'private', [key]: value });
        expect(props).not.toHaveProperty(key);
        expect(dropped).toContain(key);
    });

    it('rejects NESTED free text hiding under an approved key name', () => {
        // An allowlisted KEY is not enough — only primitives pass.
        const { props, dropped } = projectEventProps('session_saved', {
            mode: { label: 'private', transcript: 'um so anyway' },
            word_count: [180, 'and the transcript said...'],
        });
        expect(props).toEqual({});
        expect(dropped).toEqual(expect.arrayContaining(['mode', 'word_count']));
    });

    it('rejects an over-long string in an approved field', () => {
        const { dropped } = projectEventProps('session_saved', { mode: 'x'.repeat(121) });
        expect(dropped).toContain('mode');
    });

    it('rejects non-primitives, and no longer waves strings through on shape alone', () => {
        expect(isContentFreeValue({ variant: 'guided' })).toBe(false);
        expect(isContentFreeValue(['guided'])).toBe(false);
        expect(isContentFreeValue(() => 'guided')).toBe(false);
        expect(isContentFreeValue(42)).toBe(true);
        expect(isContentFreeValue(NaN)).toBe(false);
        // POLICY CHANGE: a string is no longer content-free by virtue of being a string. It must match
        // the declared shape of its field, because prose under an approved key was the actual leak.
        expect(isContentFreeValue(REAL_ASSIGNMENT.variant)).toBe(false);
        expect(isValidForEventField('session_started', 'session_coaching_variant', REAL_ASSIGNMENT.variant)).toBe(true);
    });

    it('an UNGOVERNED event ships no properties at all', () => {
        // A new event carries an empty payload until its schema is reviewed, rather than whatever its
        // author happened to pass.
        expect(isGovernedEvent('some_new_event')).toBe(false);
        const { props, dropped } = projectEventProps('some_new_event', { anything: 'at all', n: 1 });
        expect(props).toEqual({});
        expect(dropped).toEqual(['anything', 'n']);
    });

    it('the two error events carry NO free text by schema', () => {
        // GLOBAL_UNHANDLED_REJECTION's schema used to be literally `[]`, and this test asserted that.
        // An empty schema does satisfy "no free text" — by shipping nothing at all, which made the
        // event a counter rather than a diagnostic (#1259 F12). The requirement was never emptiness;
        // it is that no field can carry prose. So assert THAT, against a schema that now has fields.
        expect(EVENT_ALLOWLIST.COMPONENT_CRASH).not.toContain('message');
        expect(EVENT_ALLOWLIST.GLOBAL_UNHANDLED_REJECTION).not.toContain('message');
        expect(EVENT_ALLOWLIST.GLOBAL_UNHANDLED_REJECTION).not.toContain('reason');
        expect(EVENT_ALLOWLIST.GLOBAL_UNHANDLED_REJECTION).not.toContain('stack');

        const crash = projectEventProps('COMPONENT_CRASH', {
            component: 'SessionPage', isolationKey: 'k', message: 'boom: transcript=...',
        });
        expect(crash.props).toEqual({ component: 'SessionPage', isolationKey: 'k' });

        // The raw message is still refused under its old name...
        expect(projectEventProps('GLOBAL_UNHANDLED_REJECTION', { reason: 'anything' }).props).toEqual({});
        // ...and prose cannot ride in on an approved field either: `error_name` takes a class name,
        // and the slug rule rejects anything with spaces.
        const prose = projectEventProps('GLOBAL_UNHANDLED_REJECTION', {
            reason_kind: 'error',
            error_name: 'could not find the transcript you asked for',
            error_fingerprint: '1f2e3d4c',
            message_length_band: '1-64',
        });
        expect(prose.dropped).toContain('error_name');
        expect(prose.props).toEqual({
            reason_kind: 'error', error_fingerprint: '1f2e3d4c', message_length_band: '1-64',
        });
    });
});

describe('#1259 T1 — proven at the REAL posthog.capture boundary, behaviourally', () => {
    /**
     * The previous version sliced AnalyticsBuffer.ts source and compared string offsets. It broke when the
     * function moved, and it proved text ordering rather than behaviour. This pushes through the real
     * producer path and inspects what posthog.capture actually received.
     */
    it('MUTANT T1: an unapproved `notes` field injected at a real producer never reaches PostHog', async () => {
        vi.resetModules();
        const capture = vi.fn();
        vi.doMock('posthog-js', () => ({ default: { capture, identify: vi.fn(), reloadFeatureFlags: vi.fn(), reset: vi.fn(), init: vi.fn() } }));
        const { analyticsBuffer } = await import('../AnalyticsBuffer');
        analyticsBuffer.ready = true;

        analyticsBuffer.push('session_saved', {
            mode: 'private', duration_seconds: 61, word_count: 180,
            notes: 'so um I think the quarterly number is wrong',
        }, 'CRITICAL');
        analyticsBuffer.flush();

        expect(capture).toHaveBeenCalled();
        const [event, payload] = capture.mock.calls[capture.mock.calls.length - 1];
        expect(event).toBe('session_saved');
        expect(payload).not.toHaveProperty('notes');
        expect(JSON.stringify(payload)).not.toContain('quarterly');
        // approved fields survive, so the event stays analyzable
        expect(payload).toMatchObject({ mode: 'private', duration_seconds: 61, word_count: 180 });
    });

    it('POSITIVE CONTROL: the capture spy really observes the boundary', async () => {
        // Without this, the assertion above would pass if capture were never called at all.
        vi.resetModules();
        const capture = vi.fn();
        vi.doMock('posthog-js', () => ({ default: { capture, identify: vi.fn(), reloadFeatureFlags: vi.fn(), reset: vi.fn(), init: vi.fn() } }));
        const { analyticsBuffer } = await import('../AnalyticsBuffer');
        analyticsBuffer.ready = true;
        analyticsBuffer.push('session_started', { mode: 'private', user_tier: 'pro' }, 'CRITICAL');
        analyticsBuffer.flush();
        expect(capture).toHaveBeenCalledWith('session_started', expect.objectContaining({ mode: 'private', user_tier: 'pro' }));
    });

    it('prose under an APPROVED key is dropped — length is not a content control', () => {
        // The blocker: `mode` is allowlisted, and a 43-character sentence is under any length cap.
        const { props, dropped } = projectEventProps('session_saved', {
            mode: 'um here is my private quarterly discussion',
            duration_seconds: 61,
        });
        expect(props).not.toHaveProperty('mode');
        expect(dropped).toContain('mode');
        expect(props).toEqual({ duration_seconds: 61 });
    });

    it.each([
        ['enum violation', 'mode', 'PrivateMode Extra Words'],
        ['route with a query string', 'route', '/analytics?transcript=um+so'],
        ['route with a fragment', 'route', '/a#um-so-anyway'],
        ['slug with spaces', 'source', 'analytics cta um'],
        ['slug with control chars', 'error_name', 'Error\u0000leak'],
        ['email in a slug field', 'utm_source', 'someone@example.com'],
        ['non-integer count', 'word_count', 180.5],
        ['negative duration', 'duration_seconds', -1],
        ['out-of-range score', 'clarity_score', 1000],
        ['NaN', 'wpm', NaN],
        ['Infinity', 'wpm', Infinity],
        ['boolean field given a string', 'is_new_streak_day', 'true'],
    ])('rejects %s', (_label, field, value) => {
        expect(isValidForEventField('session_saved', field, value)).toBe(false);
    });

    it.each([
        ['enum', 'session_saved', 'mode', 'private'],
        ['route', 'checkout_started', 'route', '/analytics'],
        ['slug', 'recording_start_failed', 'error_name', 'NotAllowedError'],
        ['int', 'session_saved', 'word_count', 180],
        ['number', 'session_saved', 'clarity_score', 82.4],
        ['bool', 'session_saved', 'is_new_streak_day', true],
        ['null is content-free', 'session_saved', 'mode', null],
    ])('accepts a valid %s', (_label, event, field, value) => {
        expect(isValidForEventField(event, field, value)).toBe(true);
    });

    it('a field with no declared shape can never be emitted, even if allowlisted by name', () => {
        expect(isValidForEventField('session_saved', 'brand_new_field', 'anything')).toBe(false);
    });

    it('the governed-event registry IS the type that producers must satisfy', () => {
        // The previous proof was a regex over literal `analyticsBuffer.push('name')` call sites. It was
        // replaced, not merely widened, because it could not work:
        //   - every Practice producer emits through a wrapper (`emit(event, …)`) with a VARIABLE, so all
        //     four were invisible — which is how `freeform_practice_started` shipped ungoverned;
        //   - a ternary argument is equally invisible;
        //   - and it matched TEXT, so a doc comment mentioning the call shape polluted the results.
        // `push` now takes `GovernedEvent | private_${string}`, so an ungoverned dynamic name is a COMPILE
        // error. This test pins the registry the type is derived from.
        expect(GOVERNED_EVENTS).toEqual(Object.keys(EVENT_SCHEMAS));
        expect(GOVERNED_EVENTS.length).toBeGreaterThan(15);
        for (const e of GOVERNED_EVENTS) expect(isGovernedEvent(e)).toBe(true);
        // Previously ungoverned, now governed.
        for (const e of [
            'freeform_practice_started', 'session_live_coaching_card_viewed',
            'session_live_coaching_numeric_score_shown',
        ]) expect(GOVERNED_EVENTS).toContain(e);
    });

    it('the same property name carries DIFFERENT closed vocabularies per event', () => {
        // The defect a single global name→rule table caused: one `mode` rule listing the STT modes silently
        // dropped 'quick'/'objective' from every Focus Points event.
        expect(isValidForEventField('practice_mode_selected', 'mode', 'objective')).toBe(true);
        expect(isValidForEventField('practice_mode_selected', 'mode', 'quick')).toBe(true);
        expect(isValidForEventField('session_started', 'mode', 'private')).toBe(true);
        // ...and neither vocabulary leaks into the other.
        expect(isValidForEventField('practice_mode_selected', 'mode', 'private')).toBe(false);
        expect(isValidForEventField('session_started', 'mode', 'objective')).toBe(false);
    });

    it('validators match the REAL product types, not invented ones', () => {
        // RuntimeState is UPPERCASE; ClientFreshness includes unverified/local; entry_source is closed.
        for (const v of ['INITIATING', 'ENGINE_INITIALIZING', 'READY', 'RECORDING', 'FAILED', 'FAILED_VISIBLE'])
            expect(isValidForEventField('recording_start_failed', 'runtime_state', v)).toBe(true);
        expect(isValidForEventField('recording_start_failed', 'runtime_state', 'ready')).toBe(false);

        for (const v of ['fresh', 'stale', 'unverified', 'local'])
            expect(isValidForEventField('recording_blocked_stale_client', 'status', v)).toBe(true);

        for (const v of ['landing_card', 'freeform_overview'])
            expect(isValidForEventField('practice_mode_selected', 'entry_source', v)).toBe(true);
        expect(isValidForEventField('practice_mode_selected', 'entry_source', 'some_new_surface')).toBe(false);
    });

    it('the live-coaching card keeps every analysis dimension through the REAL projection', () => {
        // Regression for an invented vocabulary. `session_coaching_variant` was declared as
        // ['control','guided','unknown'], but the only variant the code assigns is 'treatment' — so the
        // variant was dropped from every governed event and the experiment measured nothing. Asserting on
        // the producer's ACTUAL payload is what catches that; asserting on a fixture I wrote does not.
        const assignment = getSessionCoachingAssignment();
        const { props, dropped } = projectEventProps('session_live_coaching_card_viewed', {
            experiment: SESSION_COACHING_EXPERIMENT_FLAG,
            variant: assignment.variant,
            assignment_source: assignment.source,
            model_version: 'speaking-score-v0.1',
            confidence: 'directional',
            score_band: 'Confident Speaker',
            numeric_score_visible: true,
            action_count: 3,
            weakest_categories: ['deliveryControl', 'languageClarity'],
            transcription_engine: 'private',
            transcription_confidence: 'medium',
            target_label: 'Next target 7.5',
        });

        expect(props.variant).toBe('treatment');
        expect(props.assignment_source).toBe('default');
        expect(props.score_band).toBe('Confident Speaker');
        expect(props.weakest_categories).toEqual(['deliveryControl', 'languageClarity']);
        expect(props.transcription_confidence).toBe('medium');
        // Generated copy is dropped, not governed.
        expect(dropped).toContain('target_label');
        expect(props).not.toHaveProperty('target_label');
    });

    it('every score band the scorer can produce is expressible — no band is silently dropped', () => {
        // Bands are copy strings with spaces; a new band added to getScoreLabel would be dropped silently.
        const bands = new Set<string>();
        for (let score = 0; score <= 10; score += 0.1) bands.add(getScoreLabel(Math.round(score * 10) / 10));
        for (const band of bands) expect(isValidForEventField('session_live_coaching_card_viewed', 'score_band', band)).toBe(true);
        expect(bands.size).toBeGreaterThanOrEqual(5);
    });

    it('an array of FREE strings is still rejected — enum[] is not a hole for content', () => {
        expect(isValidForEventField('session_live_coaching_card_viewed', 'weakest_categories', ['deliveryControl'])).toBe(true);
        expect(isValidForEventField('session_live_coaching_card_viewed', 'weakest_categories', ['um so anyway here is my private transcript'])).toBe(false);
        expect(isValidForEventField('session_live_coaching_card_viewed', 'weakest_categories', ['deliveryControl', 'not_a_category'])).toBe(false);
        expect(isValidForEventField('session_live_coaching_card_viewed', 'weakest_categories', new Array(9).fill('deliveryControl'))).toBe(false);
    });
});

/**
 * REAL PRODUCERS → REAL CAPTURE BOUNDARY.
 *
 * Every test above this point drives `projectEventProps` or `analyticsBuffer.push` with a fixture I wrote.
 * That is exactly how an invented vocabulary survived once already. These call the ACTUAL producer
 * functions with their ACTUAL value vocabularies and assert what `posthog.capture` finally received.
 */
describe('#1259 T1 — real producers, real vocabularies, real posthog.capture payload', () => {
    const boot = async () => {
        vi.resetModules();
        const capture = vi.fn();
        vi.doMock('posthog-js', () => ({ default: { capture, identify: vi.fn(), reloadFeatureFlags: vi.fn(), reset: vi.fn(), init: vi.fn() } }));
        const { analyticsBuffer } = await import('../AnalyticsBuffer');
        analyticsBuffer.ready = true;
        // flush() SCHEDULES processBatch (postTask/idle/setTimeout), so LOW-priority producer events are
        // still queued when it returns. Drain real timers before asserting, or the payload never exists.
        const drain = async () => {
            analyticsBuffer.flush();
            for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
        };
        return { capture, analyticsBuffer, drain };
    };
    const lastFor = (capture: ReturnType<typeof vi.fn>, event: string) => {
        const call = [...capture.mock.calls].reverse().find(([e]) => e === event);
        expect(call, `no posthog.capture for ${event}`).toBeDefined();
        return call![1] as Record<string, unknown>;
    };

    it('POSITIVE CONTROL: the DYNAMIC Practice producers are discovered and keep their values', async () => {
        // These four emit through practiceTelemetry's `emit(event, …)` wrapper. A regex over literal
        // push('name') call sites found NONE of them; this drives the real exported functions.
        const { capture, drain } = await boot();
        const t = await import('../practiceTelemetry');

        t.trackPracticeEntryViewed(true);
        t.trackPracticeModeSelected('objective', 'landing_card');
        t.trackPracticeOverviewExpanded('quick');
        t.trackFreeformPracticeStarted('freeform_overview');
        await drain();

        const captured = capture.mock.calls.map(([e]) => e);
        for (const e of ['practice_entry_viewed', 'practice_mode_selected',
            'practice_overview_expanded', 'freeform_practice_started']) {
            expect(captured, `${e} never reached posthog.capture`).toContain(e);
        }
        // The Focus Points vocabulary SURVIVES — this is the regression: a single global `mode` rule listing
        // the STT modes dropped 'objective'/'quick' from every one of these events.
        expect(lastFor(capture, 'practice_mode_selected')).toMatchObject({
            mode: 'objective', entry_source: 'landing_card',
        });
        expect(lastFor(capture, 'practice_overview_expanded')).toMatchObject({ mode: 'quick' });
        // freeform_practice_started was entirely UNGOVERNED and shipped an empty payload.
        expect(lastFor(capture, 'freeform_practice_started')).toMatchObject({
            mode: 'quick', entry_source: 'freeform_overview',
        });
        expect(lastFor(capture, 'practice_entry_viewed')).toMatchObject({ returning_user: true });
    });

    it('the closed entry-source stays closed through the real producer', async () => {
        const { capture, drain } = await boot();
        const t = await import('../practiceTelemetry');
        // @ts-expect-error — deliberately smuggling an unapproved source past the type boundary.
        t.trackPracticeModeSelected('objective', 'attacker_supplied_source');
        await drain();
        const payload = lastFor(capture, 'practice_mode_selected');
        expect(payload.entry_source ?? null).toBeNull();
        expect(JSON.stringify(payload)).not.toContain('attacker_supplied_source');
    });

    it('conversion events KEEP their route when the location carries a query', async () => {
        // The defect: getCurrentRoute() returned pathname+search while the validator rejects query
        // material, so utm-tagged acquisition traffic — the exact traffic the funnel measures — silently
        // lost its route dimension.
        const original = window.location;
        Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'location');
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { ...original, pathname: '/analytics', search: '?utm_source=x&utm_campaign=y', hash: '' },
        });
        try {
            const { capture, drain } = await boot();
            const funnel = await import('../conversionFunnel');
            funnel.trackConversionCtaClicked({ source: 'analytics_overview_banner', plan: 'pro' });
            await drain();
            const payload = lastFor(capture, 'conversion_cta_clicked');
            expect(payload.route).toBe('/analytics');
            expect(JSON.stringify(payload)).not.toContain('utm_source=x');
        } finally {
            Object.defineProperty(window, 'location', { configurable: true, value: original });
        }
    });

    it('a caller-supplied route carrying a query is normalized, not dropped', async () => {
        const { capture, drain } = await boot();
        const funnel = await import('../conversionFunnel');
        funnel.trackConversionCtaClicked({ source: 'pricing_pro_card', plan: 'free', route: '/pricing?plan=pro' });
        await drain();
        expect(lastFor(capture, 'conversion_cta_clicked').route).toBe('/pricing');
    });

    it('the live-coaching producers reach the boundary with their dimensions intact', async () => {
        const { capture, drain } = await boot();
        const exp = await import('../sessionCoachingExperiment');
        const { calculateSpeakingScore } = await import('@/utils/speakingScore');
        const result = calculateSpeakingScore({
            transcript: 'This is a genuine sample of spoken practice content for scoring purposes.',
            wordCount: 180, elapsedSeconds: 90, fillerCount: 4, wpm: 120,
        } as Parameters<typeof calculateSpeakingScore>[0]);

        exp.trackSessionCoachingCardViewed(exp.getSessionCoachingAssignment(), result);
        await drain();

        const payload = lastFor(capture, 'session_live_coaching_card_viewed');
        expect(payload.variant).toBe('treatment');
        expect(payload.assignment_source).toBe('default');
        // Values produced by the REAL scorer must satisfy the REAL vocabulary.
        expect(payload.score_band).toBe(result.label);
        expect(payload.confidence).toBe(result.confidence);
        expect(payload.model_version).toBe(result.modelVersion);
        expect(payload).not.toHaveProperty('target_label');
    });
});
