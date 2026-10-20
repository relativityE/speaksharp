import { createHash } from 'node:crypto';
import { validatePairedEvidence, type PairedEvidenceIdentity } from '../../tests/evidence/certification/pairedEvidence';
import { normalizeOfficialTrackA } from '../../tests/evidence/normalization/officialNormalizer';
import { compareModelArms, type CorpusClip, type EvaluatorPolicy, type ModelArm } from '../../tests/evidence/modelEvaluator';

export interface PairedRunPlan {
  readonly trials: number;
  readonly expected: readonly Readonly<PairedEvidenceIdentity>[];
}

/** Construct before adapters run, only from frozen input references and declared trials. */
export function freezePairedRunPlan(clips: readonly CorpusClip[], trials: number): PairedRunPlan {
  if (!Array.isArray(clips) || clips.length === 0) throw new Error('invalid_frozen_corpus');
  if (!Number.isSafeInteger(trials) || trials < 2) throw new Error('declare_at_least_two_trials_in_corpus');
  const expected = clips.flatMap((clip) => {
    if (!clip || typeof clip.reference !== 'string') throw new Error('invalid_frozen_reference');
    return Array.from({ length: trials }, (_, trial) => Object.freeze({
      utteranceId: clip.id, trialId: String(trial), clusterId: clip.clusterId,
      referenceSha256: createHash('sha256').update(clip.reference, 'utf8').digest('hex'),
      referenceWords: normalizeOfficialTrackA(clip.reference).length,
    }));
  });
  // Validate the declaration itself, including duplicate clips, before execution.
  validatePairedEvidence(expected, expected, expected);
  return Object.freeze({ trials, expected: Object.freeze(expected) });
}

export function plannedSample(plan: PairedRunPlan, clipId: string, trial: number): Readonly<PairedEvidenceIdentity> {
  const identity=plan.expected.find(row=>row.utteranceId===clipId && row.trialId===String(trial));
  if (!identity) throw new Error('sample_not_in_frozen_plan');
  return identity;
}

/** Used by the real runner before any statistical comparison or report verdict. */
export function evaluatePairedRun(
  plan: PairedRunPlan, clips: readonly CorpusClip[], baseline: ModelArm, candidate: ModelArm, policy: EvaluatorPolicy | null,
) {
  try {
    // Mutation of the input references after freezing cannot change a denominator.
    const current=freezePairedRunPlan(clips,plan.trials);
    validatePairedEvidence(plan.expected,current.expected,current.expected);
    const rows=(arm:ModelArm)=>arm.results.map(result=>{
      const identity=result.evidence;
      if (!identity || identity.utteranceId!==result.clipId || identity.trialId!==String(result.trial)) {
        throw new Error('paired_result_identity_missing_or_mismatched');
      }
      return {...identity,result,observed:arm.observed};
    });
    const pairs=validatePairedEvidence(plan.expected,rows(baseline),rows(candidate));
    // Preserve the complete arms/failure rows. Completeness does not imply model quality.
    const comparison=compareModelArms(clips,baseline,candidate,policy,plan.trials);
    return { pairedEvidence:{status:'COMPLETE' as const,expectedRows:plan.expected.length,validatedPairs:pairs.length,error:null},comparison };
  } catch(error) {
    return { pairedEvidence:{status:'INVALID' as const,expectedRows:plan.expected.length,validatedPairs:null,error:String(error)},comparison:null };
  }
}
