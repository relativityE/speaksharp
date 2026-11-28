// @vitest-environment node
/**
 * Live J3.b run 46097290741 — the Edge Focus omission guard and the live acceptance row must judge the same phrase the same
 * way. The Edge tree cannot import the live helper (not deployed) and the live typecheck may not import the Edge tree, so the
 * classifier is mirrored; this test is the binding. It fails if a phrase family, a regex or the decision rule drifts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { omissionClaimVerdict } from '../live/helpers/rwtCoachingConsistency';
import {
    COLLECTIVE_POINTS, IMPERATIVE_OMIT, NEGATOR, OMISSION_WORD, PAST_CLAIM, PRESENT_MISSING,
    classifyOmission, guardFocusOmission, isServableOmissionForm, type FocusGuardPoint,
} from '../../backend/supabase/functions/get-ai-suggestions/focusOmissionGuard';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIVE = readFileSync(path.join(ROOT, 'tests/live/helpers/rwtCoachingConsistency.ts'), 'utf8');
const LABELS = ['Money-back guarantee', 'Launch date', 'Pricing tiers'];
const WELL = 'Clear opening with a steady pace.';

/** Every phrase the live classifier's own unit corpus names, plus clarity/placement advice the product allows. */
const CORPUS: Array<[string, readonly string[] | null]> = [
    ...['You missed the money-back guarantee.', 'The launch date was not mentioned.', "You didn't cover the pricing tiers.",
        'You left it out at the end.', 'You forgot the guarantee.', 'The guarantee went unmentioned.', 'You skipped your strongest point.',
        'You never mentioned the guarantee.', 'The launch date was never covered.', "You haven't mentioned the launch date.",
        'The pricing tiers have not been covered.', 'The guarantee has never been addressed.', 'You skipped every point.',
        "Don't skip the guarantee next time.", 'Never forget the launch date.', 'The pricing tiers are still missing.',
        'The missing guarantee needs a mention.', 'No chosen point was overlooked.', 'You covered every point; nothing was omitted.',
        'Not one point was skipped.', 'No clear signposting meant you skipped the launch date.',
        'Nothing was omitted, but you skipped the launch date.', 'You are missing one of your chosen points.',
        'Do not skip any of your points next time.', 'Omit filler words when introducing the launch date.', 'You skip the launch date.',
        'Leaving out the launch date weakens the close.', 'Skip the filler words between points.', "Don't miss a breath before the close.",
        'Avoid skipping transitions.', 'Name the guarantee early so it is unmistakable.', 'Pause before the launch date so it lands.',
        'Make point 2 clearer by naming it first.', 'Signpost your third point earlier.', 'You never got to the pricing tiers; open with them.',
        'The launch date was overlooked.', 'You omitted the pricing tiers.', 'You did not get to the pricing tiers.', 'The guarantee was left out.',
        // PM review of #1993: time-out omissions, attributive participles, an object noun after "you missed".
        'You ran out of time before getting to the pricing tiers.', "You didn't get a chance to cover the launch date.",
        'You never got around to the guarantee.', 'You missed pricing tiers.', 'Name the cost of missed deadlines before the close.',
        'Flag the skipped steps in the rollout before the demo.',
        'Discuss the cost of missed deadlines.', 'Missed pricing tiers.', 'The speaker missed pricing tiers.', 'You missed Money-back guarantee.',
    ].map((next) => [next, LABELS] as [string, readonly string[]]),
    ['You keep missing the mission statement.', ['Mission statement']],
    ['Your mission statement was clear and well paced.', ['Mission statement', 'Launch date']],
    ["Don't skip the guarantee next time.", null],
    ["Don't skip the guarantee next time.", []],
    ['You missed the guarantee.', null],
    // Review of #1999: verbal omissions with an intervening adverb, and a short label inside an omission verb.
    ['You also missed two of your chosen points.', ['Launch date', 'Pricing tiers']],
    ['You completely skipped mentioning the launch date.', ['Launch date', 'Pricing tiers']],
    ['The pricing tiers were omitted.', ['IT', 'Pricing tiers']],
    ['You left it out at the end.', ['IT', 'Pricing tiers']],
    // PM review at 307c686a: a label word as the predicate, and "and" alone, never make a verb attributive.
    ['You missed deadlines.', ['Missed deadlines']],
    ['Discuss the cost of missed deadlines.', ['Missed deadlines']],
    ['You covered the launch date and omitted details.', ['Launch date', 'Pricing tiers']],
    ['You finished one point and skipped mentioning others.', ['Launch date', 'Pricing tiers']],
    // Review of #1999 at 68a70284: a stranded preposition before the main verb; pacing advice is not a time-out omission.
    ['The section you focused on missed two of your chosen points.', ['Launch date', 'Pricing tiers']],
    ["You didn't have time to pause before the launch date.", ['Launch date', 'Pricing tiers']],
    ["You didn't have time to mention the launch date.", ['Launch date', 'Pricing tiers']],
    ["You didn't get around to pausing between points.", ['Launch date', 'Pricing tiers']],
    ['You never got around to the guarantee.', ['Money-back guarantee']],
    // Review of #1999 at 1f4f8b17: an attributive participle whose clause names a chosen point elsewhere is still a claim.
    ['The omitted detail was the launch date.', ['Launch date', 'Pricing tiers']],
    ['The skipped second point was the pricing tiers.', ['Launch date', 'Pricing tiers']],
    ['The skipped second point needs a clearer opening.', ['Launch date', 'Pricing tiers']],
    // Review of #1999 at 183c12fc: a point reference anywhere in the clause, or a speech-content noun, keeps it a claim.
    ['The skipped portion of your chosen points needs attention.', ['Launch date', 'Pricing tiers']],
    ['The skipped part of point 2 needs work.', ['Launch date', 'Pricing tiers']],
    ['The missed topic needs a clearer introduction.', ['Launch date', 'Pricing tiers']],
    ['The skipped material from your chosen points needs attention.', ['Launch date', 'Pricing tiers']],
    ['The omitted example in point 2 needs work.', ['Launch date', 'Pricing tiers']],
    // A label that itself contains an omission participle: quoting it is not an omission claim.
    ['Your point on missed deadlines landed well.', ['Measure missed deadlines and time spent']],
    ['You missed the deadlines point.', ['Measure missed deadlines and time spent']],
];

describe('Edge Focus omission guard ⇔ live acceptance classifier', () => {
    it('mirrors every phrase-family regex byte for byte (source and flags)', () => {
        for (const [name, regex] of Object.entries({ PAST_CLAIM, OMISSION_WORD, IMPERATIVE_OMIT, PRESENT_MISSING, NEGATOR, COLLECTIVE_POINTS })) {
            expect({ name, mirrored: LIVE.includes(`const ${name} = /${regex.source}/${regex.flags};`) }).toEqual({ name, mirrored: true });
        }
    });

    it('assigns the same omission form as the live row to every corpus phrase', () => {
        for (const [next, labels] of CORPUS) {
            const live = omissionClaimVerdict({ well: WELL, next, labels });
            expect({ next, form: classifyOmission(`${WELL}. ${next}`, labels) }).toEqual({ next, form: live.form });
        }
    });

    it('serves only what the live row PASSes; anything it FAILs or HOLDs is not servable', () => {
        for (const [next, labels] of CORPUS) {
            const live = omissionClaimVerdict({ well: WELL, next, labels });
            expect({ next, servable: isServableOmissionForm(classifyOmission(next, labels)) }).toEqual({ next, servable: live.status === 'PASS' });
        }
    });

    it('a guarded pair always passes the live "Focus coaching makes no omission claim" row', () => {
        const points: FocusGuardPoint[] = LABELS.map((label, i) => ({ label, verdict: i < 2 ? 'detected' : 'not_detected' }));
        for (const [next] of CORPUS.filter(([, labels]) => labels === LABELS)) {
            for (const pair of [{ what_worked: WELL, what_to_try_next: next }, { what_worked: next, what_to_try_next: WELL }]) {
                const { suggestions } = guardFocusOmission(pair, points);
                const live = omissionClaimVerdict({ well: suggestions.what_worked, next: suggestions.what_to_try_next, labels: LABELS });
                expect({ next, status: live.status }).toEqual({ next, status: 'PASS' });
            }
        }
    });
});

describe('the Focus prompt rules the Edge sends are the ones the live prompt binding reconstructs', () => {
    // tests/live/helpers/rwtCoachingEvidence.ts rebuilds the exact Edge prompt to bind each take's coaching to its saved
    // inputs. A rule changed on one side only would turn every J3.b binding into server_prompt_digest_mismatch.
    const edge = readFileSync(path.join(ROOT, 'backend/supabase/functions/get-ai-suggestions/index.ts'), 'utf8');
    const helper = readFileSync(path.join(ROOT, 'tests/live/helpers/rwtCoachingEvidence.ts'), 'utf8');
    it('every Focus coaching rule line and the undetected-point wording appear verbatim in both', () => {
        const rules = edge.slice(edge.indexOf('      Focus Points coaching rules:'), edge.indexOf('${allDetected ?'))
            .split('\n').filter((line) => line.startsWith('      - '));
        expect(rules.length).toBe(2);
        for (const line of rules) expect({ line, mirrored: helper.includes(`\\n${line}\\n`) }).toEqual({ line, mirrored: true });
        const undetected = "'not yet clearly detected by the keyword matcher (the speaker may have said it in other words)'";
        expect(edge).toContain(undetected);
        expect(helper).toContain(undetected);
        expect(rules.join('\n')).toContain('Never say a point was missed, skipped, forgotten, omitted, overlooked, left out, not mentioned, not covered or never reached');
    });
});

describe('PM review of #1993: precision of the guard (both copies)', () => {
    const form = (next: string, labels: readonly string[] | null = LABELS) => omissionClaimVerdict({ well: WELL, next, labels }).form;
    it('catches running out of time before a point, and other "did not get to it" forms', () => {
        expect(form('You ran out of time before getting to the pricing tiers.')).toBe('past_claim');
        expect(form("You didn't get a chance to cover the launch date.")).toBe('past_claim');
        expect(form('You never got around to the guarantee.')).toBe('past_claim');
    });
    it('does not flag an attributive participle about the topic ("missed deadlines")', () => {
        expect(form('Name the cost of missed deadlines before the close.')).toBe('none');
        expect(form('Flag the skipped steps in the rollout before the demo.')).toBe('none');
        expect(form('Your point on missed deadlines landed well.', ['Measure missed deadlines and time spent'])).toBe('none');
    });
    it('CONTROL: real omission claims about the speaker stay flagged', () => {
        expect(form('You missed the guarantee.')).toBe('past_claim');
        expect(form('You missed pricing tiers.')).toBe('past_claim');
        expect(form('The launch date was overlooked.')).toBe('past_claim');
        expect(form('You missed the deadlines point.', ['Measure missed deadlines and time spent'])).toBe('past_claim');
        expect(form('Skip the filler words between points.')).toBe('unrelated');
    });
    it('PM review: label text is context, not a mask: real claims about a chosen point are still caught', () => {
        expect(form('Discuss the cost of missed deadlines.')).toBe('none');
        expect(form('Missed pricing tiers.')).toBe('past_claim');
        expect(form('The speaker missed pricing tiers.')).toBe('past_claim');
        expect(form('You missed Money-back guarantee.')).toBe('past_claim');
    });
    it('review of #1999: an adverb before the participle keeps it a verb; a short label never masks part of a word', () => {
        expect(form('You also missed two of your chosen points.', ['Launch date', 'Pricing tiers'])).toBe('past_claim');
        expect(form('You completely skipped mentioning the launch date.', ['Launch date', 'Pricing tiers'])).toBe('past_claim');
        expect(form('The pricing tiers were omitted.', ['IT', 'Pricing tiers'])).toBe('past_claim');
        expect(form('You left it out at the end.', ['IT', 'Pricing tiers'])).toBe('past_claim');
    });

    it('PM review at 307c686a: classifier AND actual replacement agree on every paired case (no shared miss)', () => {
        const cases: Array<[string, readonly string[], 'flag' | 'serve']> = [
            ['You missed deadlines.', ['Missed deadlines'], 'flag'],
            ['Discuss the cost of missed deadlines.', ['Missed deadlines'], 'serve'],
            ['You covered the launch date and omitted details.', ['Launch date', 'Pricing tiers'], 'flag'],
            ['You finished one point and skipped mentioning others.', ['Launch date', 'Pricing tiers'], 'flag'],
            ['You also missed two of your chosen points.', ['Launch date', 'Pricing tiers'], 'flag'],
            ['The pricing tiers were omitted.', ['IT', 'Pricing tiers'], 'flag'],
            ['Flag the skipped steps in the rollout before the demo.', ['Launch date', 'Pricing tiers'], 'serve'],
            ['Your point on missed deadlines landed well.', ['Measure missed deadlines and time spent'], 'serve'],
            ['The section you focused on missed two of your chosen points.', ['Launch date', 'Pricing tiers'], 'flag'],
            ["You didn't have time to pause before the launch date.", ['Launch date', 'Pricing tiers'], 'serve'],
            ["You didn't have time to mention the launch date.", ['Launch date', 'Pricing tiers'], 'flag'],
            ["You didn't get around to pausing between points.", ['Launch date', 'Pricing tiers'], 'serve'],
            ['You never got around to the guarantee.', ['Money-back guarantee'], 'flag'],
            ['The omitted detail was the launch date.', ['Launch date', 'Pricing tiers'], 'flag'],
            ['The skipped second point was the pricing tiers.', ['Launch date', 'Pricing tiers'], 'flag'],
            ['The skipped second point needs a clearer opening.', ['Launch date', 'Pricing tiers'], 'flag'],
            ['The skipped portion of your chosen points needs attention.', ['Launch date', 'Pricing tiers'], 'flag'],
            ['The skipped part of point 2 needs work.', ['Launch date', 'Pricing tiers'], 'flag'],
            ['The missed topic needs a clearer introduction.', ['Launch date', 'Pricing tiers'], 'flag'],
            ['The skipped material from your chosen points needs attention.', ['Launch date', 'Pricing tiers'], 'flag'],
            ['The omitted example in point 2 needs work.', ['Launch date', 'Pricing tiers'], 'flag'],
        ];
        for (const [next, labels, expected] of cases) {
            const points: FocusGuardPoint[] = labels.map((label, i) => ({ label, verdict: i === 0 ? 'detected' : 'not_detected' }));
            const guarded = guardFocusOmission({ what_worked: WELL, what_to_try_next: next }, points);
            const live = omissionClaimVerdict({ well: WELL, next, labels });
            const replaced = guarded.replaced.includes('what_to_try_next');
            expect({ next, replaced, livePass: live.status === 'PASS' }).toEqual({ next, replaced: expected === 'flag', livePass: expected === 'serve' });
            // Whatever is served passes the live row.
            expect(omissionClaimVerdict({ well: guarded.suggestions.what_worked, next: guarded.suggestions.what_to_try_next, labels }).status).toBe('PASS');
        }
    });
});

