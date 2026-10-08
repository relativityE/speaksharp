// @vitest-environment node
/** #1258 PR 4 diagnostic — preconditions refuse before any Production write; the page classification is exact. */
import { describe, it, expect } from 'vitest';
import {
    SESSION_CONTROL_IDS, aiSuggestionsLogLine, backDiagnosticPreconditionFailures, classifySessionView, coachingSummaryMarkdown, flatScalars,
    safeValue, sessionViewFields, shownMatchesSaved, summaryCell, timelineFields, type SessionView,
} from '../live/helpers/backFromProgressDiagnostic';
import { sanitizeDiagnostic } from '../live/helpers/rwtDiagnosticWindow';

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

    describe('every recorded field survives DiagnosticRecord\'s sanitizer (run 37705211104 lost its Back result)', () => {
        const survives = (fields: Record<string, unknown>) => expect(sanitizeDiagnostic(fields)).toEqual(fields);

        it('CASUALTY: the old shape is dropped — an upper-case key and object values vanish', () => {
            const old = { BACK_FROM_PROGRESS_RESULT: 'blank_start', after_back_samples: [{ a: 1 }], timeline: [{ t: 1 }] };
            expect(sanitizeDiagnostic(old)).toEqual({});
        });

        it('session views, the Back headline and per-sample fields survive unchanged', () => {
            const v = view({ path: '/session?review=s1', thisRun: true, control: 'mic-start', runtimeState: 'READY', persisted: 'true', persistedId: 's1' });
            const fields = { ...sessionViewFields('back_s0', v, 's1'), back_s0_ms: 5012, back_result: 'completed_session_shown', back_samples: 7 };
            survives(fields);
            expect(fields.back_s0_class).toBe('completed_session_shown');
            expect(fields.back_s0_path).toBe('_session_review=s1');
            expect(fields.back_s0_id_match).toBe(true);
        });

        it('the timeline survives as numbered chunks; ids are reported only as saved/other', () => {
            const events = Array.from({ length: 40 }, (_, i) => ({ t: i * 1000, k: i % 2 ? 'data-runtime-state' : 'data-session-persisted-id', v: i % 2 ? 'RECORDING' : (i % 4 ? 'other-id' : 's1') }));
            const fields = timelineFields(events, 's1');
            survives(fields);
            expect(fields.timeline_events).toBe(40);
            expect(Number(fields.timeline_chunks)).toBeGreaterThan(1);
            const all = Object.entries(fields).filter(([k]) => /^timeline_\d+$/.test(k)).map(([, v]) => String(v)).join(';');
            expect(all).toContain('0:id=saved');
            expect(all).toContain('1000:rt=RECORDING');
            expect(all).not.toContain('s1');
        });

        it('identity objects flatten to scalars, counting nested values instead of dropping them silently', () => {
            const fields = flatScalars('stt', { engineId: 'private-v2', modelName: 'base.en/q4', threads: 4, extra: { a: 1 }, isMock: false });
            survives(fields);
            expect(fields).toMatchObject({ stt_present: true, stt_engine_id: 'private-v2', stt_model_name: 'base.en_q4', stt_threads: 4, stt_is_mock: false, stt_nested_fields: 1 });
            expect(flatScalars('cpu', null)).toEqual({ cpu_present: false });
        });

        it('safeValue keeps closed characters and bounds length', () => {
            expect(safeValue('/a?b="c"')).toBe('_a_b=_c_');
            expect(safeValue('x'.repeat(400))).toHaveLength(300);
        });
    });

    describe('AI suggestions in the job log (synthetic only)', () => {
        const pair = { shownWell: 'Clear plan.', shownNext: 'Pause first.', savedWell: 'Clear plan.', savedNext: 'Pause first.' };
        it('one parseable line with responses, shown, saved and the match', () => {
            const line = aiSuggestionsLogLine({ fixtureKind: 'synthetic', responses: [{ at: 140000, status: 200, latencyMs: 4800.6 }], ...pair });
            expect(line.startsWith('AI_SUGGESTIONS_SYNTHETIC ')).toBe(true);
            const body = JSON.parse(line.slice('AI_SUGGESTIONS_SYNTHETIC '.length));
            expect(body).toEqual({
                responses: [{ at_ms: 140000, status: 200, latency_ms: 4801 }],
                shown: { what_went_well: 'Clear plan.', what_to_try_next: 'Pause first.' },
                saved: { what_went_well: 'Clear plan.', what_to_try_next: 'Pause first.' },
                shown_matches_saved: true,
            });
        });
        it('CASUALTY: a human or unknown fixture prints nothing', () => {
            expect(aiSuggestionsLogLine({ fixtureKind: 'human', responses: [], ...pair })).toBe('');
            expect(aiSuggestionsLogLine({ fixtureKind: '', responses: [], ...pair })).toBe('');
        });
    });
});
