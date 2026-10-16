// @vitest-environment node
/**
 * #1258 R4 (row 5) — the coaching checks text can prove, each with its failing controls, and the guards that bind them to
 * the Edge contract, the journeys and the acceptance map (including the provider-outage path).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    COACHING_CHARACTER_CEILING, characterCeilingVerdict, fillerAdviceVerdict, openPointReferenceVerdict, readTwoTakesCoaching,
    takesDifferVerdict,
} from '../live/helpers/rwtCoachingConsistency';
import { requiredAutomatedRows } from '../live/helpers/rwtAcceptance';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const words = (n: number) => 'x'.repeat(n);

describe('characterCeilingVerdict — the provider schema\'s own 240-character ceiling', () => {
    it('reads the same ceiling the Edge function enforces', () => {
        expect(COACHING_CHARACTER_CEILING).toEqual({ what_worked: 240, what_to_try_next: 240 });
        expect(src('backend/supabase/functions/get-ai-suggestions/index.ts'))
            .toContain('what_worked: coachingContract.generationConfig.responseSchema.properties.what_worked.maxLength');
    });
    it('at the ceiling → PASS; one over → FAIL; nothing shown → HOLD', () => {
        expect(characterCeilingVerdict(words(240), words(240)).status).toBe('PASS');
        expect(characterCeilingVerdict(words(241), words(10)).detail).toBe('What worked exceeds the character ceiling');
        expect(characterCeilingVerdict(words(10), words(241)).detail).toBe('What to try next exceeds the character ceiling');
        expect(characterCeilingVerdict('', '').status).toBe('HOLD');
    });
});

describe('fillerAdviceVerdict — no "cut your fillers" for a take with none', () => {
    it('filler advice with zero saved fillers → FAIL (fillers, um, uh, ummm)', () => {
        for (const next of ['Cut the filler words before each point.', 'Try pausing instead of saying um.', 'Fewer uhs next time.', 'Drop the ummm.']) {
            expect({ next, status: fillerAdviceVerdict({ next, savedFillerTotal: 0 }).status }).toEqual({ next, status: 'FAIL' });
        }
    });
    it('no filler advice, or filler advice when fillers were saved → PASS; words containing "um" are not advice', () => {
        expect(fillerAdviceVerdict({ next: 'Slow down on the summary of your numbers.', savedFillerTotal: 0 }).status).toBe('PASS');
        expect(fillerAdviceVerdict({ next: 'Cut the filler words.', savedFillerTotal: 3 }).status).toBe('PASS');
    });
    it('no phrase or an unreadable count → HOLD', () => {
        expect(fillerAdviceVerdict({ next: '', savedFillerTotal: 0 }).status).toBe('HOLD');
        expect(fillerAdviceVerdict({ next: 'Cut the filler words.', savedFillerTotal: null }).status).toBe('HOLD');
    });
});

describe('takesDifferVerdict — not generic across takes', () => {
    const a = { well: 'You opened with the price.', next: 'Pause before the close.' };
    it('the identical pair (ignoring case and spacing) for different evidence → FAIL', () => {
        expect(takesDifferVerdict(a, { well: ' you opened with the  price. ', next: 'PAUSE before the close.' }, true).status).toBe('FAIL');
    });
    it('different pairs → PASS; a missing pair or evidence that did not differ → HOLD', () => {
        expect(takesDifferVerdict(a, { well: a.well, next: 'Name the next step.' }, true).status).toBe('PASS');
        expect(takesDifferVerdict(a, null, true).status).toBe('HOLD');
        expect(takesDifferVerdict(a, a, false).status).toBe('HOLD');
        expect(takesDifferVerdict(a, a, null).status).toBe('HOLD');
    });
    it('the read waits for both pairs (bounded) and compares saved word counts', async () => {
        let reads = 0;
        const admin = {
            from: () => ({ select: () => ({ eq: () => ({ in: async () => {
                reads += 1;
                return { data: [
                    { id: 's1', ai_suggestions: a, total_words: 120 },
                    { id: 's2', ai_suggestions: reads > 1 ? { what_worked: 'w', what_to_try_next: 'n' } : null, total_words: 40 },
                ].map((r) => ({ ...r, ai_suggestions: r.ai_suggestions && 'well' in r.ai_suggestions
                    ? { what_worked: r.ai_suggestions.well, what_to_try_next: r.ai_suggestions.next } : r.ai_suggestions })), error: null };
            } }) }) }),
        };
        const out = await readTwoTakesCoaching(admin as never, 'u', 's1', 's2', 0);
        expect(out.second).toBeNull(); // bound reached before the second pair saved
        expect(out.evidenceDiffers).toBe(true);
    });
});

describe('openPointReferenceVerdict — Focus advice and the points still open', () => {
    const labels = ['State the pricing change', 'Name the launch date', 'Thank the team'];
    it('advice that refers to an open point → PASS; no open point at all → PASS', () => {
        expect(openPointReferenceVerdict({ well: 'Good opening.', next: 'Give the launch date its own sentence.', labels, statuses: ['covered', 'missing', 'covered'] }).status).toBe('PASS');
        expect(openPointReferenceVerdict({ well: 'a', next: 'b', labels, statuses: ['covered', 'covered', 'covered'] }).status).toBe('PASS');
    });
    it('advice naming no open point → HOLD, never FAIL (the human check decides; no omission claims)', () => {
        const v = openPointReferenceVerdict({ well: 'Clear voice.', next: 'Slow down a little.', labels, statuses: ['covered', 'partial', 'covered'] });
        expect(v.status).toBe('HOLD');
    });
    it('short or common words never count as a reference', () => {
        expect(openPointReferenceVerdict({ well: 'Thank you.', next: 'Name your team.', labels: ['the team'], statuses: ['missing'] }).status).toBe('PASS');
        expect(openPointReferenceVerdict({ well: 'Good.', next: 'Say it with care.', labels: ['with the plan'], statuses: ['missing'] }).status).toBe('HOLD');
    });
});

describe('guards — the journeys write every R4 row, and a provider outage settles them', () => {
    it('Open Mic and Focus require the R4 rows', () => {
        const openMic = requiredAutomatedRows('open-mic-first-session')!.product;
        for (const step of ['coaching within the character ceiling', 'coaching consistent with saved fillers', 'coaching differs between takes']) {
            expect(openMic).toContain(step);
        }
        for (const suite of ['focus-points-session', 'focus-points-partial']) {
            const focus = requiredAutomatedRows(suite)!.product;
            expect(focus).toContain('Focus coaching within the character ceiling');
            expect(focus).toContain('Focus coaching refers to an open point');
        }
    });
    it('each row is written on the success path, and the Focus rows also on the outage path', () => {
        const openMic = src('tests/live/rwt-open-mic-first-session.live.spec.ts');
        for (const step of ['coaching within the character ceiling', 'coaching consistent with saved fillers', 'coaching differs between takes']) {
            expect(openMic).toContain(`'${step}'`);
        }
        const journey = src('tests/live/helpers/rwtJourney.ts');
        const outage = src('tests/live/helpers/coachingExternal.ts');
        for (const step of ['Focus coaching within the character ceiling', 'Focus coaching refers to an open point']) {
            expect(journey).toContain(`'${step}'`);
            expect(outage).toContain(`'${step}'`);
        }
        expect(src('tests/live/helpers/rwtFocusPointsJourney.ts')).toContain('coaching.openPoints = { labels: points, statuses: firstTakeRail };');
    });
    it('the Open Mic outage scope lists its R4 rows as provider-dependent', () => {
        const acceptance = src('tests/live/helpers/rwtAcceptance.ts');
        expect(acceptance).toContain("'coaching within the character ceiling', 'coaching consistent with saved fillers', 'coaching differs between takes',\n            ...COACHING_DEPENDENT_ANALYTICS_ROWS,");
    });
});
