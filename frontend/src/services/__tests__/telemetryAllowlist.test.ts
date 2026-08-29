import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    projectEventProps, isContentFreeValue, isGovernedEvent, EVENT_ALLOWLIST,
} from '../telemetryAllowlist';

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
            session_coaching_variant: 'guided',
            session_coaching_assignment_source: 'posthog_flag',
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
            session_coaching_variant: 'control', session_coaching_assignment_source: 'default',
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

    it('rejects a malformed enum value by shape (non-primitive) even under a valid key', () => {
        expect(isContentFreeValue({ variant: 'guided' })).toBe(false);
        expect(isContentFreeValue(['guided'])).toBe(false);
        expect(isContentFreeValue(() => 'guided')).toBe(false);
        expect(isContentFreeValue('guided')).toBe(true);
        expect(isContentFreeValue(42)).toBe(true);
        expect(isContentFreeValue(NaN)).toBe(false);
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

describe('#1259 T1 — the projection is at the REAL capture boundary', () => {
    const buffer = readFileSync(
        resolve(process.cwd(), 'frontend/src/services/AnalyticsBuffer.ts'), 'utf8');

    it('projectEventProps is applied in send(), immediately before posthog.capture', () => {
        // POSITIVE CONTROL for the boundary claim: prove the real capture call is present AND that the
        // projection precedes it in the same function. A test that only exercised the pure function would
        // pass even if nothing called it.
        const send = buffer.slice(buffer.indexOf('private send('), buffer.indexOf('public identify('));
        expect(send).toContain('projectEventProps(event.event, event.properties)');
        expect(send).toContain('posthog.capture(event.event');
        expect(send.indexOf('projectEventProps')).toBeLessThan(send.indexOf('posthog.capture'));
    });

    it('the superseded key-name denylist is gone, not merely bypassed', () => {
        expect(buffer).not.toContain('SENSITIVE_ANALYTICS_KEY');
        expect(buffer).not.toContain('sanitizeAnalyticsProperties');
    });

    it('every producer event name is governed by a schema', () => {
        // If a producer emits an event with no allowlist entry it ships empty — analyzable failure, not a
        // leak — but that is a defect worth catching here rather than in the funnel.
        const producers = [
            'session_started', 'session_saved', 'recording_start_failed', 'recording_blocked_stale_client',
            'conversion_cta_viewed', 'conversion_cta_clicked', 'checkout_started',
            'checkout_returned_success', 'checkout_returned_cancelled',
            'practice_entry_viewed', 'practice_mode_selected', 'practice_overview_expanded',
            'COMPONENT_CRASH', 'GLOBAL_UNHANDLED_REJECTION', 'account_identified',
        ];
        expect(producers.filter(e => !isGovernedEvent(e))).toEqual([]);
    });
});
