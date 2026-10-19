import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { countFillerWords } from '../../frontend/src/utils/fillerWordUtils';
import { normalizeTranscript } from '../../tests/evidence/werMetric';
import { normalizeOfficialTrackA } from '../../tests/evidence/normalization/officialNormalizer';

// Retained public synthetic diagnostic e57cd8e6, not new speech/model execution.
const reference = 'So um I think uh we should um review the plan today';
const raw = [
  "So I'm I think I wish you a review of the plan today.",
  ' So am I think I we should unreview the plan today.',
];
const observations: Record<string, unknown>[] = [];
const check = (id: string, text: string, total: number, perKey?: [string, number]) => {
  const result = countFillerWords(text);
  assert.equal(result.total.count, total, id);
  if (perKey) assert.equal(result[perKey[0]].count, perKey[1], id);
  observations.push({ id, coachable: result.total.count,
    perKey: Object.fromEntries(Object.entries(result).filter(([k,v]) => k !== 'total' && v.count > 0).map(([k,v]) => [k,v.count])) });
};
check('script_reference', reference, 3, ['so', 1]);
check('retained_v2_raw_final', raw[0], 0, ['so', 1]);
check('retained_v4_raw_final', raw[1], 0, ['so', 1]);
check('true_fillers', 'um uh ah', 3);
check('lexical_marker_candidate_not_coachable', 'like the plan', 0, ['like', 1]);
check('substring_negative', 'sometimes umbrella', 0);
check('empty_success_text_control', '', 0);
assert.equal(countFillerWords('so', ['so']).total.count, 1);
// The first probe mistakenly used historical norm_v1. Keep that distinction explicit:
// benchmarkScore calls wordErrorRate(track_a), which uses normalizeOfficialTrackA.
assert(normalizeTranscript(reference).includes('um'));
const normalized = normalizeOfficialTrackA(reference);
assert(!normalized.includes('um') && !normalized.includes('uh'));
writeFileSync(new URL('./filler-diagnostic-controls.json', import.meta.url), JSON.stringify({
  status: 'ACTUAL_EXISTING_DETECTOR_AND_NORMALIZER_CONTROLS_PASS',
  retainedDiagnostic: 'e57cd8e6630a146a56fe8f4181cd72789e09a023',
  checks: 10, observations, customSoOptIn: 1,
  historicalNormV1PreservesUm: true,
  probeCorrection: 'Initial probe used historical normalizeTranscript; corrected to the actual official Track-A core after inspecting benchmarkScore/wordErrorRate. No product source was changed.',
  normalizedReferenceWords: normalized.length, normalizedReferenceContainsUmUh: false,
  newInference: false, acousticReferenceVerified: false,
  conclusion: 'Raw final text already lacks coachable um/uh; Track-A normalization alone does not explain the zero count. TTS/acoustic versus recognition cause unresolved.',
}, null, 2) + '\n');
console.log('10 detector/normalizer controls PASS; no inference, audio listening or contextual accuracy claim.');
