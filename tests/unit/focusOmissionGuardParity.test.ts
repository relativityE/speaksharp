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
    ].map((next) => [next, LABELS] as [string, readonly string[]]),
    ['You keep missing the mission statement.', ['Mission statement']],
    ['Your mission statement was clear and well paced.', ['Mission statement', 'Launch date']],
    ["Don't skip the guarantee next time.", null],
    ["Don't skip the guarantee next time.", []],
    ['You missed the guarantee.', null],
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
