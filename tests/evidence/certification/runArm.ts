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

/** One frozen utterance: its id, its reference, and the audio the manifest bound it to. */
export interface CorpusUtterance {
    id: string;
    reference: string;
    audio: Float32Array;
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

export type ArmRunResult =
    | {
          ok: true;
          row: SelectionRow;
          scores: readonly CorpusScore[];
          aggregate: AggregateWer;
          decodeFailures: readonly DecodeFailure[];
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
): Promise<ArmRunResult> {
    const expectedIds = utterances.map((u) => u.id);
    const scores: CorpusScore[] = [];
    const decodeFailures: DecodeFailure[] = [];

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
            certification,
        };
    }

    for (const utterance of utterances) {
        let hypothesis: string | null;
        try {
            hypothesis = await arm.decode(utterance.audio, utterance.audioSeconds);
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
        scores.push(scoreUtterance(utterance.id, utterance.reference, hypothesis));
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
            certification,
        };
    }

    return {
        ok: true,
        scores,
        aggregate,
        decodeFailures,
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
