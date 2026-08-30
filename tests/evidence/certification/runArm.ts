/**
 * #1304 Task 3C — RUNNING AN ARM over the frozen corpus, and the selection row it may or may not earn.
 *
 * The rules that matter here are negative ones:
 *
 *   - An UNCERTIFIED arm produces no row. Not a provisional row, not a row with a caveat.
 *   - A partial corpus produces NO WER. `aggregateCorpusArm` enforces completeness; this path may not
 *     work around it by scoring "whatever succeeded", which is precisely what the retired harnesses
 *     did — their `catch` swallowed a failed decode and the mean improved, because the clips that fail
 *     are systematically the hard ones.
 *   - Nothing here writes to any ledger. `benchmark-whisper-ceiling.mts` mutated `STT_BENCHMARKS.json`
 *     as a side effect of measuring, so a run silently rewrote the baseline it was being compared to.
 *     This module returns values and touches no file.
 */
import { scoreUtterance, aggregateArm, type CorpusScore, type AggregateWer } from './scoringAdapter';
import { checkProvenance } from './provenance';
import { fingerprintConfiguration, fingerprintDifferences } from './fingerprint';
import { CERTIFICATION_RULES } from './rules';
import type { CertificationResult } from './certify';
import type { ArmProvenance, DecodeArm } from './engineArm';

/** One frozen utterance: its id, its reference, and where its audio lives for this lane. */
export interface CorpusUtterance {
    id: string;
    reference: string;
    /** File path (Node) or URL (browser). The ARM resolves it; the runner never loads samples itself. */
    locator: string;
    audioSeconds: number;
}

export interface SelectionRow {
    armId: string;
    rulesVersion: string;
    track: typeof CERTIFICATION_RULES.track;
    aggregation: typeof CERTIFICATION_RULES.aggregation;
    wer: number;
    referenceWords: number;
    substitutions: number;
    deletions: number;
    insertions: number;
    scoredCount: number;
    provenance: ArmProvenance;
    /** The configuration digest this row was produced under. */
    fingerprint: string;
}

/** A decode that THREW. Distinct from a decode that returned nothing — a crash and a silent model are
 *  different events, and a run that cannot tell them apart cannot be diagnosed. */
export interface DecodeFailure { utteranceId: string; message: string }

/**
 * What happened to ONE clip, timed.
 *
 * The schema in `deploymentMetrics.ts` declared cold load, warm p50/p95, RTF and reliability categories
 * — and nothing collected them. A declared table is not a measured one, and shipping the 600 without
 * this would have meant paying for the whole run twice.
 */
export interface ClipOutcome {
    utteranceId: string;
    audioSeconds: number;
    /** Wall-clock for THIS decode. */
    decodeMs: number;
    /** decodeMs / (audioSeconds * 1000). Below 1.0 is faster than real time. */
    realTimeFactor: number;
    outcome: 'scored' | 'threw' | 'empty' | 'unmeasurable';
}

export type ArmRunResult =
    | {
          ok: true;
          row: SelectionRow;
          scores: readonly CorpusScore[];
          aggregate: AggregateWer;
          decodeFailures: readonly DecodeFailure[];
          clipOutcomes: readonly ClipOutcome[];
          /**
           * The RAW hypothesis per utterance, as the engine returned it.
           *
           * Previously discarded the moment it was scored, which left the artifact unable to answer any
           * question about WHAT was recognised — only how many errors there were. Two models producing
           * completely different text with the same S/D/I totals were indistinguishable in evidence.
           */
          hypotheses: ReadonlyMap<string, string | null>;
      }
    | {
          ok: false;
          /** Why no row exists. Absence is always explained. */
          reason:
              | 'not_certified'
              | 'certificate_arm_mismatch'
              | 'certificate_configuration_mismatch'
              | 'incomplete_provenance'
              | 'unscoreable_arm';
          detail: string;
          scores: readonly CorpusScore[];
          aggregate: AggregateWer | null;
          decodeFailures: readonly DecodeFailure[];
          clipOutcomes: readonly ClipOutcome[];
          hypotheses: ReadonlyMap<string, string | null>;
          certification: CertificationResult;
      };

/**
 * Decode every utterance, score each through the certified path, and pool.
 *
 * A decode that THROWS is recorded as a null hypothesis rather than skipped. That distinction is the
 * whole difference: a skipped clip vanishes from both numerator and denominator and quietly improves
 * the arm, while a null hypothesis is an invalid utterance that invalidates the arm until explained.
 */
export async function runArm(
    arm: DecodeArm,
    certification: CertificationResult,
    utterances: readonly CorpusUtterance[],
    /**
     * The ids the arm MUST account for, from an INDEPENDENT authority — the frozen manifest's own
     * declared counts, not this call's `utterances`.
     *
     * REQUIRED, and required for a reason. Deriving it from `utterances` compares a list against
     * itself: drop a clip and both shrink, so 599 of 600 reads as complete. Every runner previously
     * passed `utterances.map(u => u.id)` and reintroduced exactly that.
     */
    expectedUtteranceIds: readonly string[],
): Promise<ArmRunResult> {
    const expectedIds = expectedUtteranceIds;
    const scores: CorpusScore[] = [];
    const decodeFailures: DecodeFailure[] = [];
    const clipOutcomes: ClipOutcome[] = [];
    const hypotheses = new Map<string, string | null>();

    // A CERTIFICATE IS NOT TRANSFERABLE. Nothing previously tied the certification to the arm being
    // run, so one model could be measured under another model's certificate — including a certificate
    // earned by an arm on a different route, device or model entirely.
    if (certification.armId !== arm.id) {
        return {
            ok: false,
            reason: 'certificate_arm_mismatch',
            detail: `certificate belongs to ${certification.armId}, run is ${arm.id}`,
            scores,
            aggregate: null,
            decodeFailures,
            clipOutcomes,
            hypotheses,
            certification,
        };
    }

    // AND the CONFIGURATION must match, not merely the name. Model, revision, weight digests, runtime
    // version, backend, device claim, route and corpus all change what a decode IS; a certificate that
    // only checked the id would vouch for a decode that never happened.
    const runFingerprint = fingerprintConfiguration(
        arm.id, arm.provenance(), certification.gates.routeHonored?.deviceClaim ?? 'none',
    );
    if (runFingerprint.digest !== certification.fingerprint.digest) {
        return {
            ok: false,
            reason: 'certificate_configuration_mismatch',
            detail: `differs in: ${fingerprintDifferences(certification.fingerprint, runFingerprint).join(', ')}`,
            scores,
            aggregate: null,
            decodeFailures,
            clipOutcomes,
            hypotheses,
            certification,
        };
    }

    if (!certification.certified) {
        return {
            ok: false,
            reason: 'not_certified',
            detail: certification.failedGates.join(','),
            scores,
            aggregate: null,
            decodeFailures,
            clipOutcomes,
            hypotheses,
            certification,
        };
    }

    for (const utterance of utterances) {
        let hypothesis: string | null;
        const started = Date.now();
        try {
            hypothesis = await arm.decode(utterance.locator, utterance.audioSeconds);
        } catch (error) {
            // Recorded, and STILL SCORED. Skipping it would remove the clip from both numerator and
            // denominator — and the clips that fail are systematically the hard ones, so a skip
            // silently improves the arm. Every expected utterance gets a score, valid or not.
            decodeFailures.push({
                utteranceId: utterance.id,
                message: error instanceof Error ? error.message : String(error),
            });
            hypothesis = null;
        }
        const decodeMs = Date.now() - started;
        const score = scoreUtterance(utterance.id, utterance.reference, hypothesis);
        scores.push(score);
        hypotheses.set(utterance.id, hypothesis);
        clipOutcomes.push({
            utteranceId: utterance.id,
            audioSeconds: utterance.audioSeconds,
            decodeMs,
            realTimeFactor: utterance.audioSeconds > 0 ? decodeMs / (utterance.audioSeconds * 1000) : Number.NaN,
            outcome: score.ok
                ? 'scored'
                : hypothesis === null && decodeFailures.some((f) => f.utteranceId === utterance.id)
                    ? 'threw'
                    : score.invalidReason === 'empty_hypothesis' ? 'empty' : 'unmeasurable',
        });
    }

    const aggregate = aggregateArm(scores, expectedIds);

    // Re-checked at emission, not only at certification: provenance is produced by the arm and can
    // change between the two — resource figures, for instance, only exist after the run.
    const provenance = arm.provenance();
    const provenanceCheck = checkProvenance(provenance);
    if (!provenanceCheck.ok) {
        return {
            ok: false,
            reason: 'incomplete_provenance',
            detail: [...provenanceCheck.missing, ...provenanceCheck.empty, ...provenanceCheck.placeholder].join(','),
            scores,
            aggregate,
            decodeFailures,
            clipOutcomes,
            hypotheses,
            certification,
        };
    }

    if (aggregate.wer === null) {
        return {
            ok: false,
            reason: 'unscoreable_arm',
            detail: aggregate.armInvalidReason ?? 'unknown',
            scores,
            aggregate,
            decodeFailures,
            clipOutcomes,
            hypotheses,
            certification,
        };
    }

    return {
        ok: true,
        scores,
        aggregate,
        decodeFailures,
        clipOutcomes,
        hypotheses,
        row: {
            armId: arm.id,
            rulesVersion: certification.rulesVersion,
            track: CERTIFICATION_RULES.track,
            aggregation: CERTIFICATION_RULES.aggregation,
            wer: aggregate.wer,
            referenceWords: aggregate.referenceWords,
            substitutions: aggregate.substitutions,
            deletions: aggregate.deletions,
            insertions: aggregate.insertions,
            scoredCount: aggregate.scoredCount,
            provenance,
            fingerprint: certification.fingerprint.digest,
        },
    };
}
