/**
 * RWT R4 (row 5) — automated coaching checks against the take's own saved evidence. The phrases are compared in Node
 * only and never enter a receipt; each verdict returns content-free details. Whether the advice is USEFUL stays the
 * PO's human judgement (`open_mic_coaching_relevant`, `focus_coaching_covers_points`); these rows only catch what text
 * can prove: a broken ceiling, advice that contradicts the saved counts, and an identical pair for different takes.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Verdict } from './rwtAbandonTakeover';

type Contract = { generationConfig: { responseSchema: { properties: Record<'what_worked' | 'what_to_try_next', { maxLength: number }> } } };
const contract = JSON.parse(readFileSync(
    // The DEPLOYED backend's contract, not this checkout's: this run branch is the served frontend tree (5a7bf6a1) while the backend
    // was released from fbc984fa (gemini-3.6-flash). deployedCoachingContract.json is that release's exact contract.json bytes, pinned.
    resolve(dirname(fileURLToPath(import.meta.url)), './deployedCoachingContract.json'), 'utf8',
)) as Contract;
/** The provider schema's own ceiling, the same number the Edge function enforces (COACHING_CHARACTER_CEILING). */
export const COACHING_CHARACTER_CEILING = Object.freeze({
    what_worked: contract.generationConfig.responseSchema.properties.what_worked.maxLength,
    what_to_try_next: contract.generationConfig.responseSchema.properties.what_to_try_next.maxLength,
});

/** Advice to cut fillers: names fillers, or the "um"/"uh" sounds themselves. */
export const FILLER_ADVICE = /\b(filler(s| words?)?|ums?|uhs?|u+m+|u+h+)\b/i;
const STOPWORDS = new Set(['your', 'with', 'that', 'this', 'from', 'have', 'what', 'when', 'will', 'about', 'they', 'them', 'into', 'than']);
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function characterCeilingVerdict(well: string, next: string): Verdict {
    if (well === '' && next === '') return { status: 'HOLD', detail: 'no phrases to measure' };
    const over = [
        well.length > COACHING_CHARACTER_CEILING.what_worked ? 'What worked' : null,
        next.length > COACHING_CHARACTER_CEILING.what_to_try_next ? 'What to try next' : null,
    ].filter(Boolean);
    return over.length === 0
        ? { status: 'PASS', detail: 'both phrases are within the character ceiling' }
        : { status: 'FAIL', detail: `${over.join(' and ')} exceeds the character ceiling` };
}

/** No advice to cut fillers when the saved take has none. */
export function fillerAdviceVerdict(o: { next: string; savedFillerTotal: number | null }): Verdict {
    if (o.next === '') return { status: 'HOLD', detail: 'no What to try next phrase to check' };
    if (o.savedFillerTotal === null) return { status: 'HOLD', detail: 'the saved filler count is unreadable' };
    if (o.savedFillerTotal === 0 && FILLER_ADVICE.test(o.next)) {
        return { status: 'FAIL', detail: 'the advice is to cut fillers, but the saved take has none' };
    }
    return { status: 'PASS', detail: o.savedFillerTotal === 0 ? 'no filler advice for a take with no fillers' : 'filler advice is consistent with the saved count' };
}

/** Two takes whose saved evidence differs must not receive the identical pair. */
export function takesDifferVerdict(
    first: { well: string; next: string } | null, second: { well: string; next: string } | null, evidenceDiffers: boolean | null,
): Verdict {
    if (!first || !second) return { status: 'HOLD', detail: 'two saved coaching pairs are needed to compare' };
    if (evidenceDiffers !== true) return { status: 'HOLD', detail: 'the two takes\' saved evidence did not differ, so identical advice proves nothing' };
    const identical = norm(first.well) === norm(second.well) && norm(first.next) === norm(second.next);
    return identical
        ? { status: 'FAIL', detail: 'two takes with different saved evidence received the identical coaching pair' }
        : { status: 'PASS', detail: 'the two takes received different coaching' };
}

/**
 * Focus: when a point is still open (partial or not detected), PASS when the advice evidently refers to one of those
 * points by its own words. It never FAILs on wording: the advice must not claim a point was missed (the matcher cannot
 * know), so an advice that names no open point is HOLD and the human check decides.
 */
export function openPointReferenceVerdict(o: { well: string; next: string; labels: readonly string[]; statuses: readonly (string | null)[] }): Verdict {
    // PM 6207105255: missing evidence never invents "all covered". The rail must be readable, complete and terminal.
    if (o.labels.length === 0 || o.statuses.length !== o.labels.length || o.labels.some((l) => l.trim() === '')) {
        return { status: 'HOLD', detail: 'the rail evidence is missing or does not match the set, so open points are unknown' };
    }
    if (o.statuses.some((s) => s !== 'covered' && s !== 'partial' && s !== 'missing')) {
        return { status: 'HOLD', detail: 'a point\'s final status is unreadable or not yet settled, so open points are unknown' };
    }
    const open = o.labels.filter((_, i) => o.statuses[i] === 'partial' || o.statuses[i] === 'missing');
    if (open.length === 0) return { status: 'PASS', detail: 'every point was explicitly covered; there is no open point to name' };
    if (o.well === '' && o.next === '') return { status: 'HOLD', detail: 'no phrases to check' };
    const text = norm(`${o.well} ${o.next}`);
    const words = (label: string) => norm(label).split(/[^a-z0-9']+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
    const referenced = open.some((label) => words(label).some((w) => new RegExp(`\\b${w}`).test(text)));
    return referenced
        ? { status: 'PASS', detail: 'the advice refers to a point that is still open' }
        : { status: 'HOLD', detail: 'the advice names no open point by its words; the human check decides' };
}

/**
 * J3 (Focus coaching) — "never say a point was missed, skipped or not mentioned" (the deployed prompt's own rule). The matcher only
 * knows what it detected, so advice must not assert an omission. Live run 44941790511 failed the old word match, which also flags
 * harmless advice ("skip the filler words"), and kept no phrase, so the receipt could not say which it was.
 *
 * Wording about omissions is often ambiguous, so this verdict FAILs only on high-precision forms, and answers an explicit HOLD
 * whenever the claim's target or polarity is uncertain; it never turns an uncertain case into PASS. This is a required
 * AUTOMATED row: nothing settles its HOLD today (no worksheet item binds to it; Sam on 0b6390a8), so an ambiguous phrase leaves
 * the row HOLD. A human resolution path would need its own reviewed design.
 *  - `past_claim` → FAIL: a past-tense statement that something was omitted ("you missed…", "…was never covered", "you left it
 *    out"), with no negator in the clause;
 *  - `implied_point` → FAIL: an imperative whose object, within three words, is a chosen point ("don't skip the guarantee");
 *  - `present_point` → FAIL: a chosen point directly said to be missing ("the pricing tiers are still missing", "missing the
 *    guarantee");
 *  - `ambiguous` → HOLD: omission wording with a negator in the clause ("nothing was omitted", "no signposting meant you skipped…"),
 *    a collective reference to the chosen points ("one of your points"), or a chosen point mentioned elsewhere in the clause
 *    ("omit filler words when introducing the launch date");
 *  - `unknown_point` → HOLD: omission wording, but the take's point labels are unknown;
 *  - `unrelated` → PASS: omission wording about something that is plainly not a chosen point ("skip the filler words");
 *  - `none` → PASS: no omission wording.
 * Only these closed tokens are recorded, never the phrase.
 */
export type OmissionForm = 'none' | 'past_claim' | 'implied_point' | 'present_point' | 'ambiguous' | 'unrelated' | 'unknown_point';
const PAST_CLAIM = /\b(missed|skipped|forgot|forgotten|omitted|overlooked)\b|\bleft\s+(?:(?:it|them|that|this)\s+)?out\b|\b(?:didn'?t|did\s+not|never)\s+(?:mention|cover|say|address|include|get\s+to)\b|\b(?:never|(?:was|were)(?:n'?t|\s+not|\s+never)|(?:has|have)(?:n'?t|\s+not|\s+never)(?:\s+been)?)\s+(?:mentioned|covered|said|addressed|included|got\s+to)\b|\bwent\s+unmentioned\b|\bran\s+out\s+of\s+time\s+before\s+(?:getting\s+to|reaching|covering|mentioning)\b|\b(?:didn'?t|did\s+not)\s+(?:get|have)\s+(?:the\s+)?(?:time|a\s+chance)\s+to\b|\b(?:didn'?t|did\s+not|never)\s+got?\s+around\s+to\b/i;
// The verbs' own inflections only, so `mission` or `skipper` never match (Codex P2 on 01363817).
const OMISSION_WORD = /\b(?:miss(?:es|ed|ing)?|skip(?:s|ped|ping)?|forg(?:et|ets|etting|ot|otten)|left\s+out|leav(?:e|es|ing)\s+out|omit(?:s|ted|ting)?|overlook(?:s|ed|ing)?|unmentioned)\b/i;
const IMPERATIVE_OMIT = /\b(?:don'?t|do\s+not|never|avoid)\s+(?:skip(?:ping)?|miss(?:ing)?|forget(?:ting)?|leav(?:e|ing)\s+out|omit(?:ting)?)\b((?:\s+\S+){1,3})/i;
const PRESENT_MISSING = /(\S+(?:\s+\S+){0,2})\s+(?:is|are|was|were|still)\s+(?:still\s+)?missing\b|\bmissing\s+((?:\S+\s+){0,2}\S+)/i;
/** A negator anywhere in the clause makes an omission statement's polarity uncertain (denial, or a negated cause). */
const NEGATOR = /\b(?:no|nothing|none|neither|nor|not\s+(?:a|one|any|a\s+single))\b/i;
/** A collective reference to the take's chosen points, without naming one. */
const COLLECTIVE_POINTS = /\b(?:your|chosen|selected|focus|each|every|any|all)\s+(?:\w+\s+)?points?\b|\bone\s+of\s+(?:your|the)\s+(?:\w+\s+)?points?\b/i;

/**
 * An omission participle used ATTRIBUTIVELY, right after a determiner or preposition ("the cost of missed deadlines",
 * "flag the skipped steps"), describes the topic, not the speaker, unless its noun names a chosen point; any other position
 * ("you also missed…", "and omitted details", "completely skipped mentioning…") stays a verb, and so does a gerund after
 * it. Only the omission test reads the rewritten text; every point lookup reads the original clause.
 */
const ATTRIBUTIVE_PARTICIPLE = /(?<=\b(?:the|a|an|of|for|on|about|with|any|no|those|these|their|its|by|from|in|to)\s+)\b(missed|skipped|forgotten|omitted|overlooked)(\s+)([a-z0-9][\w'-]*)/gi;
const NOT_A_TOPIC_NOUN = new Set(['it', 'them', 'that', 'this', 'those', 'these', 'the', 'a', 'an', 'your', 'my', 'our', 'his', 'her', 'their', 'one', 'any', 'every', 'each', 'all', 'point', 'points', 'to', 'out', 'on', 'over', 'in', 'at', 'by', 'with']);
function omissionProbe(clause: string, labels: readonly string[] | null, names: (t: string) => boolean): string {
    const normalizedLabels = (labels ?? []).map((label) => norm(label)).filter(Boolean);
    // No label masking: a label word used as the predicate ("You missed deadlines" with the label "Missed deadlines") stays a
    // claim. A quoted label is attributive anyway ("the cost of missed deadlines") and is handled below (PM review at 307c686a).
    return clause.replace(ATTRIBUTIVE_PARTICIPLE, (whole: string, participle: string, space: string, noun: string) => {
        const quotesLabel = normalizedLabels.some((label) => label.includes(`${participle.toLowerCase()} ${noun.toLowerCase()}`));
        // A gerund after the participle ("skipped mentioning…") is a verb phrase, never a topic noun.
        if (NOT_A_TOPIC_NOUN.has(noun.toLowerCase()) || /ing$/i.test(noun) || (names(noun) && !quotesLabel)) return whole;
        return `${space}${noun}`;
    });
}
export function omissionClaimVerdict(o: { well: string; next: string; labels: readonly string[] | null }): Verdict & { form: OmissionForm } {
    const labelWords = (o.labels ?? []).flatMap((label) => norm(label).split(/[^a-z0-9']+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
    const names = (text: string) => labelWords.some((w) => new RegExp(`\\b${w}`).test(norm(text)));
    const clauses = `${o.well}. ${o.next}`.split(/[.;!?]+/).map((c) => c.trim()).filter(Boolean);
    let form = 'none' as OmissionForm;
    const rank: Record<OmissionForm, number> = { none: 0, unrelated: 1, unknown_point: 2, ambiguous: 2, present_point: 3, implied_point: 3, past_claim: 4 };
    const take = (f: OmissionForm) => { if (rank[f] > rank[form]) form = f; };
    for (const clause of clauses) {
        const probe = omissionProbe(clause, o.labels, names);
        const omission = PAST_CLAIM.test(probe) || OMISSION_WORD.test(probe) || PRESENT_MISSING.test(probe);
        if (!omission) continue;
        const negated = NEGATOR.test(clause);
        if (PAST_CLAIM.test(probe) && !negated) { take('past_claim'); continue; }
        if (negated) { take('ambiguous'); continue; }
        if (o.labels === null || labelWords.length === 0) { take('unknown_point'); continue; }
        const imperative = IMPERATIVE_OMIT.exec(clause);
        if (imperative && names(imperative[1])) { take('implied_point'); continue; }
        const present = PRESENT_MISSING.exec(clause);
        if (present && names(present[1] ?? present[2] ?? '')) { take('present_point'); continue; }
        take(names(clause) || COLLECTIVE_POINTS.test(clause) ? 'ambiguous' : 'unrelated');
    }
    if (form === 'past_claim' || form === 'implied_point' || form === 'present_point') {
        return { status: 'FAIL', form, detail: `the advice asserts an omission (${form}); the matcher cannot know a point was missed` };
    }
    if (form === 'unknown_point') return { status: 'HOLD', form, detail: 'omission wording, but no point labels to tell whether it concerns a chosen point' };
    if (form === 'ambiguous') return { status: 'HOLD', form, detail: 'omission wording whose target or polarity is uncertain; held, not judged' };
    return { status: 'PASS', form, detail: form === 'unrelated' ? 'omission wording, but not about any chosen point' : 'no omission wording' };
}

type SessionsClient = {
    from(table: 'sessions'): {
        select(cols: string): { eq(c: string, v: string): { in(c: string, v: string[]): PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }> } };
    };
};

/**
 * Both takes' saved pairs and word counts, read after the second take's coaching has had time to save (bounded). A pair
 * that never saved reads null, so the comparison HOLDs rather than passing on absence.
 */
export async function readTwoTakesCoaching(admin: SessionsClient, uid: string, firstId: string, secondId: string, boundMs = 180_000): Promise<{
    first: { well: string; next: string } | null; second: { well: string; next: string } | null; evidenceDiffers: boolean | null;
}> {
    const pair = (raw: unknown) => {
        const v = raw as { what_worked?: unknown; what_to_try_next?: unknown } | null;
        return typeof v?.what_worked === 'string' && typeof v?.what_to_try_next === 'string' && v.what_worked.trim() && v.what_to_try_next.trim()
            ? { well: v.what_worked.trim(), next: v.what_to_try_next.trim() } : null;
    };
    const deadline = Date.now() + boundMs;
    for (;;) {
        const { data, error } = await admin.from('sessions').select('id,ai_suggestions,total_words').eq('user_id', uid).in('id', [firstId, secondId]);
        if (error) throw new Error(`saved coaching read failed (fail closed): ${error.code ?? 'unknown'}`);
        const rows = (data ?? []) as Array<{ id: string; ai_suggestions: unknown; total_words: unknown }>;
        const a = rows.find((r) => r.id === firstId);
        const b = rows.find((r) => r.id === secondId);
        const first = pair(a?.ai_suggestions ?? null);
        const second = pair(b?.ai_suggestions ?? null);
        if ((first && second) || Date.now() >= deadline) {
            const wa = typeof a?.total_words === 'number' ? a.total_words : null;
            const wb = typeof b?.total_words === 'number' ? b.total_words : null;
            return { first, second, evidenceDiffers: wa === null || wb === null ? null : wa !== wb };
        }
        await new Promise((r) => setTimeout(r, 5_000));
    }
}
