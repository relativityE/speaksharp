// @vitest-environment node
/**
 * AHT-01 same-target-numeric (run 43065574631 HOLD `completed-comparable-repeat-unavailable`): the Practice-again save take
 * recorded 7 s, below progress eligibility (>= 30 s, >= 75 words) by construction. Open Mic now uses a FIXED candidate
 * comparable duration (budget validation pending at integration); the numeric row reports the repeat take's stored eligibility as a bounded,
 * formula-bound, closed-code DIAGNOSTIC that never sets the verdict. Nothing here proves a historical cause.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPEN_MIC_COMPARABLE_SAVE_TAKE_MS, SAVE_TAKE_PERSIST_MS, saveTakeDuration } from '../live/helpers/rwtJourney';
import {
    PROGRESS_EXCLUSION_REASONS, numericComparisonRow, readRepeatEligibility, repeatEligibilityEvidence, type EvalReader, type RepeatEligibility,
} from '../live/helpers/rwtHarnessParity';
import { takesDifferVerdict } from '../live/helpers/rwtCoachingConsistency';
import { PROGRESS_ELIGIBILITY } from '../../frontend/src/services/progress/buildProgressEvaluation';

const ROOT = path.join(__dirname, '../..');
const A = 'aaaaaaaa-1111-4222-8333-444455556666', U = 'uuuuuuuu-1111-4222-8333-444455556666', F = 'clarity_v1';

describe('candidate save-take sizing (uniform-rate arithmetic only, not a guarantee)', () => {
    it('42 s is >= the eligibility duration and shorter than the script; the arithmetic floor clears the word floor', () => {
        // open_mic_tts.wav as measured: 60.65 s loop, scripted speech ends at 45.6 s, 129 scripted words.
        const seconds = OPEN_MIC_COMPARABLE_SAVE_TAKE_MS / 1000;
        expect(seconds).toBeGreaterThanOrEqual(PROGRESS_ELIGIBILITY.MIN_DURATION_SECONDS);
        expect(seconds).toBeLessThan(45.6);
        expect(Math.floor((seconds - (60.65 - 45.6)) * (129 / 45.6))).toBeGreaterThanOrEqual(PROGRESS_ELIGIBILITY.MIN_WORD_COUNT);
    });
});

describe('save-take duration is behavioural: default, fallback and time budget', () => {
    it('the default and every invalid option fall back to the 7 s persist take', () => {
        expect(SAVE_TAKE_PERSIST_MS).toBe(7_000);
        for (const v of [undefined, null, 3_000, 6_999, 1.5, Number.NaN, Infinity, '42000', 120_001]) expect(saveTakeDuration(v)).toBe(7_000);
        for (const v of [7_000, 42_000, 120_000]) expect(saveTakeDuration(v)).toBe(v);
    });
    it('Focus passes fixture-specific comparable durations while Open Mic retains its own duration', () => {
        const callers = ['tests/live/helpers/rwtFocusPointsJourney.ts', 'tests/live/rwt-open-mic-first-session.live.spec.ts']
            .map((f) => readFileSync(path.join(ROOT, f), 'utf8'));
        const sizing = /const saveTakeMs = fixtureKey === 'focus_points_partial_tts' \? ([\d_]+) : ([\d_]+);/.exec(callers[0]);
        expect(sizing).not.toBeNull();
        const partial = Number(sizing![1].replaceAll('_', ''));
        const full = Number(sizing![2].replaceAll('_', ''));
        expect([partial, full]).toEqual([60_000, 42_000]);
        expect(callers[0]).toMatch(/practiceAgainEvidence\([\s\S]*?\{ saveTakeMs \}\)/);
        expect(callers[0]).toContain('numericComparisonRow(receipt, result, repeatEligibility, saveTakeMs)');
        expect(callers[0]).toContain("const sourceTakeMs = fixtureKey === 'focus_points_partial_tts' ? 60_000 : Math.round((fixture.entry.speechSeconds + 4) * 1000);");
        const frozen = callers[0].indexOf('await freezeMarkerObserver(page, armed.token)');
        const extended = callers[0].indexOf('await page.waitForTimeout(Math.max(0, startedAt + sourceTakeMs - Date.now()))');
        const stopped = callers[0].indexOf('await stopBenchmarkRecording(page, suite, 180_000)', extended);
        expect(frozen).toBeGreaterThan(0);
        expect(extended).toBeGreaterThan(frozen);
        expect(stopped).toBeGreaterThan(extended);
        expect(callers[0].slice(extended, stopped)).not.toMatch(/sampleFocusRail|markerWindow.record|armMarkerObserver/);
        // Minimum speech in an arbitrary-phase looping window, uniform-rate sizing only.
        // Partial needs a second loop: a 42 s window cannot provide 75 scripted words.
        const minWords = (ms: number, loop: number, speech: number, words: number) => {
            const seconds = ms / 1000;
            const heard = Math.floor(seconds / loop) * speech + Math.max(0, seconds % loop - (loop - speech));
            return Math.floor(heard * words / speech);
        };
        expect(minWords(42_000, 37.01, 21.96, 60)).toBeLessThan(PROGRESS_ELIGIBILITY.MIN_WORD_COUNT);
        for (const [ms, loop, speech, words] of [[partial, 37.01, 21.96, 60], [60_000, 37.01, 21.96, 60], [full, 61.21, 46.17, 129], [50_200, 61.21, 46.17, 129]]) {
            expect(saveTakeDuration(ms)).toBe(ms);
            expect(ms / 1000).toBeGreaterThanOrEqual(PROGRESS_ELIGIBILITY.MIN_DURATION_SECONDS);
            expect(minWords(ms, loop, speech, words)).toBeGreaterThanOrEqual(PROGRESS_ELIGIBILITY.MIN_WORD_COUNT);
        }
        expect(callers[1]).toMatch(/saveTakeMs = OPEN_MIC_COMPARABLE_SAVE_TAKE_MS;/);
        // the budget is stated as unproven, not claimed
        expect(readFileSync(path.join(ROOT, 'tests/live/helpers/rwtJourney.ts'), 'utf8')).toMatch(/Time budget: NOT proven here/);
    });
    it('the distinct-coaching comparison keeps its equal-count HOLD (a shorter take is not assumed to differ)', () => {
        const pair = { well: 'w', next: 'n' };
        expect(takesDifferVerdict(pair, { well: 'w2', next: 'n2' }, false).status).toBe('HOLD');
        expect(takesDifferVerdict(pair, { well: 'w2', next: 'n2' }, null).status).toBe('HOLD');
    });
});

/** A scripted evaluation reader: records the filters, answers per mode. */
const reader = (mode: 'row' | 'none' | 'error' | 'reject' | 'hang', row: Record<string, unknown> = {}) => {
    const filters: [string, string][] = [];
    const db: EvalReader = {
        from: () => ({
            select: () => {
                const q = {
                    eq: (k: string, v: string) => { filters.push([k, v]); return q; },
                    maybeSingle: () => (mode === 'reject' ? Promise.reject(new Error('net'))
                        : mode === 'hang' ? new Promise<never>(() => undefined)
                            : Promise.resolve(mode === 'error' ? { data: null, error: { code: 'PGRST116' } }
                                : { data: mode === 'none' ? null : { session_id: A, user_id: U, formula_version: F, eligible: false, exclusion_reasons: ['too_short'], ...row }, error: null })),
                };
                return q;
            },
        }),
    };
    return { db, filters };
};
const readOf = (r: ReturnType<typeof reader>, timeoutMs?: number) => readRepeatEligibility(r.db, { sessionId: A, userId: U, formulaVersion: F, timeoutMs });

describe('the repeat-eligibility read is bounded, fail-closed and bound to (session, owner, formula version)', () => {
    it('filters on exactly the session, owner and formula version', async () => {
        const r = reader('row');
        expect(await readOf(r)).toEqual({ state: 'observed', eligible: false, exclusionReasons: ['too_short'] });
        expect(r.filters).toEqual([['session_id', A], ['user_id', U], ['formula_version', F]]);
    });
    it('no row is `absent` (missing/pending), never ineligible; an error (e.g. multiple versions) or rejection is `unread`', async () => {
        expect(await readOf(reader('none'))).toEqual({ state: 'absent' });
        expect(await readOf(reader('error'))).toEqual({ state: 'unread' });
        expect(await readOf(reader('reject'))).toEqual({ state: 'unread' });
    });
    it('a read that never settles times out to `unread` within its bound', async () => {
        const started = Date.now();
        expect(await readOf(reader('hang'), 25)).toEqual({ state: 'unread' });
        expect(Date.now() - started).toBeLessThan(2_000);
    });
    it('a returned row for another session, owner or formula version, or with malformed fields, is `contradictory`', async () => {
        for (const row of [{ session_id: 'other' }, { user_id: 'other' }, { formula_version: 'clarity_v2' }, { eligible: 'no' }, { exclusion_reasons: 'too_short' }]) {
            expect(await readOf(reader('row', row))).toEqual({ state: 'contradictory' });
        }
    });
});

describe('eligibility evidence: closed codes only, consistency enforced', () => {
    const obs = (eligible: boolean, codes: unknown[]): RepeatEligibility => ({ state: 'observed', eligible, exclusionReasons: codes });
    it('the closed list matches the product ExclusionReason union exactly (drift control)', () => {
        const src = readFileSync(path.join(ROOT, 'frontend/src/services/progress/buildProgressEvaluation.ts'), 'utf8');
        const union = /export type ExclusionReason =([\s\S]*?);/.exec(src)![1];
        expect([...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...PROGRESS_EXCLUSION_REASONS].sort());
    });
    it('observed codes are reported sorted; unknown, duplicate or inconsistent values become `contradictory` and never escape', () => {
        expect(repeatEligibilityEvidence(obs(false, ['too_short', 'too_few_words']))).toEqual({ repeatEligibility: 'ineligible', repeatExclusions: 'too_few_words,too_short' });
        expect(repeatEligibilityEvidence(obs(true, []))).toEqual({ repeatEligibility: 'eligible', repeatExclusions: '' });
        for (const bad of [obs(false, ['made_up']), obs(false, ['too_short', 'too_short']), obs(true, ['too_short']), obs(false, []), obs(false, [7])]) {
            const ev = repeatEligibilityEvidence(bad);
            expect(ev).toEqual({ repeatEligibility: 'contradictory', repeatExclusions: null });
            expect(JSON.stringify(ev)).not.toContain('made_up');
        }
        for (const state of ['absent', 'unread', 'contradictory'] as const) expect(repeatEligibilityEvidence({ state })).toEqual({ repeatEligibility: state, repeatExclusions: null });
    });
});

describe('the numeric row: the adapter alone sets the verdict; diagnostics cannot be overwritten', () => {
    const rowsOf = (r: Parameters<typeof numericComparisonRow>[1], e?: RepeatEligibility, ms?: number) => {
        const rows: { verdict: string; evidence?: Record<string, unknown> }[] = [];
        numericComparisonRow({ row: (_s: string, verdict: string, _d: string, evidence?: Record<string, unknown>) => { rows.push({ verdict, evidence }); } } as never, r, e, ms);
        return rows;
    };
    it('the run shape (non-comparable repeat) stays HOLD and carries the observed eligibility and take duration', () => {
        expect(rowsOf({ result: 'NOT RUN', facts: { reason: 'completed-comparable-repeat-unavailable' } },
            { state: 'observed', eligible: false, exclusionReasons: ['too_short', 'too_few_words'] }, 7_000)[0])
            .toMatchObject({ verdict: 'HOLD', evidence: { reason: 'completed-comparable-repeat-unavailable', repeatEligibility: 'ineligible', repeatExclusions: 'too_few_words,too_short', saveTakeSeconds: 7 } });
    });
    it('eligibility never upgrades or downgrades: PASS/FAIL/HOLD are the adapter\'s, whatever the diagnostic says', () => {
        const eligible: RepeatEligibility = { state: 'observed', eligible: true, exclusionReasons: [] };
        expect(rowsOf({ result: 'PASS', facts: { reason: 'persisted-original-to-linked-repeat-values-match' } }, { state: 'unread' })[0].verdict).toBe('PASS');
        expect(rowsOf({ result: 'FAIL', facts: { reason: 'wrong-source-session-route' } }, eligible)[0].verdict).toBe('FAIL');
        expect(rowsOf({ result: 'NOT RUN', facts: { reason: 'x' } }, eligible)[0].verdict).toBe('HOLD');
        expect(rowsOf(null, eligible)[0]).toMatchObject({ verdict: 'HOLD', evidence: { reason: 'not-observed', repeatEligibility: 'eligible' } });
    });
    it('an adapter fact cannot overwrite a diagnostic key; callers passing no diagnostics keep the old evidence shape', () => {
        const [row] = rowsOf({ result: 'NOT RUN', facts: { reason: 'x', repeatEligibility: true, saveTakeSeconds: true, exactPersistedValues: false } }, { state: 'absent' }, 42_000);
        expect(row.evidence).toMatchObject({ repeatEligibility: 'absent', saveTakeSeconds: 42, exactPersistedValues: false });
        expect(Object.keys(rowsOf({ result: 'NOT RUN', facts: { reason: 'x' } })[0].evidence ?? {})).toEqual(['reason']);
    });
});
