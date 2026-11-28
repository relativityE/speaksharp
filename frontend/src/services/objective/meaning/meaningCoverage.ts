/**
 * Focus Points meaning matcher — the decision logic (pure, model-agnostic).
 *
 * Ported from the on-device prototypes v2 (`nliCoverage.ts`) and v3 (`v3Coverage.ts`) in the private
 * focus-points-semantics evidence folder. The model is INJECTED as `nli(premise, hypothesis)`, so these rules
 * are unit-testable with a fake and the worker only has to answer one question per pair.
 *
 * Rules (fixed before the held-out runs; do not tune them against a held-out set):
 *   - The transcript is split into CLAUSES on `; but while whereas however`, so a contrast is judged on its own.
 *   - Each point splits into claims (`splitClaims`). Each claim becomes a hypothesis; an imperative claim is
 *     read as "We will <claim>".
 *   - Windows = each clause, plus an adjacent clause PAIR only where neither clause alone entails the claim
 *     (a claim spread over two clauses).
 *   - A claim is SUPPORTED when P(entailment) >= ENTAIL_THRESHOLD in its EARLIEST such window; WEAK when its
 *     best P(entailment) >= WEAK_THRESHOLD.
 *   - Deterministic guard: a number/month CONTRADICTION found by the rules vetoes the model's support.
 *   - Point COVERED when every claim is supported — it landed at the moment the LAST claim is first supported;
 *     PARTIAL when any claim is supported or weak; else MISSING.
 *   - Subject / attribution guards on the supporting clause (v3):
 *       first-person or imperative claim + a third party leading the clause      → no credit (missing);
 *       group claim (customers / managers) + a different group leading the clause → no credit (missing);
 *       a bare "they / them / it" leading the clause                             → at most partial;
 *       a reported view ("X claims / says / asked …")                            → no credit (missing).
 *
 * NOT IN THIS VERSION — "couldn't verify". The prototype's v3 also gated every point on transcript reliability
 * (two local STT models agreeing) and showed "couldn't verify" instead of red. That gate, its UI state and its
 * persistence are out of scope here: an unreliable transcript is matched like any other. Partial ("yellow")
 * persistence also waits on a separate migration; this module only produces the existing coverage shape.
 *
 * Contract kept from the keyword matcher: NO coverage result without a local transcript quote. Every covered or
 * partial result carries `evidence` = verbatim transcript segment text + that segment's start time; a point whose
 * evidence cannot be attributed is reported missing rather than guessed.
 */
import type { TalkingPointCoverage, TranscriptSegment } from '@/services/rehearsal/outcomeScorecard';
import { numberOrMonthVeto, splitClaims } from './meaningClaims';

export interface NliScores {
    /** P(entailment) for premise ⇒ hypothesis, 0..1. */
    entail: number;
    /** P(contradiction), 0..1. Reported for transparency; the decision rules use entailment only (as measured). */
    contradict: number;
}

/** One model question. Must reject (not resolve) when it cannot answer, so the caller can fall back. */
export type NliFn = (premise: string, hypothesis: string) => Promise<NliScores>;

export const ENTAIL_THRESHOLD = 0.7;
export const WEAK_THRESHOLD = 0.3;

type ClaimStateKind = 'supported' | 'weak' | 'absent' | 'contradicted';

/** A clause of the transcript, remembering which original segment(s) it came from. */
interface Window {
    text: string;
    startSec: number;
    /** Indexes into the sorted, non-empty segment list. One for a clause, one or two for a clause pair. */
    sources: number[];
}

interface ClaimState {
    claim: string;
    state: ClaimStateKind;
    atSec: number | null;
    entail: number;
    /** The supporting window (clause or clause pair) — the text the subject guards read. */
    window?: Window;
}

const CLAUSE_SPLIT = /\s*;\s*|,?\s+but\s+|,?\s+while\s+|,?\s+whereas\s+|,?\s+however,?\s+/i;

/** Split every segment into clauses; each clause keeps its segment's start time and index. */
function toClauses(segments: TranscriptSegment[]): Window[] {
    return segments.flatMap((s, index) => s.text.split(CLAUSE_SPLIT)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((text) => ({ text, startSec: s.startSec, sources: [index] })));
}

const IMPERATIVE = new Set(['keep', 'launch', 'hire', 'cut', 'reduce', 'grow', 'move', 'train', 'measure', 'pilot', 'raise', 'add',
    'build', 'ship', 'answer', 'review', 'increase', 'decrease', 'improve', 'start', 'stop', 'test', 'use', 'make', 'create', 'deliver',
    'invite', 'share', 'focus', 'hold', 'run', 'track', 'set', 'cap', 'limit', 'expand', 'fix', 'replace', 'remove', 'switch']);

/** A claim as an NLI hypothesis. An imperative claim ("Hire two engineers") is read as "We will hire two engineers." */
export function toHypothesis(claim: string): string {
    const c = claim.trim().replace(/[.]+$/, '');
    const first = c.split(/\s+/)[0].toLowerCase();
    return (IMPERATIVE.has(first) ? 'We will ' + c[0].toLowerCase() + c.slice(1) : c) + '.';
}

async function evaluateClaim(claim: string, wins: Window[], nli: NliFn): Promise<ClaimState> {
    const h = toHypothesis(claim);
    const veto = numberOrMonthVeto(claim, wins);
    const singles: { win: Window; e: number }[] = [];
    for (const win of wins) singles.push({ win, e: (await nli(win.text, h)).entail });
    const supportedSingle = singles.find((x) => x.e >= ENTAIL_THRESHOLD);
    let pairHit: { win: Window; e: number } | undefined;
    for (let i = 1; i < wins.length && !supportedSingle; i++) {
        if (singles[i - 1].e >= ENTAIL_THRESHOLD || singles[i].e >= ENTAIL_THRESHOLD) continue;
        const text = wins[i - 1].text + ' ' + wins[i].text;
        const e = (await nli(text, h)).entail;
        if (e >= ENTAIL_THRESHOLD) {
            const sources = Array.from(new Set([...wins[i - 1].sources, ...wins[i].sources]));
            // Stamped at the start of the clause that completes the claim (prototype v2).
            pairHit = { win: { text, startSec: wins[i].startSec, sources }, e };
            break;
        }
    }
    const hit = supportedSingle ?? pairHit;
    const maxE = Math.max(0, ...singles.map((x) => x.e), pairHit?.e ?? 0);
    if (hit && !veto) return { claim, state: 'supported', atSec: hit.win.startSec, entail: hit.e, window: hit.win };
    if (veto) return { claim, state: 'contradicted', atSec: null, entail: maxE };
    if (maxE >= WEAK_THRESHOLD) {
        const best = singles.find((x) => x.e === maxE);
        return { claim, state: 'weak', atSec: best?.win.startSec ?? null, entail: maxE, window: best?.win };
    }
    return { claim, state: 'absent', atSec: null, entail: maxE };
}

// ── Subject / attribution guards (prototype v3) ─────────────────────────────────────────────────────────────
// customers and users are one audience in rehearsal speech ("users" vs "customers" is not a wrong group)
const GROUPS: Record<string, RegExp> = {
    audience: /\b(customers?|clients?|buyers?|shoppers?|users?|people who buy|those who buy|people using|people who use|those who use)\b/i,
    manager: /\b(managers?)\b/i,
};
const OTHER_PARTIES = /\b(competitors?|rivals?|other (companies|teams|firms|vendors)|many (companies|teams|firms)|some (companies|teams|firms)|someone|somebody|others|investors?|staff|employees|engineers?|designers?|developers?|executives?|vendors?|partners?|analysts?|sales (staff|team|people|reps?)|(?<!our )the [a-z]+ team|the board)\b/i;
const FIRST_PERSON_CLAIM = /^(we|our|us)\b/i;
const IMPERATIVE_START = /^(keep|launch|hire|cut|reduce|grow|move|train|measure|pilot|raise|add|build|ship|answer|review|increase|decrease|improve|start|stop|test|use|make|create|deliver|invite|share|focus|hold|run|track|set|cap|limit|expand|fix|replace|remove|switch)\b/i;
// A clause that REPORTS someone else's view ("a competitor claims…", "someone asked…") never credits the speaker.
const REPORTED = /^(?!we\b|i\b)(a |an |the |our |some |many )?[a-z ]{0,30}?\b(claims?|says?|said|thinks?|believes?|suggests?|suggested|asked|argues?|argued)\b/i;
const BARE_PRONOUN = /^(they|them|it)\b/i;

type ClaimSubject = { kind: 'first' } | { kind: 'group'; group: string } | { kind: 'other' };

function claimSubject(point: string): ClaimSubject {
    const p = point.trim();
    if (FIRST_PERSON_CLAIM.test(p) || IMPERATIVE_START.test(p)) return { kind: 'first' };
    const leadWords = p.split(/\s+/).slice(0, 3).join(' ');
    for (const [g, re] of Object.entries(GROUPS)) if (re.test(leadWords)) return { kind: 'group', group: g };
    return { kind: 'other' };
}

/** Leading subject of a clause: its first five words (before most verbs in rehearsal speech). */
const leadOf = (text: string): string => text.trim().split(/\s+/).slice(0, 5).join(' ');

/** v3: the strongest downgrade any supporting clause earns. `missing` beats `partial`. */
function subjectDowngrade(point: string, claims: ClaimState[]): 'missing' | 'partial' | null {
    const subj = claimSubject(point);
    let downgrade: 'missing' | 'partial' | null = null;
    for (const c of claims) {
        if (c.state !== 'supported' || !c.window) continue;
        const quote = c.window.text.trim();
        const lead = leadOf(quote);
        if (BARE_PRONOUN.test(quote)) { downgrade = downgrade ?? 'partial'; continue; }
        if (REPORTED.test(quote)) { downgrade = 'missing'; continue; }
        // a claim without an explicit group is about the speaker's own team/process (e.g. "Security review happens…")
        if ((subj.kind === 'first' || subj.kind === 'other') && OTHER_PARTIES.test(lead) && !/\b(our|we|us)\b/i.test(lead)) downgrade = 'missing';
        if (subj.kind === 'group') {
            const otherGroup = Object.entries(GROUPS).some(([g, re]) => g !== subj.group && re.test(lead));
            if (otherGroup || (OTHER_PARTIES.test(lead) && !GROUPS[subj.group].test(lead))) downgrade = 'missing';
        }
    }
    return downgrade;
}

/** Verbatim transcript text for a window: the full original segment(s) it came from. */
function quoteFor(win: Window, segments: TranscriptSegment[]): string {
    return win.sources.map((i) => segments[i]?.text.trim() ?? '').filter(Boolean).join(' ');
}

/** Score ONE point. `segments` must already be sorted and non-empty-text. */
async function scorePoint(point: string, segments: TranscriptSegment[], wins: Window[], nli: NliFn): Promise<TalkingPointCoverage> {
    const missing = (): TalkingPointCoverage => ({ point, status: 'missing', matchRatio: 0 });
    const claimTexts = splitClaims(point);
    if (claimTexts.length === 0 || wins.length === 0) return missing();

    const claims: ClaimState[] = [];
    for (const claim of claimTexts) claims.push(await evaluateClaim(claim, wins, nli));
    const supportedCount = claims.filter((c) => c.state === 'supported').length;
    // Internal transparency value for the meaning engine: the fraction of the point's claims supported.
    const matchRatio = supportedCount / claims.length;

    let status: 'covered' | 'partial' | 'missing';
    let anchor: ClaimState | undefined;
    if (supportedCount === claims.length) {
        status = 'covered';
        // landed = the moment the LAST claim is first supported
        anchor = claims.reduce((a, b) => ((b.atSec ?? 0) > (a.atSec ?? 0) ? b : a));
    } else if (claims.some((c) => c.state === 'supported' || c.state === 'weak')) {
        status = 'partial';
        const timed = claims.filter((c) => c.atSec !== null);
        anchor = timed.length ? timed.reduce((a, b) => ((b.atSec ?? 0) < (a.atSec ?? 0) ? b : a)) : undefined;
    } else {
        return { ...missing(), matchRatio };
    }

    const downgrade = subjectDowngrade(point, claims);
    if (downgrade === 'missing') return { ...missing(), matchRatio };
    if (downgrade === 'partial' && status === 'covered') status = 'partial';

    if (!anchor?.window || anchor.atSec === null) return { ...missing(), matchRatio };
    const quote = quoteFor(anchor.window, segments);
    if (!quote) return { ...missing(), matchRatio };
    return { point, status, matchRatio, evidence: { quote, timestampSec: anchor.atSec } };
}

/**
 * Meaning-based coverage for every point, in point order (same shape as `mapTalkingPointCoverage`).
 * Rejects if `nli` rejects — the caller owns the fallback to the keyword matcher.
 */
export async function computeMeaningCoverage(
    points: string[],
    segments: TranscriptSegment[],
    nli: NliFn,
): Promise<TalkingPointCoverage[]> {
    const segs = segments
        .filter((s) => typeof s?.text === 'string' && s.text.trim().length > 0 && Number.isFinite(s.startSec))
        .slice()
        .sort((a, b) => a.startSec - b.startSec);
    const wins = toClauses(segs);
    const cache = new Map<string, Promise<NliScores>>();
    const memo: NliFn = (premise, hypothesis) => {
        const key = premise + '\u0000' + hypothesis;
        let hit = cache.get(key);
        if (!hit) { hit = nli(premise, hypothesis); cache.set(key, hit); }
        return hit;
    };
    const out: TalkingPointCoverage[] = [];
    for (const point of points) out.push(await scorePoint(point, segs, wins, memo));
    return out;
}
