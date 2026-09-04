import { vi, describe, it, expect, beforeEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import { emitTranscriptAuthority, __resetTranscriptAuthorityForTests } from '../transcriptAuthority';
import { contentDigest, countWords } from '@/lib/contentDigest';
import { projectEventProps } from '../../telemetryAllowlist';
import { beginJourney, __resetJourneyIdentityForTests } from '../journeyIdentity';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const calls = () => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls;
const rows = () => calls().filter((c) => c[0] === 'transcript_authority').map((c) => c[1] as Record<string, unknown>);
const drain = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

const SPOKEN = 'so basically the thing I wanted to say about the quarterly numbers is that they moved';

beforeEach(() => {
    vi.clearAllMocks();
    __resetTranscriptAuthorityForTests();
    __resetJourneyIdentityForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
});

describe('F05 — a count and a rendered surface are different facts', () => {
    it('THE FINDING: words saved, nothing on screen', () => {
        emitTranscriptAuthority({ stage: 'review_rendered', authoritative: SPOKEN, rendered: '', persisted: true });
        drain();
        const r = rows()[0];
        // This exact shape was previously unrepresentable: `session_saved.word_count` said 16 and
        // nothing recorded that the panel was blank.
        expect(r.authoritative_word_count).toBe(16);
        expect(r.rendered_word_count).toBe(0);
        expect(r.transcript_visibly_present).toBe(false);
        expect(r.digests_match).toBe(false);
        expect(r.persisted).toBe(true);
    });

    it('agreement is reported just as explicitly as disagreement', () => {
        emitTranscriptAuthority({ stage: 'review_rendered', authoritative: SPOKEN, rendered: SPOKEN });
        drain();
        const r = rows()[0];
        expect(r.digests_match).toBe(true);
        expect(r.transcript_visibly_present).toBe(true);
        expect(r.rendered_word_count).toBe(r.authoritative_word_count);
    });

    it('a stage with no rendered surface says NULL, never "rendered nothing"', () => {
        emitTranscriptAuthority({ stage: 'save', authoritative: SPOKEN, persisted: true });
        drain();
        const r = rows()[0];
        expect(r.rendered_word_count).toBeNull();
        // Null, not false — "we did not look" must not read as "we looked and it differed".
        expect(r.digests_match).toBeNull();
    });

    it('teardown reports what survived, and in which terminal state', () => {
        emitTranscriptAuthority({
            stage: 'teardown', authoritative: '', persisted: true,
            sessionIdPresent: true, teardownState: 'TERMINATED',
        });
        drain();
        const r = rows()[0];
        // Purged after a successful save is the PO's exact report; it is now a recorded fact.
        expect(r.authoritative_word_count).toBe(0);
        expect(r.persisted).toBe(true);
        expect(r.session_id_present).toBe(true);
        expect(r.teardown_state).toBe('TERMINATED');
    });

    it('NO TEXT LEAVES — not the transcript, not an excerpt, not a first word', () => {
        emitTranscriptAuthority({ stage: 'finalize', authoritative: SPOKEN, rendered: SPOKEN });
        drain();
        const serialized = JSON.stringify(rows()[0]);
        for (const word of ['basically', 'quarterly', 'numbers', 'wanted']) {
            expect(serialized).not.toContain(word);
        }
        expect(serialized).not.toContain(SPOKEN.slice(0, 12));
    });

    it('every field survives the schema — an event that ships nothing proves nothing', () => {
        const { props, dropped } = projectEventProps('transcript_authority', {
            stage: 'review_rendered', transcript_digest: contentDigest(SPOKEN),
            authoritative_word_count: 16, rendered_word_count: 0,
            transcript_visibly_present: false, digests_match: false,
            persisted: true, session_id_present: true, teardown_state: 'TERMINATED',
        });
        expect(dropped).toEqual([]);
        expect(Object.keys(props)).toHaveLength(9);
    });
});

describe('F05 — noise control', () => {
    it('an unchanged repeat is NOT emitted — a component re-renders for unrelated reasons', () => {
        for (let i = 0; i < 5; i += 1) {
            emitTranscriptAuthority({ stage: 'review_rendered', authoritative: SPOKEN, rendered: SPOKEN });
        }
        drain();
        expect(rows()).toHaveLength(1);
    });

    it('but a CHANGE is always emitted — suppression must not hide the transcript vanishing', () => {
        emitTranscriptAuthority({ stage: 'review_rendered', authoritative: SPOKEN, rendered: SPOKEN });
        emitTranscriptAuthority({ stage: 'review_rendered', authoritative: SPOKEN, rendered: '' });
        drain();
        const seen = rows();
        expect(seen).toHaveLength(2);
        expect(seen[1].transcript_visibly_present).toBe(false);
    });
});

describe('the digest primitive', () => {
    it('equal text yields equal digests; different text does not', () => {
        expect(contentDigest(SPOKEN)).toBe(contentDigest(SPOKEN));
        expect(contentDigest(SPOKEN)).not.toBe(contentDigest(`${SPOKEN} more`));
    });

    it('counts words the way a reader would, not by splitting on a single space', () => {
        // A transcript with newlines or doubled spaces would otherwise report a count the user's own
        // screen contradicts — and disagreeing counts are the entire subject of F05.
        // Each case below must DIFFER from a naive split(' '): the previous fixture happened to give
        // 4 either way, so it passed against the very implementation it was meant to rule out.
        expect(countWords('one  two')).toBe(2);            // split(' ') -> 3 (empty between doubles)
        expect(countWords('one\ntwo')).toBe(2);            // split(' ') -> 1 (newline is not a space)
        expect(countWords('one\ttwo three')).toBe(3);      // split(' ') -> 2 (tab is not a space)
        expect(countWords(' leading and trailing ')).toBe(3);
        expect(countWords('   ')).toBe(0);
        expect(countWords('')).toBe(0);
        expect(countWords(null)).toBe(0);
    });
});
