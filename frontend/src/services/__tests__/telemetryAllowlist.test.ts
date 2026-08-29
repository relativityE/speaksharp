import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import {
    projectEventProps, isContentFreeValue, isGovernedEvent, isValidForField, EVENT_ALLOWLIST,
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
            mode: 'private', requested_mode: 'private', runtime_state: 'ready',
            user_tier: 'pro', error_name: 'NotAllowedError', start_leaf_name: 'micPermission',
        });
        // error_name is a constructor name (bounded); it survives so failures stay diagnosable.
        expect(props.error_name).toBe('NotAllowedError');
        expect(props.start_leaf_name).toBe('micPermission');
        expect(Object.keys(props)).toHaveLength(6);
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
        expect(isValidForField('session_coaching_variant', REAL_ASSIGNMENT.variant)).toBe(true);
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
        expect(EVENT_ALLOWLIST.COMPONENT_CRASH).not.toContain('message');
        expect(EVENT_ALLOWLIST.GLOBAL_UNHANDLED_REJECTION).toEqual([]);
        const crash = projectEventProps('COMPONENT_CRASH', {
            component: 'SessionPage', isolationKey: 'k', message: 'boom: transcript=...',
        });
        expect(crash.props).toEqual({ component: 'SessionPage', isolationKey: 'k' });
        expect(projectEventProps('GLOBAL_UNHANDLED_REJECTION', { reason: 'anything' }).props).toEqual({});
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
        expect(isValidForField(field, value)).toBe(false);
    });

    it.each([
        ['enum', 'mode', 'private'],
        ['route', 'route', '/analytics'],
        ['slug', 'error_name', 'NotAllowedError'],
        ['int', 'word_count', 180],
        ['number', 'clarity_score', 82.4],
        ['bool', 'is_new_streak_day', true],
        ['null is content-free', 'mode', null],
    ])('accepts a valid %s', (_label, field, value) => {
        expect(isValidForField(field, value)).toBe(true);
    });

    it('a field with no declared shape can never be emitted, even if allowlisted by name', () => {
        expect(isValidForField('brand_new_field', 'anything')).toBe(false);
    });

    it('every producer event name is governed by a schema — enumerated from SOURCE, not from a list', () => {
        // This was a hand-maintained array, which is worthless for the thing it claims to prove: it can only
        // contain events someone remembered to add. Enumerating the real `analyticsBuffer.push` call sites
        // immediately found TWO ungoverned live producers (`session_live_coaching_*`) that the hand-written
        // list had never mentioned, and that therefore shipped with zero properties.
        const SRC = resolve(__dirname, '../..');
        const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
            .filter(f => /\.(ts|tsx)$/.test(f))
            .filter(f => !/__tests__|\.test\.|[/\\]mocks[/\\]/.test(f));

        const emitted = new Set<string>();
        for (const rel of files) {
            const text = readFileSync(resolve(SRC, rel), 'utf8');
            for (const m of text.matchAll(/analyticsBuffer\.push\(\s*'([^']+)'/g)) emitted.add(m[1]);
        }

        // Guard the guard: if the scan finds nothing, the regex has drifted and this test would pass vacuously.
        expect(emitted.size).toBeGreaterThan(8);
        expect(emitted).toContain('session_saved');

        expect([...emitted].filter(e => !isGovernedEvent(e)).sort()).toEqual([]);
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
        for (const band of bands) expect(isValidForField('score_band', band)).toBe(true);
        expect(bands.size).toBeGreaterThanOrEqual(5);
    });

    it('an array of FREE strings is still rejected — enum[] is not a hole for content', () => {
        expect(isValidForField('weakest_categories', ['deliveryControl'])).toBe(true);
        expect(isValidForField('weakest_categories', ['um so anyway here is my private transcript'])).toBe(false);
        expect(isValidForField('weakest_categories', ['deliveryControl', 'not_a_category'])).toBe(false);
        expect(isValidForField('weakest_categories', new Array(9).fill('deliveryControl'))).toBe(false);
    });
});
