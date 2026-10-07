// @vitest-environment node
/** #1258 PR 4 diagnostic — preconditions refuse before any Production write; the page classification is exact. */
import { describe, it, expect } from 'vitest';
import { SESSION_CONTROL_IDS, backDiagnosticPreconditionFailures, classifySessionView, coachingSummaryMarkdown, shownMatchesSaved, summaryCell, type SessionView } from '../live/helpers/backFromProgressDiagnostic';

const ok = { BASE_URL: 'https://speaksharp-public.vercel.app', SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y', RWT_WRITES_ACK: 'RWT-DISPOSABLE-ACCOUNT-WRITES' };
const view = (over: Partial<SessionView>): SessionView => ({
    path: '/session', verdict: false, thisRun: false, transcript: false, control: null, runtimeState: null, persisted: null, persistedId: null, ...over,
});

describe('back-from-progress diagnostic', () => {
    it('passes only with the approved origin, cleanup capability and the exact write acknowledgement', () => {
        expect(backDiagnosticPreconditionFailures(ok)).toEqual([]);
        expect(backDiagnosticPreconditionFailures({ ...ok, BASE_URL: 'https://preview.example.com' })[0]).toMatch(/ORIGIN GATE/);
        expect(backDiagnosticPreconditionFailures({ ...ok, SUPABASE_SERVICE_ROLE_KEY: '' })[0]).toMatch(/CAPABILITY GATE/);
        expect(backDiagnosticPreconditionFailures({ ...ok, RWT_WRITES_ACK: 'yes' })[0]).toMatch(/AUTHORIZATION GATE/);
        // No release binding: a branch dispatch is not the deployed SHA, and the observed release is recorded instead.
        expect(backDiagnosticPreconditionFailures({ ...ok, EXPECTED_RELEASE_SHA: '' })).toEqual([]);
    });

    it('completed session shown only when the after-state is visible for THIS saved session', () => {
        expect(classifySessionView(view({ verdict: true, persistedId: 's1' }), 's1')).toBe('completed_session_shown');
        expect(classifySessionView(view({ thisRun: true, path: '/session?review=s1' }), 's1')).toBe('completed_session_shown');
        // A different (or no) persisted session is not "the session I just completed".
        expect(classifySessionView(view({ verdict: true, persistedId: 's0' }), 's1')).toBe('other');
    });

    it('CASUALTY (PO 7 Oct): no after-state and a Start control is the blank page', () => {
        expect(classifySessionView(view({ control: 'mic-start' }), 's1')).toBe('blank_start');
        expect(classifySessionView(view({ control: 'mic-download' }), 's1')).toBe('blank_start');
        expect(classifySessionView(view({ control: 'recorder-bar' }), 's1')).toBe('other');
        expect(classifySessionView(view({ control: null }), 's1')).toBe('other');
    });

    it('reads only rendered controls from the shared map, never the retired combined id', () => {
        expect(SESSION_CONTROL_IDS).toEqual(expect.arrayContaining(['mic-start', 'mic-download', 'mic-retry', 'recorder-bar']));
        expect(SESSION_CONTROL_IDS).not.toContain('session-start-stop-button');
    });

    describe('AI suggestions capture (run summary only, synthetic takes only)', () => {
        const pair = { shownWell: 'Clear plan in three steps.', shownNext: 'Pause before each step.', savedWell: 'Clear plan in three steps.', savedNext: 'Pause before each step.' };
        it('renders the response, the shown and saved pairs, and whether they match', () => {
            const md = coachingSummaryMarkdown({ fixtureKind: 'synthetic', responses: [{ at: 1, status: 200, latencyMs: 4321.4 }], ...pair });
            expect(md).toContain('Coaching responses: HTTP 200 in 4321 ms');
            expect(md).toContain('| Shown on the page | Clear plan in three steps. | Pause before each step. |');
            expect(md).toContain('Shown matches saved: **yes**');
        });
        it('CASUALTY: a human-voice or unknown fixture renders nothing', () => {
            expect(coachingSummaryMarkdown({ fixtureKind: 'human', responses: [], ...pair })).toBe('');
            expect(coachingSummaryMarkdown({ fixtureKind: '', responses: [], ...pair })).toBe('');
        });
        it('cells cannot break the table or inject HTML; empty reads as an explicit absence; a missing saved pair does not match', () => {
            expect(summaryCell('a | b\nc <script>')).toBe('a \\| b c &lt;script&gt;');
            expect(summaryCell('')).toBe('_(none)_');
            expect(shownMatchesSaved({ fixtureKind: 'synthetic', responses: [], ...pair, savedNext: '' })).toBe(false);
            expect(coachingSummaryMarkdown({ fixtureKind: 'synthetic', responses: [], ...pair })).toContain('_(no coaching response)_');
        });
    });
});
