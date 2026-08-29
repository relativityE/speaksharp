/**
 * #1304 — THE DECISION POLICY, frozen in code BEFORE the frozen-600 results exist.
 *
 * Written now for one reason: deciding the rules after seeing the numbers is how a preferred answer
 * gets ratified. Every threshold and tie rule below was fixed while nobody knew which model would win.
 *
 * Two conclusions are produced, never merged:
 *   TECHNICAL  — who is best on the evidence.
 *   ACTIVATION — who can ship for MVP.
 * If the technical winner cannot ship, the best ready candidate is ACTIVATED without rewriting who
 * technically won. Otherwise integration convenience quietly becomes a quality argument.
 */
import { assertSingleRuntime, type TechnicalVerdict } from './deploymentMetrics';

export const SELECTION_POLICY = Object.freeze({
    version: 'policy_v1',
    /** Every clip must be valid. A partial corpus is a different corpus. */
    requiredClips: 600,
    /** p95 real-time factor must be under this for a model to be usable live. */
    maxRealTimeFactorP95: 1.0,
    /** Confidence level for the paired bootstrap. */
    confidence: 0.95,
    bootstrapResamples: 2000,
    /** Seed: the interval must be reproducible from the committed per-utterance scores. */
    bootstrapSeed: 'speaksharp-1304-policy-v1',
});

export type DisqualificationReason =
    | 'incomplete_corpus'
    | 'reliability_failures'
    | 'backend_not_proven'
    | 'rtf_p95_too_slow'
    | 'long_form_truncated'
    | 'long_form_tail_lost'
    | 'long_form_looping'
    | 'dtype_alias'
    | 'diagnostic_row'
    | 'not_selection_grade';

export interface Qualification {
    armId: string;
    qualified: boolean;
    reasons: DisqualificationReason[];
}

/**
 * Rules 1, 4, 5, 9, 10 — everything that disqualifies a row before accuracy is even considered.
 *
 * A model that is fastest and most accurate but drops one clip in six hundred has not qualified: the
 * clips that fail are systematically the hard ones, so tolerating them rewards the failure.
 */
export function qualify(row: TechnicalVerdict): Qualification {
    const reasons: DisqualificationReason[] = [];

    if (row.evidenceClass !== 'selection') reasons.push('not_selection_grade');
    // An alias inherits its target's evidence and is never run or ranked separately.
    if (row.dtypeAliasOf !== undefined) reasons.push('dtype_alias');
    // A DIAGNOSTIC row answers a question about the harness. The runner iterates the whole matrix, so
    // `v4:base:q4-decoder:cpu` — a browser duplicate of the WASM cell — is measured like any other arm
    // and would otherwise have been rankable. The alias was excluded; this one was not.
    if (row.role === 'diagnostic') reasons.push('diagnostic_row');
    if (!row.backendProven) reasons.push('backend_not_proven');

    const r = row.reliability;
    if (r.expectedClips !== SELECTION_POLICY.requiredClips || r.decoded !== SELECTION_POLICY.requiredClips) {
        reasons.push('incomplete_corpus');
    }
    if (r.threw > 0 || r.emptyOutput > 0 || r.timedOut > 0 || r.audioRejected > 0 || r.missing > 0) {
        reasons.push('reliability_failures');
    }

    const rtf = row.speed.realTimeFactorP95;
    // NULL is not a pass. An unmeasured latency cannot clear a latency gate.
    if (rtf === null || rtf >= SELECTION_POLICY.maxRealTimeFactorP95) reasons.push('rtf_p95_too_slow');

    if (row.duration.truncatedClips > 0) reasons.push('long_form_truncated');
    if (row.duration.longFormTailPreserved === false) reasons.push('long_form_tail_lost');
    if ((row.duration.longFormRepeatedNgrams ?? 0) > 0) reasons.push('long_form_looping');

    return { armId: row.armId, qualified: reasons.length === 0, reasons };
}

/** Deterministic PRNG — the interval must be reproducible from committed scores, on any machine. */
function makeRng(seed: string) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    const next = () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    };
    let a = next(), b = next(), c = next(), d = next();
    return () => {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    };
}

/** One utterance's contribution to a pooled WER, for one arm. */
export interface PairedUtterance {
    utteranceId: string;
    referenceWords: number;
    /** substitutions + deletions + insertions */
    errors: number;
}

export interface PairedInterval {
    /** Pooled WER difference, A minus B. Negative means A is better. */
    observedDelta: number;
    lower: number;
    upper: number;
    /** TRUE when the interval spans zero — the models are TIED, not winner and loser. */
    tied: boolean;
    resamples: number;
}

/**
 * Rules 2 and 3 — a PAIRED bootstrap over the same utterances.
 *
 * Paired because both arms scored the same clips: comparing independent samples would attribute the
 * corpus's own variation to the models. If the 95% interval includes zero, the difference is a tie —
 * a 0.0003 gap on 600 clips is not a winner, and the policy says so before anyone has seen the gap.
 */
export function pairedBootstrapInterval(
    armA: readonly PairedUtterance[],
    armB: readonly PairedUtterance[],
    options = SELECTION_POLICY,
): PairedInterval {
    const byId = new Map(armB.map((u) => [u.utteranceId, u]));
    const pairs = armA
        .map((a) => ({ a, b: byId.get(a.utteranceId) }))
        .filter((p): p is { a: PairedUtterance; b: PairedUtterance } => p.b !== undefined);
    if (pairs.length === 0) {
        throw new Error('paired bootstrap requires the two arms to share utterances');
    }

    const pooled = (sample: readonly { a: PairedUtterance; b: PairedUtterance }[]) => {
        let errA = 0, errB = 0, words = 0;
        for (const p of sample) {
            errA += p.a.errors;
            errB += p.b.errors;
            words += p.a.referenceWords;
        }
        return words === 0 ? 0 : (errA - errB) / words;
    };

    const observedDelta = pooled(pairs);
    const rng = makeRng(options.bootstrapSeed);
    const deltas: number[] = [];
    for (let i = 0; i < options.bootstrapResamples; i++) {
        const resample = Array.from({ length: pairs.length },
            () => pairs[Math.floor(rng() * pairs.length)]);
        deltas.push(pooled(resample));
    }
    deltas.sort((x, y) => x - y);
    const alpha = (1 - options.confidence) / 2;
    const lower = deltas[Math.floor(alpha * deltas.length)] ?? observedDelta;
    const upper = deltas[Math.min(deltas.length - 1, Math.ceil((1 - alpha) * deltas.length))] ?? observedDelta;

    return { observedDelta, lower, upper, tied: lower <= 0 && upper >= 0, resamples: options.bootstrapResamples };
}

export interface Selection {
    /** Rule 6 — best QUALIFIED model on the evidence. No integration-cost adjustment. */
    primary: string | null;
    /** Rule 7 — best qualified candidate with meaningfully DIFFERENT failure exposure. */
    fallback: string | null;
    /** Why the fallback is not simply second place. */
    fallbackRationale: string | null;
    qualified: string[];
    disqualified: Qualification[];
    /** Models statistically tied with the primary. Recorded so a coin-flip is not read as a verdict. */
    tiedWithPrimary: string[];
}

/**
 * Rules 6 and 7 — choose a primary and a fallback.
 *
 * The fallback is NOT second-lowest WER. It is the best qualified candidate whose failure exposure
 * differs from the primary's: a different runtime, or a different model family. Two arms on the same
 * library and the same weights fail together, which is the one thing a fallback exists not to do.
 */
export function select(
    rows: readonly TechnicalVerdict[],
    pairedScores: Map<string, PairedUtterance[]>,
    exposureOf: (armId: string) => { runtime: string; family: string },
): Selection {
    assertSingleRuntime(rows.length > 0 ? [rows[0]] : []); // shape check only; rows may span runtimes by design
    const checks = rows.map(qualify);
    const qualified = checks.filter((c) => c.qualified).map((c) => c.armId);
    const byId = new Map(rows.map((r) => [r.armId, r]));

    const ranked = [...qualified].sort((a, b) => (byId.get(a)?.wer ?? 1) - (byId.get(b)?.wer ?? 1));
    const primary = ranked[0] ?? null;
    if (primary === null) {
        return { primary: null, fallback: null, fallbackRationale: null, qualified, disqualified: checks.filter((c) => !c.qualified), tiedWithPrimary: [] };
    }

    const primaryScores = pairedScores.get(primary);
    const tiedWithPrimary = ranked.slice(1).filter((id) => {
        const other = pairedScores.get(id);
        if (!primaryScores || !other) return false;
        return pairedBootstrapInterval(primaryScores, other).tied;
    });

    const primaryExposure = exposureOf(primary);
    const differentExposure = ranked.slice(1).find((id) => {
        const e = exposureOf(id);
        return e.runtime !== primaryExposure.runtime || e.family !== primaryExposure.family;
    });

    return {
        primary,
        fallback: differentExposure ?? null,
        fallbackRationale: differentExposure
            ? `different failure exposure from the primary (${exposureOf(differentExposure).runtime} / `
              + `${exposureOf(differentExposure).family} vs ${primaryExposure.runtime} / ${primaryExposure.family})`
            : 'no qualified candidate has failure exposure different from the primary',
        qualified,
        disqualified: checks.filter((c) => !c.qualified),
        tiedWithPrimary,
    };
}

/** Rule 8 — activation is reported beside the technical verdict, and never rewrites it. */
export interface ActivationDecision {
    technicalWinner: string | null;
    activated: string | null;
    /** Set when the two differ: the technical winner stands, something else ships. */
    divergenceReason: string | null;
}

export function decideActivation(
    technicalWinner: string | null,
    readiness: Map<string, { ready: boolean; blockers: string[] }>,
    rankedQualified: readonly string[],
): ActivationDecision {
    if (technicalWinner === null) return { technicalWinner: null, activated: null, divergenceReason: null };
    if (readiness.get(technicalWinner)?.ready) {
        return { technicalWinner, activated: technicalWinner, divergenceReason: null };
    }
    const activated = rankedQualified.find((id) => readiness.get(id)?.ready) ?? null;
    return {
        technicalWinner,
        activated,
        divergenceReason: activated
            ? `${technicalWinner} is the technical winner but cannot ship for MVP `
              + `(${readiness.get(technicalWinner)?.blockers.join(', ') ?? 'unstated'}); `
              + `${activated} is activated instead. This does NOT change who technically won.`
            : `${technicalWinner} cannot ship and no qualified candidate is ready`,
    };
}
