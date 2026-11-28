/**
 * Focus Points meaning matcher — deterministic pieces (claim splitting + the number/month guard).
 *
 * Ported from the on-device prototype (`focus-points-semantics/prototype/semanticCoverage.ts`, the "v1 rules"
 * matcher). Only two of its roles survive into the product:
 *   1. `splitClaims` — a point becomes one hypothesis per claim ("…under $50k and launch in June" → two claims).
 *   2. `ruleClaimState` — the rules-based verdict for ONE claim, used solely as a GUARD: when it says the spoken
 *      quantity or month CONTRADICTS a claim that names a number or month ("we hit 18%" vs "30%"), the model's
 *      support is vetoed. The rules never grant support on their own here — green comes from the model.
 *
 * The held-out runs showed hand rules overfit on false greens, so everything else from v1 (synonym lists,
 * hedges, direction words as a source of support) is deliberately NOT a source of credit in the product.
 * The logic below is a line-for-line port of the prototype (formatting and types only) so the guard behaves as measured.
 *
 * Pure string logic: no I/O, nothing leaves the device.
 */

export interface ClaimSegment {
    text: string;
    startSec: number;
}

type RuleState = 'supported' | 'weak' | 'hedged' | 'contradicted' | 'absent';

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'is', 'are',
    'was', 'were', 'be', 'been', 'this', 'that', 'it', 'its', 'we', 'our', 'you', 'your', 'i', 'my', 'they', 'their', 'as', 'so',
    'then', 'will', 'would', 'should', 'about', 'into', 'over', 'than', 'too', 'very', 'just', 'more', 'each', 'every', 'which', 'who']);
const NEGATORS = /\b(not|never|cannot|can't|cant|won't|wont|don't|dont|doesn't|isn't|aren't|no longer|neither|nor)\b/;
const HEDGES = /\b(might|maybe|perhaps|possibly|hopefully|probably|if)\b/;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SYN: Record<string, string> = {
    'go live': 'launch', golive: 'launch', ship: 'launch', release: 'launch', start: 'launch',
    add: 'hire', recruit: 'hire', bring: 'hire',
    reduce: 'cut', lower: 'cut', decrease: 'cut', trim: 'cut', shrink: 'cut',
    raise: 'increase', rise: 'increase', grow: 'increase', up: 'increase',
    cost: 'spend', spending: 'spend', budget: 'spend', price: 'pricing',
};
const DIRECTION: Record<string, 'down' | 'up'> = { cut: 'down', increase: 'up' };

const UNITS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
    'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function stem(w: string): string {
    let s = w.toLowerCase().replace(/'s$/, '');
    if (SYN[s]) return SYN[s];
    if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
    else if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
    else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
    else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
    return SYN[s] ?? s;
}

/** Spell out → digits ("forty-five thousand" → "45000", "a pair" → "2", "$45,000" → "45000 usd", "50k" → "50000"). */
export function normalizeNumbers(text: string): string {
    let t = ' ' + text.toLowerCase().replace(/[’]/g, "'") + ' ';
    t = t.replace(/\ba (pair|couple) of\b/g, ' 2 ').replace(/\b(pair|couple) of\b/g, ' 2 ');
    t = t.replace(/\bgo(ing)? live\b/g, ' golive ');
    t = t.replace(/\b((?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)(?:[ -]hundred)?(?:[ -](?:thousand|million))?)\b/g,
        (m) => {
            const parts = m.split(/[- ]/);
            let n = 0;
            let cur = 0;
            for (const p of parts) {
                if (UNITS.includes(p)) cur += UNITS.indexOf(p);
                else if (TENS[p]) cur += TENS[p];
                else if (p === 'hundred') cur *= 100;
                else if (p === 'thousand') { n += cur * 1000; cur = 0; }
                else if (p === 'million') { n += cur * 1_000_000; cur = 0; }
            }
            return ' ' + String(n + cur) + ' ';
        });
    t = t.replace(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|thousand|m|million)?\b/g, (_m: string, d: string, mult: string | undefined) =>
        ' ' + String(Number(d.replace(/,/g, '')) * (mult === 'k' || mult === 'thousand' ? 1000 : mult === 'm' || mult === 'million' ? 1e6 : 1)) + ' usd ');
    t = t.replace(/\b([\d,]+(?:\.\d+)?)\s*(k|thousand)\b/g, (_m: string, d: string) => ' ' + String(Number(d.replace(/,/g, '')) * 1000) + ' usd ');
    t = t.replace(/\b(\d[\d,]*)\b/g, (d) => d.replace(/,/g, ''));
    t = t.replace(/\b(\d+(?:\.\d+)?)\s*(%|percent|per cent)/g, ' $1 pct ');
    t = t.replace(/\b(\d+(?:\.\d+)?)\s*dollars?\b/g, ' $1 usd ');
    return t.replace(/\s+/g, ' ').trim();
}

interface NumC { lo: number; hi: number; unit: string }
const LE = /\b(under|below|less than|at most|up to|within|cap|capped|no more than|max(imum)?)\s*(at\s*)?$/;
const GE = /\b(over|above|more than|at least|minimum|min)\s*$/;

/** Numbers with comparator and unit, as intervals. unit = 'usd' | 'pct' | next content stem. */
function numbers(norm: string): NumC[] {
    const out: NumC[] = [];
    const re = /(\d+(?:\.\d+)?)(?:\s+(usd|pct))?(?:\s+([a-z]+))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm))) {
        const v = Number(m[1]);
        const before = norm.slice(Math.max(0, m.index - 24), m.index);
        let unit = m[2] ?? '';
        if (!unit && m[3] && !STOP.has(m[3])) unit = stem(m[3]);
        if (!unit && m[3] && STOP.has(m[3])) {
            const nxt = norm.slice(m.index + m[0].length).match(/^\s*([a-z]+)/);
            unit = nxt ? stem(nxt[1]) : '';
        }
        if (LE.test(before)) out.push({ lo: -Infinity, hi: v, unit });
        else if (GE.test(before)) out.push({ lo: v, hi: Infinity, unit });
        else out.push({ lo: v, hi: v, unit });
    }
    return out;
}

const months = (norm: string): string[] => MONTHS.filter((mo) => new RegExp(`\\b${mo}\\b`).test(norm)
    && !(mo === 'may' && /\b(we|i|you|it|they) may\b/.test(norm)));
const contentStems = (norm: string): string[] => (norm.match(/[a-z']+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)
    && !MONTHS.includes(w) && !['usd', 'pct'].includes(w)).map(stem);

/** Split a point into claims at " and " / ";" when the right side carries its own predicate (≥2 content words or a number/month). */
export function splitClaims(point: string): string[] {
    const parts = point.split(/\s*;\s*|,\s+and\s+|\s+and\s+/i);
    const claims: string[] = [];
    for (const p of parts) {
        const n = normalizeNumbers(p);
        const standalone = contentStems(n).length >= 2 || numbers(n).length > 0 || months(n).length > 0;
        if (claims.length && !standalone) claims[claims.length - 1] += ' and ' + p;
        else claims.push(p);
    }
    return claims.map((c) => c.trim()).filter(Boolean);
}

const RANK: Record<RuleState, number> = { absent: 0, weak: 1, hedged: 2, contradicted: 3, supported: 4 };

function evalClaim(claim: string, windows: ClaimSegment[]): { state: RuleState; atSec: number | null } {
    const cn = normalizeNumbers(claim);
    const kw = Array.from(new Set(contentStems(cn).filter((s) => !/^\d/.test(s))));
    const nums = numbers(cn).filter((x) => x.unit);
    const mons = months(cn);
    const dir = (cn.match(/[a-z']+/g) ?? []).map((k) => DIRECTION[stem(k)]).find(Boolean);
    let best: { state: RuleState; atSec: number | null } = { state: 'absent', atSec: null };
    for (const w of windows) {
        const tn = normalizeNumbers(w.text);
        const ts = new Set(contentStems(tn));
        const hits = kw.filter((k) => ts.has(k)).length;
        const ratio = kw.length ? hits / kw.length : 0;
        const tnums = numbers(tn);
        const tmons = months(tn);
        // numeric: every claimed quantity must be matched by a same-unit spoken quantity whose interval is inside the claim's
        let numOk = true;
        let numContra = false;
        let numSeen = false;
        for (const c of nums) {
            const same = tnums.filter((x) => x.unit === c.unit
                || (c.unit !== 'usd' && c.unit !== 'pct' && x.unit !== 'usd' && x.unit !== 'pct' && ts.has(c.unit)));
            if (!same.length) { numOk = false; continue; }
            numSeen = true;
            if (!same.some((x) => x.lo >= c.lo && x.hi <= c.hi)) { numOk = false; numContra = true; }
        }
        let monOk = true;
        let monContra = false;
        for (const mo of mons) {
            if (!tmons.includes(mo)) { monOk = false; if (tmons.length) monContra = true; }
        }
        const topical = hits >= 1 || numSeen || (mons.length > 0 && tmons.some((mo) => mons.includes(mo)));
        if (!topical) continue;
        let state: RuleState;
        const tdir = (tn.match(/[a-z']+/g) ?? []).map((k) => DIRECTION[stem(k)]).find(Boolean);
        const negated = NEGATORS.test(tn);
        if ((numContra || monContra || (dir && tdir && dir !== tdir)) && (hits >= 1 || numSeen)) state = 'contradicted';
        else if (negated && ratio >= 0.34) state = 'contradicted';
        else {
            const hasConstraint = nums.length + mons.length > 0;
            const constraintOk = numOk && monOk;
            const strong = hasConstraint
                ? constraintOk && (kw.length === 0 || hits >= 1) && (ratio >= 0.5 || numSeen || mons.length > 0)
                : ratio >= 0.6;
            const supportedBody = strong || (hasConstraint && constraintOk && ratio >= 0.34);
            if (supportedBody && HEDGES.test(tn)) state = 'hedged';
            else if (supportedBody) state = 'supported';
            else if (ratio >= 0.34 || (hasConstraint && (numOk || monOk) && (numSeen || hits >= 1))) state = 'weak';
            else continue;
        }
        // earliest window wins at the best level; a later contradiction does not erase an earlier support, and vice versa
        if (RANK[state] > RANK[best.state] || (best.atSec !== null && RANK[state] === RANK[best.state] && w.startSec < best.atSec)) {
            best = { state, atSec: state === 'supported' || state === 'hedged' ? w.startSec : null };
        }
        if (state === 'supported') return best;
    }
    return best;
}

/**
 * The rules-based verdict for ONE claim over the given windows: earliest single window, else an adjacent pair
 * where neither half supports it alone (prototype `semanticCoverage(claim, segs).claims[0].state`).
 */
export function ruleClaimState(claim: string, segments: ClaimSegment[]): RuleState {
    const segs = segments.filter((x) => x.text.trim()).sort((a, b) => a.startSec - b.startSec);
    const singles = segs.map((x) => ({ text: x.text, startSec: x.startSec }));
    const single = evalClaim(claim, singles);
    const pairs: ClaimSegment[] = [];
    for (let i = 1; i < segs.length; i++) {
        const a = evalClaim(claim, [singles[i - 1]]).state;
        const b = evalClaim(claim, [singles[i]]).state;
        if (a !== 'supported' && b !== 'supported') pairs.push({ text: segs[i - 1].text + ' ' + segs[i].text, startSec: segs[i - 1].startSec });
    }
    const pair = pairs.length ? evalClaim(claim, pairs) : null;
    if (single.state === 'supported' && (!pair || pair.state !== 'supported' || (single.atSec ?? 0) <= (pair.atSec ?? 0))) return single.state;
    if (pair && pair.state === 'supported') return pair.state;
    return pair && RANK[pair.state] > RANK[single.state] ? pair.state : single.state;
}

/** Does the claim name a quantity or a month? Only such claims are subject to the deterministic veto. */
export const CLAIM_HAS_NUMBER_OR_MONTH =
    /\d|january|february|march|april|may|june|july|august|september|october|november|december|percent|thousand|million|\$/i;

/**
 * The deterministic veto: the claim names a number/month and the rules find the spoken words CONTRADICT it.
 * Prototype v2: `guard.state === 'contradicted' && /\d|…/i.test(claim)`.
 */
export function numberOrMonthVeto(claim: string, segments: ClaimSegment[]): boolean {
    return CLAIM_HAS_NUMBER_OR_MONTH.test(claim) && ruleClaimState(claim, segments) === 'contradicted';
}
