/**
 * Focus Points coaching must never claim the speaker missed, skipped, forgot or did not mention a chosen point.
 *
 * The keyword matcher only knows what it detected: speech-to-text errors or different wording can hide a point the speaker
 * did say, so "not detected" is not evidence of an omission. The prompt asks the model not to make that claim, but a prompt
 * is a request, not a constraint (live J3.b run 46097290741: a schema-valid 200 asserted an omission and was saved).
 *
 * This is the deterministic server-side check on a FRESH Focus answer, before it is saved or returned. Its phrase families
 * and decision rule mirror the live acceptance classifier `omissionClaimVerdict` (tests/live/helpers/rwtCoachingConsistency.ts)
 * byte for byte; tests/unit/focusOmissionGuardParity.test.ts fails if the two drift. The Edge tree cannot import the live
 * helper (it is not deployed) and the live typecheck may not import the Edge tree, so the parity test is the binding.
 *
 * The server is deliberately STRICTER than the acceptance row: the row FAILs only on the high-precision forms and HOLDs on
 * ambiguous wording, but a HOLD is still not a pass, so any form other than `none` or `unrelated` is replaced here.
 *
 * A flagged phrase is REPLACED, never re-asked: a schema-valid 200 is answered rather than retried (providerRetry.ts), so this
 * check adds no provider attempt and spends no extra free-tier quota. Each field is ONE short phrase by contract, so only the
 * offending field is replaced; the other phrase is kept exactly as the model wrote it. Content-free: callers record only the
 * closed form tokens and which field was replaced, never a phrase.
 */

export type OmissionForm = 'none' | 'past_claim' | 'implied_point' | 'present_point' | 'ambiguous' | 'unrelated' | 'unknown_point';

// ── Mirrored verbatim from tests/live/helpers/rwtCoachingConsistency.ts (parity-tested) ─────────────────────────────────
const STOPWORDS = new Set(['your', 'with', 'that', 'this', 'from', 'have', 'what', 'when', 'will', 'about', 'they', 'them', 'into', 'than']);
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
export const PAST_CLAIM = /\b(missed|skipped|forgot|forgotten|omitted|overlooked)\b|\bleft\s+(?:(?:it|them|that|this)\s+)?out\b|\b(?:didn'?t|did\s+not|never)\s+(?:mention|cover|say|address|include|get\s+to)\b|\b(?:never|(?:was|were)(?:n'?t|\s+not|\s+never)|(?:has|have)(?:n'?t|\s+not|\s+never)(?:\s+been)?)\s+(?:mentioned|covered|said|addressed|included|got\s+to)\b|\bwent\s+unmentioned\b|\bran\s+out\s+of\s+time\s+before\s+(?:getting\s+to|reaching|covering|mentioning)\b|\b(?:didn'?t|did\s+not)\s+(?:get|have)\s+(?:the\s+)?(?:time|a\s+chance)\s+to\s+(?:mention|cover|say|address|include|reach|make|get\s+to)\b|\b(?:didn'?t|did\s+not|never)\s+got?\s+around\s+to\s+(?:mention(?:ing)?|cover(?:ing)?|address(?:ing)?|includ(?:e|ing)|the|your|that|this|it)\b/i;
export const OMISSION_WORD = /\b(?:miss(?:es|ed|ing)?|skip(?:s|ped|ping)?|forg(?:et|ets|etting|ot|otten)|left\s+out|leav(?:e|es|ing)\s+out|omit(?:s|ted|ting)?|overlook(?:s|ed|ing)?|unmentioned)\b/i;
export const IMPERATIVE_OMIT = /\b(?:don'?t|do\s+not|never|avoid)\s+(?:skip(?:ping)?|miss(?:ing)?|forget(?:ting)?|leav(?:e|ing)\s+out|omit(?:ting)?)\b((?:\s+\S+){1,3})/i;
export const PRESENT_MISSING = /(\S+(?:\s+\S+){0,2})\s+(?:is|are|was|were|still)\s+(?:still\s+)?missing\b|\bmissing\s+((?:\S+\s+){0,2}\S+)/i;
export const NEGATOR = /\b(?:no|nothing|none|neither|nor|not\s+(?:a|one|any|a\s+single))\b/i;
export const COLLECTIVE_POINTS = /\b(?:your|chosen|selected|focus|each|every|any|all)\s+(?:\w+\s+)?points?\b|\bone\s+of\s+(?:your|the)\s+(?:\w+\s+)?points?\b/i;

/**
 * An omission participle used ATTRIBUTIVELY, right after a determiner or preposition ("the cost of missed deadlines",
 * "flag the skipped steps"), describes the topic, not the speaker, unless its noun names a chosen point; any other position
 * ("you also missed…", "and omitted details", "completely skipped mentioning…") stays a verb, and so does a gerund after
 * it. Only the omission test reads the rewritten text; every point lookup reads the original clause.
 */
export const ATTRIBUTIVE_PARTICIPLE = /(?<=\b(?:the|a|an|of|for|on|about|with|any|no|those|these|their|its|by|from|in|to)\s+)\b(missed|skipped|forgotten|omitted|overlooked)(\s+)([a-z0-9][\w'-]*)/gi;
// Pronouns, determiners, quantifiers and numbers start an OBJECT, so the participle before them is a verb ("…focused on missed
// two of your points"; review of #1999).
const NOT_A_TOPIC_NOUN = new Set(['it', 'them', 'that', 'this', 'those', 'these', 'the', 'a', 'an', 'your', 'my', 'our', 'his', 'her', 'their', 'one', 'any', 'every', 'each', 'all', 'point', 'points', 'to', 'out', 'on', 'over', 'in', 'at', 'by', 'with',
    'two', 'three', 'four', 'five', 'six', 'several', 'some', 'many', 'most', 'both', 'half', 'few', 'more', 'other', 'others']);
function omissionProbe(clause: string, labels: readonly string[] | null, names: (t: string) => boolean): string {
    const normalizedLabels = (labels ?? []).map((label) => norm(label)).filter(Boolean);
    // No label masking: a label word used as the predicate ("You missed deadlines" with the label "Missed deadlines") stays a
    // claim. A quoted label is attributive anyway ("the cost of missed deadlines") and is handled below (PM review at 307c686a).
    return clause.replace(ATTRIBUTIVE_PARTICIPLE, (whole: string, participle: string, space: string, noun: string) => {
        const quotesLabel = normalizedLabels.some((label) => label.includes(`${participle.toLowerCase()} ${noun.toLowerCase()}`));
        // A gerund after the participle ("skipped mentioning…") is a verb phrase, never a topic noun.
        if (NOT_A_TOPIC_NOUN.has(noun.toLowerCase()) || /^\d/.test(noun) || /ing$/i.test(noun) || (names(noun) && !quotesLabel)) return whole;
        return `${space}${noun}`;
    });
}

/** The strongest omission form in `text` (clauses split on . ; ! ?), judged against the take's chosen point labels. */
export function classifyOmission(text: string, labels: readonly string[] | null): OmissionForm {
  const labelWords = (labels ?? []).flatMap((label) => norm(label).split(/[^a-z0-9']+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
  const names = (t: string) => labelWords.some((w) => new RegExp(`\\b${w}`).test(norm(t)));
  const clauses = text.split(/[.;!?]+/).map((c) => c.trim()).filter(Boolean);
  let form = 'none' as OmissionForm;
  const rank: Record<OmissionForm, number> = { none: 0, unrelated: 1, unknown_point: 2, ambiguous: 2, present_point: 3, implied_point: 3, past_claim: 4 };
  const take = (f: OmissionForm) => { if (rank[f] > rank[form]) form = f; };
  for (const clause of clauses) {
    const probe = omissionProbe(clause, labels, names);
    const omission = PAST_CLAIM.test(probe) || OMISSION_WORD.test(probe) || PRESENT_MISSING.test(probe);
    if (!omission) continue;
    const negated = NEGATOR.test(clause);
    if (PAST_CLAIM.test(probe) && !negated) { take('past_claim'); continue; }
    if (negated) { take('ambiguous'); continue; }
    if (labels === null || labelWords.length === 0) { take('unknown_point'); continue; }
    const imperative = IMPERATIVE_OMIT.exec(clause);
    if (imperative && names(imperative[1])) { take('implied_point'); continue; }
    const present = PRESENT_MISSING.exec(clause);
    if (present && names(present[1] ?? present[2] ?? '')) { take('present_point'); continue; }
    take(names(clause) || COLLECTIVE_POINTS.test(clause) ? 'ambiguous' : 'unrelated');
  }
  return form;
}
// ── End of the mirrored classifier ──────────────────────────────────────────────────────────────────────────────────────

/** Only these forms may be served: no omission wording, or omission wording plainly not about a chosen point. */
export const isServableOmissionForm = (form: OmissionForm): boolean => form === 'none' || form === 'unrelated';

export interface FocusGuardPoint {
  label: string;
  verdict: 'detected' | 'not_detected' | 'unavailable';
}
export interface FocusGuardPair {
  what_worked: string;
  what_to_try_next: string;
}
export type GuardedField = 'what_worked' | 'what_to_try_next';

/** A point label short and plain enough to quote inside a replacement phrase; otherwise the label-free template is used. */
const MAX_TEMPLATE_LABEL_CHARS = 60;
const templateLabel = (label: string): string | null => {
  const flat = label.replace(/[\r\n"]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.;!?]+$/, '');
  return flat && flat.length <= MAX_TEMPLATE_LABEL_CHARS && !/[.;!?]/.test(flat) ? flat : null;
};

/** The label-free replacements. They make no claim about the take beyond its chosen points, and contain no omission wording. */
export const FOCUS_SAFE_TEMPLATES = Object.freeze({
  what_worked: 'You practised your chosen points out loud in this take.',
  what_to_try_next: 'Signpost each chosen point clearly as you reach it.',
});


/**
 * The replacement for one field: names a point when that is safe (a detected point for "what worked", a point not yet
 * clearly detected for "what to try next"), otherwise the label-free template. Every candidate is re-checked with the same
 * classifier, so a label that itself contains omission wording can never re-introduce a claim.
 */
function replacementFor(field: GuardedField, points: readonly FocusGuardPoint[], labels: readonly string[]): string {
  const wanted = field === 'what_worked' ? 'detected' : 'not_detected';
  for (const point of points) {
    if (point.verdict !== wanted) continue;
    const label = templateLabel(point.label);
    // Judged WITHOUT the label mask: a label that itself carries omission wording never enters a replacement.
    if (!label || !isServableOmissionForm(classifyOmission(label, null))) continue;
    const candidate = field === 'what_worked'
      ? `Your point "${label}" came through clearly enough to be detected.`
      : `Signpost "${label}" clearly as you reach it.`;
    if (isServableOmissionForm(classifyOmission(candidate, labels))) return candidate;
  }
  // PM review of #1993: the honest fallback is the same for two takes with the same verified evidence; no forced variety.
  return FOCUS_SAFE_TEMPLATES[field];
}

/**
 * Check a fresh Focus pair. Returns the pair to save and return (offending fields replaced), which fields were replaced,
 * and each field's ORIGINAL closed form token — never a phrase.
 */
export function guardFocusOmission<T extends FocusGuardPair>(pair: T, points: readonly FocusGuardPoint[]): {
  suggestions: T;
  replaced: GuardedField[];
  forms: Record<GuardedField, OmissionForm>;
} {
  const labels = points.map((point) => point.label);
  const forms = {
    what_worked: classifyOmission(pair.what_worked, labels),
    what_to_try_next: classifyOmission(pair.what_to_try_next, labels),
  };
  const replaced = (['what_worked', 'what_to_try_next'] as const).filter((field) => !isServableOmissionForm(forms[field]));
  if (replaced.length === 0) return { suggestions: pair, replaced: [], forms };
  const suggestions: T = { ...pair };
  const writable: FocusGuardPair = suggestions;
  for (const field of replaced) writable[field] = replacementFor(field, points, labels);
  return { suggestions, replaced, forms };
}
