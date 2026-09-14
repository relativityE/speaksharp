/**
 * #1432 / F-17 — executable contract for the Production three-model decision.
 *
 * This module does not choose a model. It accepts a completed, content-free evidence packet only
 * after the PO's real-world CDP test and fails closed when any row cannot be tied to a passing
 * Production observer receipt and decoded PostHog events from the same release/model/attempt.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORD_KEYS, authorizationShapeProblems, checkRunAuthority } from './modelComparisonRunAuthority.mjs';
import { controlReceiptProblems } from './preTakeControl.mjs';

export const MODEL_DOWNSELECTION_SCHEMA_VERSION = 'speaksharp.model-downselection.v1';
export const PRODUCTION_ORIGIN = 'https://speaksharp-public.vercel.app';
export const COMPARISON_CANDIDATES = Object.freeze([
  'v2:base.en',
  'v4:distil:q4',
  'moonshine:streaming-medium',
]);
export const REQUIRED_JOURNEYS = Object.freeze(['open_mic', 'focus_points']);

/**
 * #1432 PM RETURN `5654016276` (Codex P1 `3999918672`) — ONE SOURCE OF TRUTH FOR THE GEMINI CONTRACT.
 *
 * The Edge function imports `get-ai-suggestions/contract.json` for its provider model and its uncached daily cap,
 * and the server-owned receipt the trusted readback reports records exactly those values. A copy here drifted
 * (the retired preview model and 20, against the deployed `gemini-3.6-flash` and 10), so every truthful Production
 * packet failed and the downselection could never PASS. The model and cap are therefore read from that same file;
 * a contract that does not declare both fails closed when this module loads.
 */
export const EDGE_COACHING_CONTRACT_PATH = 'backend/supabase/functions/get-ai-suggestions/contract.json';
// Resolved from this module's own location with Node path APIs (not the `URL` global, which a jsdom test
// environment replaces), so the harness, the CLI and ordinary CI all read the same file.
const edgeCoachingContract = JSON.parse(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/supabase/functions/get-ai-suggestions/contract.json'),
  'utf8',
));
if (typeof edgeCoachingContract?.model !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(edgeCoachingContract.model)
  || !Number.isInteger(edgeCoachingContract?.uncachedGenerationCapPerUtcDay)
  || edgeCoachingContract.uncachedGenerationCapPerUtcDay < 1) {
  throw new Error(`${EDGE_COACHING_CONTRACT_PATH} must declare a model and a positive uncached daily cap`);
}

export const LOCKED_GEMINI_CONTRACT = Object.freeze({
  model: edgeCoachingContract.model,
  uncachedRequestsPerUserUtcDay: edgeCoachingContract.uncachedGenerationCapPerUtcDay,
  quotaScope: 'user_utc_day',
  whatWorkedItems: 1,
  whatToImproveItems: 1,
  maxWhitespaceWordsPerPhrase: 6,
  cachedResultsReadable: true,
});

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[A-Za-z0-9._:-]{1,128}$/;
const CANDIDATE_SET = new Set(COMPARISON_CANDIDATES);
const JOURNEY_SET = new Set(REQUIRED_JOURNEYS);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isIsoInstant = (value) => typeof value === 'string'
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
const takeKey = (candidateId, journey) => `${candidateId}/${journey}`;
const exactTakeKey = (value) => [
  value.releaseSha, value.candidateId, value.journey, value.journeyId, value.attemptId,
  value.attemptSeq, value.comparisonNonce, value.persistedSessionId, value.receiptSha256,
].join('/');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const SESSION_BINDING_VERSION = 'speaksharp.model-comparison-session-binding.v1';
export const modelComparisonSessionBindingSha256 = (comparisonNonce, persistedSessionId) => sha256(
  Buffer.from(JSON.stringify([SESSION_BINDING_VERSION, comparisonNonce, persistedSessionId])),
);
/** The only events a take may link. The document positive control is never one of them. */
const TAKE_EVENTS = new Set(['practice_mode_selected', 'session_started', 'session_saved']);

/**
 * #1432 PM RETURN `5654659496` — FOCUS POINTS COVERAGE. Selected by the saved take's native attempt, never by a
 * nonce of its own, and content-free: counts, positions, verdicts, ratios, thresholds and the evaluator version.
 * Each field is non-null only on the coverage event that defines it.
 */
const COVERAGE_EVENTS = new Set(['coverage_evaluation', 'coverage_point']);
const COVERAGE_VERDICTS = new Set(['covered', 'partial', 'missing']);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isRatio = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const EVALUATION_FIELD_RULES = Object.freeze({
  pointsSupplied: isCount, pointsEvaluated: isCount, coveredThreshold: isRatio, partialThreshold: isRatio,
});
const POINT_FIELD_RULES = Object.freeze({
  pointPosition: isCount, verdict: (value) => COVERAGE_VERDICTS.has(value), matchRatio: isRatio,
  keywordCount: isCount, latched: (value) => typeof value === 'boolean',
});
/** PM 5654994284 — the entered count, recorded at setup under the take's native journey. */
const SETUP_EVENT = 'journey_step';
const SETUP_FIELD_RULES = Object.freeze({
  step: (value) => value === 'setup_submitted', pointsEntered: isCount,
});
const FOCUS_COVERAGE_KEYS = [
  'evaluatorVersion', 'pointsEntered', 'pointsSupplied', 'pointsEvaluated', 'coveredThreshold', 'partialThreshold',
  'predicateVersion', 'points',
];
const COVERAGE_POINT_KEYS = ['position', 'verdict'];
/** PM RETURN `5655220799` — the stop seam persists a binary verdict; `unavailable` is never a qualifying verdict. */
const FINALIZED_ROW_VERDICTS = new Set(['detected', 'not_detected']);
/** One evaluator and one predicate must have scored every candidate, or a delta is scoring drift, not transcription. */
const SHARED_EVALUATOR_KEYS = ['evaluatorVersion', 'coveredThreshold', 'partialThreshold', 'predicateVersion'];

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
};

/** Digest of the completed evidence before the PO disposition (avoids a circular approval hash). */
export function completedEvidenceDigest(value) {
  const evidence = {
    schemaVersion: value?.schemaVersion,
    evidenceDocumentId: value?.evidenceDocumentId,
    environment: value?.environment,
    geminiContract: value?.geminiContract,
    telemetryReadback: value?.telemetryReadback,
    candidateEvidence: value?.candidateEvidence,
    geminiEvidence: value?.geminiEvidence,
  };
  return sha256(Buffer.from(JSON.stringify(stable(evidence))));
}

function loadVerifiedJson(ref, expectedDigest, baseDir, path, problems) {
  if (typeof ref !== 'string' || ref.length < 1 || ref.length > 240 || isAbsolute(ref)) {
    problems.push(`${path} must be a bounded relative artifact path`);
    return null;
  }
  const artifactPath = resolve(baseDir, ref);
  if (relative(resolve(baseDir), artifactPath).startsWith('..')) {
    problems.push(`${path} must stay inside the evidence directory`);
    return null;
  }
  let bytes;
  try { bytes = readFileSync(artifactPath); } catch {
    problems.push(`${path} could not be read`);
    return null;
  }
  const actualDigest = sha256(bytes);
  if (typeof expectedDigest !== 'string' || !SHA256.test(expectedDigest)) {
    problems.push(`${path}Sha256 must be a lowercase SHA-256 digest`);
  } else if (actualDigest !== expectedDigest) {
    problems.push(`${path} digest does not match the referenced artifact`);
  }
  try { return JSON.parse(bytes.toString('utf8')); } catch {
    problems.push(`${path} is not valid JSON`);
    return null;
  }
}

function exactKeys(value, keys, path, problems) {
  if (!isObject(value)) {
    problems.push(`${path} must be an object`);
    return false;
  }
  const expected = new Set(keys);
  for (const key of keys) if (!Object.hasOwn(value, key)) problems.push(`${path}.${key} is missing`);
  for (const key of Object.keys(value)) if (!expected.has(key)) problems.push(`${path}.${key} is not allowed`);
  return true;
}

function expectEqual(actual, expected, path, problems) {
  if (actual !== expected) problems.push(`${path} must be ${JSON.stringify(expected)}`);
}

function validateEnvironment(environment, problems) {
  if (!exactKeys(environment, ['origin', 'releaseSha'], 'environment', problems)) return;
  expectEqual(environment.origin, PRODUCTION_ORIGIN, 'environment.origin', problems);
  if (typeof environment.releaseSha !== 'string' || !SHA40.test(environment.releaseSha)) {
    problems.push('environment.releaseSha must be a full lowercase git SHA');
  }
}

function validateGeminiContract(contract, problems) {
  const keys = Object.keys(LOCKED_GEMINI_CONTRACT);
  if (!exactKeys(contract, keys, 'geminiContract', problems)) return;
  for (const key of keys) expectEqual(contract[key], LOCKED_GEMINI_CONTRACT[key], `geminiContract.${key}`, problems);
}

function validateReceipt(receipt, row, releaseSha, evidenceDocumentId, runAuthorityResolver, path, problems) {
  if (!isObject(receipt)) {
    problems.push(`${path}.receiptArtifact must contain a JSON object`);
    return;
  }
  // RWT-01 — only a pre-take control receipt that disconnected before the take qualifies a row. The retired observer's
  // receipt (and any privacy-diagnostic run) was produced with the instrument attached to the take it measured.
  for (const problem of controlReceiptProblems(receipt)) problems.push(`${path}.receipt ${problem}`);
  expectEqual(receipt.verdict, 'PASS', `${path}.receipt.verdict`, problems);
  expectEqual(receipt.holdKind ?? null, null, `${path}.receipt.holdKind`, problems);
  expectEqual(receipt.dryRun, false, `${path}.receipt.dryRun`, problems);
  expectEqual(receipt.target?.origin ?? receipt.targetOrigin, PRODUCTION_ORIGIN, `${path}.receipt.target.origin`, problems);
  expectEqual(receipt.release ?? receipt.releaseSha, releaseSha, `${path}.receipt.release`, problems);
  for (const key of ['expectedCandidate', 'requestedCandidate', 'observedCandidate']) {
    expectEqual(receipt[key], row.candidateId, `${path}.receipt.${key}`, problems);
  }
  expectEqual(receipt.journey, row.journey, `${path}.receipt.journey`, problems);
  expectEqual(receipt.comparisonNonce, row.comparisonNonce, `${path}.receipt.comparisonNonce`, problems);
  // The observer cannot see the envelope's native journey/attempt identity, so it no longer records a
  // value for them. Those come only from the authenticated readback (validateCandidateEvidence).
  expectEqual(receipt.evidenceDocumentId, evidenceDocumentId, `${path}.receipt.evidenceDocumentId`, problems);
  if (!isIsoInstant(receipt.capturedAt)) problems.push(`${path}.receipt.capturedAt must be an ISO instant`);
  // The control disconnects before the take, so it cannot see the saved session. The persisted session is bound by the
  // authenticated telemetry readback (`session_saved` binding) and the Gemini authority, never by this receipt.
  // #1432 Product Owner decision 5651663038 — the take's authority is one GitHub authorization run. The trusted
  // observer verified it before arming; it is RE-READ from GitHub here. A page-side claim, a receipt without the
  // run record, or a run GitHub does not confirm is not evidence.
  const record = receipt.authorization;
  if (!isObject(record)) {
    problems.push(`${path}.receipt observer receipt has no GitHub run authorization record`);
    return;
  }
  const shape = authorizationShapeProblems(record, RECORD_KEYS);
  for (const problem of shape) problems.push(`${path}.receipt ${problem}`);
  if (shape.length > 0) return;
  expectEqual(record.nonce, row.comparisonNonce, `${path}.receipt.authorization.nonce`, problems);
  let bundle = null;
  if (typeof runAuthorityResolver !== 'function') {
    problems.push(`${path}.receipt authorization has no GitHub run authority resolver`);
  } else {
    try { bundle = runAuthorityResolver(record.runId, record.runAttempt); } catch { bundle = null; }
  }
  if (!isObject(bundle)) {
    problems.push(`${path}.receipt authorization run ${record.runId} could not be read back from GitHub`);
    return;
  }
  for (const problem of checkRunAuthority({
    record, ...bundle,
    expected: { candidateId: row.candidateId, journey: row.journey, releaseSha, origin: PRODUCTION_ORIGIN, evidenceDocumentId },
    at: Date.parse(record.verifiedAt),
  })) problems.push(`${path}.receipt ${problem}`);
}

function validateTelemetryReadback(readback, releaseSha, evidenceDocumentId, telemetryResolver, problems) {
  const keys = ['source', 'queryId', 'decodedAt', 'positiveControlNonce', 'events'];
  if (!exactKeys(readback, keys, 'telemetryReadback', problems)) return [];
  expectEqual(readback.source, 'posthog_decoded_readback', 'telemetryReadback.source', problems);
  if (typeof readback.queryId !== 'string' || !TOKEN.test(readback.queryId)) {
    problems.push('telemetryReadback.queryId must be a bounded readback identifier');
  }
  if (!isIsoInstant(readback.decodedAt)) problems.push('telemetryReadback.decodedAt must be an ISO instant');
  if (typeof readback.positiveControlNonce !== 'string' || !TOKEN.test(readback.positiveControlNonce)) {
    problems.push('telemetryReadback.positiveControlNonce must be a bounded nonce');
  }
  expectEqual(readback.positiveControlNonce, evidenceDocumentId,
    'telemetryReadback.positiveControlNonce must equal evidence.evidenceDocumentId', problems);
  if (!Array.isArray(readback.events)) {
    problems.push('telemetryReadback.events must be an array');
    return [];
  }

  let authoritative = null;
  if (typeof telemetryResolver !== 'function') {
    problems.push('telemetryReadback has no independent PostHog authority resolver');
  } else {
    try { authoritative = telemetryResolver(readback.queryId); } catch {
      problems.push('telemetryReadback could not be read from authenticated PostHog authority');
    }
  }
  if (!isObject(authoritative)) {
    problems.push('telemetryReadback is not present in authenticated PostHog authority');
  } else if (JSON.stringify(stable(authoritative)) !== JSON.stringify(stable(readback))) {
    problems.push('telemetryReadback differs from authenticated PostHog authority');
  }

  const eventKeys = [
    'uuid', 'event', 'releaseSha', 'candidateId', 'productMode', 'journeyId', 'attemptId', 'attemptSeq',
    'wordCount', 'comparisonNonce', 'controlNonce', 'transportInitialized', 'evidenceDocumentId',
    'sessionBindingSha256', 'evaluatorVersion', ...Object.keys(EVALUATION_FIELD_RULES), ...Object.keys(POINT_FIELD_RULES),
    ...Object.keys(SETUP_FIELD_RULES),
  ];
  const uuids = new Set();
  for (const [index, event] of readback.events.entries()) {
    const path = `telemetryReadback.events[${index}]`;
    if (!exactKeys(event, eventKeys, path, problems)) continue;
    if (typeof event.uuid !== 'string' || !TOKEN.test(event.uuid)) problems.push(`${path}.uuid is invalid`);
    else if (uuids.has(event.uuid)) problems.push(`${path}.uuid duplicates ${event.uuid}`);
    else uuids.add(event.uuid);
    if (typeof event.event !== 'string' || !TOKEN.test(event.event)) problems.push(`${path}.event is invalid`);
    expectEqual(event.releaseSha, releaseSha, `${path}.releaseSha`, problems);
    if (event.candidateId !== null && !CANDIDATE_SET.has(event.candidateId)) {
      problems.push(`${path}.candidateId is not a comparison candidate`);
    }
    if (event.productMode !== null && !['quick', 'objective'].includes(event.productMode)) {
      problems.push(`${path}.productMode is invalid`);
    }
    if (typeof event.journeyId !== 'string' || !TOKEN.test(event.journeyId)) {
      problems.push(`${path}.journeyId is invalid`);
    }
    if (event.attemptId !== null && (typeof event.attemptId !== 'string' || !TOKEN.test(event.attemptId))) {
      problems.push(`${path}.attemptId is invalid`);
    }
    if (!Number.isInteger(event.attemptSeq) || event.attemptSeq < 0) problems.push(`${path}.attemptSeq is invalid`);
    if (event.wordCount !== null && (!Number.isInteger(event.wordCount) || event.wordCount < 0)) {
      problems.push(`${path}.wordCount is invalid`);
    }
    if (event.comparisonNonce !== null
      && (typeof event.comparisonNonce !== 'string' || !TOKEN.test(event.comparisonNonce))) {
      problems.push(`${path}.comparisonNonce is invalid`);
    }
    if (event.controlNonce !== null && (typeof event.controlNonce !== 'string' || !TOKEN.test(event.controlNonce))) {
      problems.push(`${path}.controlNonce is invalid`);
    }
    // Take authority and document authority are separate columns and must stay separate on every row.
    if (event.event === 'telemetry_positive_control') {
      if (event.comparisonNonce !== null) {
        problems.push(`${path} positive control must not carry a take comparisonNonce`);
      }
    } else if (TAKE_EVENTS.has(event.event)) {
      if (event.controlNonce !== null) problems.push(`${path} take event must not carry the document controlNonce`);
      if (event.comparisonNonce === null) problems.push(`${path} take event has no comparisonNonce`);
    } else if (COVERAGE_EVENTS.has(event.event) || event.event === SETUP_EVENT) {
      if (event.comparisonNonce !== null || event.controlNonce !== null) {
        problems.push(`${path} ${event.event} must not carry a take or document nonce`);
      }
    } else {
      problems.push(`${path}.event ${JSON.stringify(event.event)} is not a comparison readback event`);
    }
    if (event.transportInitialized !== null && typeof event.transportInitialized !== 'boolean') {
      problems.push(`${path}.transportInitialized is invalid`);
    }
    if (event.evidenceDocumentId !== null && !UUID_V4.test(event.evidenceDocumentId)) {
      problems.push(`${path}.evidenceDocumentId must be a lowercase UUIDv4`);
    }
    if (event.sessionBindingSha256 !== null && !SHA256.test(event.sessionBindingSha256)) {
      problems.push(`${path}.sessionBindingSha256 must be a lowercase SHA-256 digest`);
    }
    const evaluation = event.event === 'coverage_evaluation';
    const point = event.event === 'coverage_point';
    if (evaluation || point
      ? typeof event.evaluatorVersion !== 'string' || !TOKEN.test(event.evaluatorVersion)
      : event.evaluatorVersion !== null) {
      problems.push(`${path}.evaluatorVersion is invalid`);
    }
    for (const [key, valid] of Object.entries(EVALUATION_FIELD_RULES)) {
      if (evaluation ? !valid(event[key]) : event[key] !== null) problems.push(`${path}.${key} is invalid`);
    }
    for (const [key, valid] of Object.entries(POINT_FIELD_RULES)) {
      if (point ? !valid(event[key]) : event[key] !== null) problems.push(`${path}.${key} is invalid`);
    }
    for (const [key, valid] of Object.entries(SETUP_FIELD_RULES)) {
      if (event.event === SETUP_EVENT ? !valid(event[key]) : event[key] !== null) problems.push(`${path}.${key} is invalid`);
    }
  }

  const controls = readback.events.filter((event) => event?.event === 'telemetry_positive_control');
  if (controls.length !== 1) problems.push('telemetryReadback must contain exactly one telemetry_positive_control event');
  else {
    expectEqual(controls[0].controlNonce, evidenceDocumentId,
      'telemetryReadback positive-control nonce', problems);
    expectEqual(controls[0].transportInitialized, true,
      'telemetryReadback positive-control transportInitialized', problems);
    expectEqual(controls[0].evidenceDocumentId, evidenceDocumentId,
      'telemetryReadback positive-control evidenceDocumentId', problems);
  }
  return readback.events;
}

/**
 * One objective take's per-point coverage. Two authorities, never blurred (PM RETURN `5655220799`):
 *
 * - The FINALIZED stop-seam record is the per-point verdict of record: the take's persisted session's
 *   `objective_evidence`, read content-free by the collector and attached to that session's attested authority. Its
 *   binary `detected | not_detected` is what the tester saw and what persisted.
 * - Pre-final telemetry corroborates the COUNT CHAIN only: the last `setup_submitted` before `session_started` in the
 *   native journey (entered), the last `coverage_evaluation` (supplied, evaluated, evaluator) and the `coverage_point`
 *   rows emitted after it (one effective row per contiguous position). Its verdicts are never compared with the
 *   finalized ones, so a pre-final disagreement can neither overwrite nor veto the record.
 */
function validateFocusCoverage(value, { setup, linked, finalized }, candidateId, path, problems) {
  const where = `${path}.focusCoverage`;
  for (const event of linked) {
    if (event.candidateId !== null && event.candidateId !== candidateId) {
      problems.push(`${path} linked ${event.event} ${event.uuid} candidateId must be ${JSON.stringify(candidateId)}`);
    }
  }
  if (!exactKeys(value, FOCUS_COVERAGE_KEYS, where, problems)) return null;

  if (!setup) {
    problems.push(`${path} must link a decoded setup_submitted in its native journey before its session_started`);
  } else {
    expectEqual(value.pointsEntered, setup.pointsEntered, `${where}.pointsEntered observed setup_submitted`, problems);
  }
  if (value.pointsEntered !== value.pointsSupplied) {
    problems.push(`${where} lost a point between setup and evaluation: pointsEntered ${value.pointsEntered}, pointsSupplied ${value.pointsSupplied}`);
  }
  // A point lost before evaluation leaves every position check satisfied, so it is caught by count alone.
  if (value.pointsSupplied !== value.pointsEvaluated) {
    problems.push(`${where} dropped a point before evaluation: pointsSupplied ${value.pointsSupplied}, pointsEvaluated ${value.pointsEvaluated}`);
  }
  const evaluation = linked.filter((event) => event.event === 'coverage_evaluation').at(-1);
  if (!evaluation) {
    problems.push(`${path} must link a decoded coverage_evaluation for its Focus Points take`);
  } else {
    for (const key of ['evaluatorVersion', ...Object.keys(EVALUATION_FIELD_RULES)]) {
      expectEqual(value[key], evaluation[key], `${where}.${key} observed coverage_evaluation`, problems);
    }
    const effective = new Map();
    for (const event of linked.slice(linked.lastIndexOf(evaluation) + 1)) {
      if (event.event !== 'coverage_point') continue;
      if (effective.has(event.pointPosition)) {
        problems.push(`${path} has more than one effective coverage_point at position ${event.pointPosition}`);
      }
      effective.set(event.pointPosition, event);
      if (event.evaluatorVersion !== evaluation.evaluatorVersion) {
        problems.push(`${path} coverage_point ${event.uuid} evaluatorVersion differs from its coverage_evaluation`);
      }
    }
    const positions = [...effective.keys()].sort((left, right) => left - right);
    if (positions.length !== evaluation.pointsEvaluated || positions.some((position, index) => position !== index)) {
      problems.push(`${path} authenticated coverage_point rows must be one per evaluated position, contiguous from 0`);
    }
  }

  const sessions = isObject(finalized?.finalizedCoverage) ? finalized.finalizedCoverage.sessions : undefined;
  let record = null;
  if (!Array.isArray(sessions)) {
    problems.push(`${path} has no finalized stop-seam readback for its persisted session`);
  } else if (sessions.length !== 1) {
    problems.push(`${path} must resolve exactly one finalized stop-seam session (found ${sessions.length})`);
  } else {
    record = Array.isArray(sessions[0]?.points) ? sessions[0].points : [];
    if (record.length !== value.pointsEntered) {
      problems.push(`${path} finalized stop-seam evidence must carry exactly one row per entered point (entered ${value.pointsEntered}, finalized ${record.length})`);
    }
    if (record.some((point, index) => point?.sortOrder !== index)) {
      problems.push(`${path} finalized stop-seam sort_order must be contiguous from 0 with no duplicate`);
    }
    for (const [index, point] of record.entries()) {
      if (point?.verdict === 'unavailable') problems.push(`${path} finalized stop-seam verdict at position ${index} is unavailable`);
    }
    const predicates = new Set(record.map((point) => point?.predicateVersion));
    if (record.length > 0 && (predicates.size !== 1 || !predicates.has(value.predicateVersion))) {
      problems.push(`${where}.predicateVersion must equal the finalized stop-seam predicate_version`);
    }
  }

  if (!Array.isArray(value.points)) {
    problems.push(`${where}.points must be an array`);
    return null;
  }
  if (value.points.length !== value.pointsEntered) {
    problems.push(`${where}.points must carry exactly one finalized verdict per entered point (${value.pointsEntered})`);
  }
  if (value.points.some((point, index) => point?.position !== index)) {
    problems.push(`${where}.points positions must be contiguous from 0 and in order`);
  }
  for (const [index, point] of value.points.entries()) {
    const at = `${where}.points[${index}]`;
    if (!exactKeys(point, COVERAGE_POINT_KEYS, at, problems)) continue;
    if (!FINALIZED_ROW_VERDICTS.has(point.verdict)) problems.push(`${at}.verdict must be detected or not_detected`);
    if (!record) continue;
    const recorded = record.find((entry) => entry?.sortOrder === point.position);
    if (!recorded) {
      problems.push(`${at} has no finalized stop-seam verdict at position ${JSON.stringify(point.position)}`);
    } else if (recorded.verdict !== 'unavailable') {
      expectEqual(point.verdict, recorded.verdict, `${at}.verdict finalized stop-seam verdict`, problems);
    }
  }
  return value;
}

function validateCandidateEvidence(rows, events, releaseSha, evidenceDocumentId, baseDir, runAuthorityResolver, problems, geminiResolver) {
  if (!Array.isArray(rows)) {
    problems.push('candidateEvidence must be an array');
    return new Set();
  }
  const expectedKeys = new Set(COMPARISON_CANDIDATES.flatMap((candidate) =>
    REQUIRED_JOURNEYS.map((journey) => takeKey(candidate, journey))));
  const seen = new Set();
  const correlations = new Set();
  const receiptDigests = new Set();
  const exactKeysSeen = new Set();
  const comparisonNonces = new Set();
  const authorizationRuns = new Set();
  const focusCoverages = [];
  // The finalized stop-seam record rides on the attested persisted-session authority it is keyed by. A missing
  // resolver is reported by validateGeminiEvidence; here it simply leaves every Focus Points row unproven.
  let sessionAuthority = null;
  if (typeof geminiResolver === 'function') {
    try { sessionAuthority = geminiResolver(); } catch { sessionAuthority = null; }
  }
  const finalizedBySession = new Map((Array.isArray(sessionAuthority) ? sessionAuthority : [])
    .filter(isObject).map((authority) => [authority.persistedSessionId, authority]));

  for (const [index, row] of rows.entries()) {
    const path = `candidateEvidence[${index}]`;
    const keys = [
      'releaseSha', 'candidateId', 'journey', 'journeyId', 'attemptId', 'attemptSeq', 'comparisonNonce',
      'persistedSessionId',
      'receiptArtifact', 'receiptSha256',
    ];
    const hasCoverage = isObject(row) && Object.hasOwn(row, 'focusCoverage');
    if (!exactKeys(row, hasCoverage ? [...keys, 'focusCoverage'] : keys, path, problems)) continue;
    if (!CANDIDATE_SET.has(row.candidateId)) problems.push(`${path}.candidateId is not in the three-model slate`);
    if (!JOURNEY_SET.has(row.journey)) problems.push(`${path}.journey is not required`);
    expectEqual(row.releaseSha, releaseSha, `${path}.releaseSha`, problems);
    const key = takeKey(row.candidateId, row.journey);
    if (seen.has(key)) problems.push(`${path} duplicates ${key}`);
    seen.add(key);
    if (typeof row.journeyId !== 'string' || !TOKEN.test(row.journeyId)) problems.push(`${path}.journeyId is invalid`);
    if (typeof row.attemptId !== 'string' || !TOKEN.test(row.attemptId)) problems.push(`${path}.attemptId is invalid`);
    if (!Number.isInteger(row.attemptSeq) || row.attemptSeq < 1) problems.push(`${path}.attemptSeq must be positive`);
    if (typeof row.comparisonNonce !== 'string' || !TOKEN.test(row.comparisonNonce)) {
      problems.push(`${path}.comparisonNonce is invalid`);
    } else if (comparisonNonces.has(row.comparisonNonce)) {
      problems.push(`${path}.comparisonNonce reuses signed take authority ${row.comparisonNonce}`);
    } else {
      comparisonNonces.add(row.comparisonNonce);
    }
    if (typeof row.persistedSessionId !== 'string' || !UUID_V4.test(row.persistedSessionId)) {
      problems.push(`${path}.persistedSessionId must be a lowercase UUIDv4`);
    }
    const correlation = `${row.journeyId}/${row.attemptId}`;
    if (correlations.has(correlation)) problems.push(`${path} reuses telemetry correlation ${correlation}`);
    correlations.add(correlation);
    const receiptDigest = row.receiptSha256;
    if (typeof receiptDigest === 'string' && SHA256.test(receiptDigest)) {
      if (receiptDigests.has(receiptDigest)) problems.push(`${path} reuses observer receipt ${receiptDigest}`);
      receiptDigests.add(receiptDigest);
    }
    const receipt = loadVerifiedJson(row.receiptArtifact, receiptDigest, baseDir, `${path}.receiptArtifact`, problems);
    if (receipt) {
      validateReceipt(receipt, row, releaseSha, evidenceDocumentId, runAuthorityResolver, path, problems);
      // One authorization run stands behind exactly one row of the canonical packet — across attempts too: a rerun
      // repeats its run's cell, so a second attempt can never authorize a second row (PM 5651684739).
      const auth = receipt.authorization;
      if (isObject(auth) && Number.isInteger(auth.runId)) {
        const runKey = String(auth.runId);
        if (authorizationRuns.has(runKey)) problems.push(`${path} reuses authorization run ${runKey}`);
        authorizationRuns.add(runKey);
      }
    }
    const exactKey = exactTakeKey(row);
    if (exactKeysSeen.has(exactKey)) problems.push(`${path} duplicates exact take authority`);
    exactKeysSeen.add(exactKey);

    // #1432 PM Option A — THE TAKE IS FOUND BY ITS SIGNED NONCE, AND ONLY BY IT. Native journey/attempt
    // identity belongs to the envelope and is OBSERVED here, never used to select. Two takes inside one
    // native journey therefore cannot borrow each other's events, and a different or later nonce links
    // nothing to this row.
    const linked = typeof row.comparisonNonce === 'string'
      ? events.filter((event) => TAKE_EVENTS.has(event?.event) && event?.comparisonNonce === row.comparisonNonce)
      : [];
    for (const event of linked) {
      const where = `${path} linked ${event.event} ${event.uuid}`;
      expectEqual(event.evidenceDocumentId, evidenceDocumentId, `${where} evidenceDocumentId`, problems);
      if (event.event === 'practice_mode_selected') {
        // Mode selection can precede engine resolution, so an absent attribution is not a contradiction;
        // a DIFFERENT model is.
        if (event.candidateId !== null && event.candidateId !== row.candidateId) {
          problems.push(`${where} candidateId must be ${JSON.stringify(row.candidateId)}`);
        }
      } else {
        expectEqual(event.candidateId, row.candidateId, `${where} candidateId`, problems);
      }
    }
    const starts = linked.filter((event) => event.event === 'session_started');
    const saves = linked.filter((event) => event.event === 'session_saved');
    if (starts.length !== 1) problems.push(`${path} must link exactly one decoded session_started event`);
    if (saves.length !== 1) problems.push(`${path} must link exactly one decoded session_saved event`);
    else if (!Number.isInteger(saves[0].wordCount) || saves[0].wordCount < 1) {
      problems.push(`${path} session_saved must prove a non-empty decoded transcript`);
    } else {
      expectEqual(
        saves[0].sessionBindingSha256,
        modelComparisonSessionBindingSha256(row.comparisonNonce, row.persistedSessionId),
        `${path} session_saved persisted-session binding`,
        problems,
      );
    }
    if (starts.length === 1 && saves.length === 1) {
      const [start] = starts;
      const [save] = saves;
      if (typeof start.attemptId !== 'string' || start.attemptSeq < 1) {
        problems.push(`${path} session_started carries no native attempt identity`);
      }
      expectEqual(save.journeyId, start.journeyId, `${path} session_saved native journeyId`, problems);
      expectEqual(save.attemptId, start.attemptId, `${path} session_saved native attemptId`, problems);
      expectEqual(save.attemptSeq, start.attemptSeq, `${path} session_saved native attemptSeq`, problems);
      // The packet's copies are operator-authored; the authenticated readback is the authority.
      expectEqual(row.journeyId, start.journeyId, `${path}.journeyId observed native journey`, problems);
      expectEqual(row.attemptId, start.attemptId, `${path}.attemptId observed native attempt`, problems);
      expectEqual(row.attemptSeq, start.attemptSeq, `${path}.attemptSeq observed native attempt sequence`, problems);
    }
    // Product identity is decoded from practice-mode telemetry bound to THIS take's nonce, not from the
    // operator label and not from whatever else happened in the same native journey.
    const expectedMode = row.journey === 'focus_points' ? 'objective' : 'quick';
    const modes = linked.filter((event) => event.event === 'practice_mode_selected');
    if (!modes.some((event) => event.productMode === expectedMode)) {
      problems.push(`${path} must link decoded ${expectedMode} journey telemetry`);
    }
    if (modes.some((event) => event.productMode !== expectedMode)) {
      problems.push(`${path} has contradictory decoded journey telemetry`);
    }
    // #1432 PM RETURN `5654659496` — conditioned on product mode. Coverage belongs to the saved take's native
    // attempt, found through the nonce-linked session_started, never through an operator-copied identifier.
    const start = starts.length === 1 ? starts[0] : null;
    const startIndex = start ? events.indexOf(start) : -1;
    const setup = start
      ? events.filter((event, index) => index < startIndex && event?.event === SETUP_EVENT
        && event.journeyId === start.journeyId).at(-1) ?? null
      : null;
    const coverage = start && typeof start.attemptId === 'string'
      ? events.filter((event) => COVERAGE_EVENTS.has(event?.event)
        && event.journeyId === start.journeyId && event.attemptId === start.attemptId)
      : [];
    if (expectedMode === 'objective') {
      if (!hasCoverage) problems.push(`${path}.focusCoverage is required on an objective (Focus Points) take`);
      else if (validateFocusCoverage(row.focusCoverage, {
        setup, linked: coverage, finalized: finalizedBySession.get(row.persistedSessionId) ?? null,
      }, row.candidateId, path, problems)) {
        focusCoverages.push(row.focusCoverage);
      }
    } else {
      // PRODUCT_REQUIREMENTS §2 — Focus Points state must never leak into an Open Mic take.
      if (hasCoverage) problems.push(`${path}.focusCoverage must be absent on a quick (Open Mic) take`);
      if (coverage.length > 0) problems.push(`${path} quick (Open Mic) take links decoded coverage telemetry`);
      if (isObject(finalizedBySession.get(row.persistedSessionId)?.finalizedCoverage)) {
        problems.push(`${path} quick (Open Mic) take has finalized stop-seam coverage`);
      }
    }
  }
  for (const key of SHARED_EVALUATOR_KEYS) {
    const values = new Set(focusCoverages.map((coverage) => coverage[key]));
    if (values.size > 1) {
      problems.push(`candidateEvidence Focus Points takes were not scored by one evaluator: ${key} differs (${[...values].map((value) => JSON.stringify(value)).join(', ')})`);
    }
  }
  const rowNonces = new Set(rows.filter(isObject).map((row) => row.comparisonNonce));
  for (const event of events) {
    if (TAKE_EVENTS.has(event?.event) && event?.comparisonNonce !== null && !rowNonces.has(event?.comparisonNonce)) {
      problems.push(`telemetryReadback event ${event?.uuid} carries a comparisonNonce that belongs to no candidate row`);
    }
  }
  for (const key of expectedKeys) if (!seen.has(key)) problems.push(`candidateEvidence is missing ${key}`);
  for (const key of seen) if (!expectedKeys.has(key)) problems.push(`candidateEvidence has unexpected row ${key}`);
  return new Set(rows.filter(isObject).map(exactTakeKey));
}

function validateOutputShape(output, path, problems) {
  const keys = [
    'whatWorkedItems', 'whatToImproveItems', 'whatWorkedWhitespaceWords',
    'whatToImproveWhitespaceWords', 'readable', 'suggestionDigest',
  ];
  if (!exactKeys(output, keys, path, problems)) return;
  expectEqual(output.whatWorkedItems, 1, `${path}.whatWorkedItems`, problems);
  expectEqual(output.whatToImproveItems, 1, `${path}.whatToImproveItems`, problems);
  for (const key of ['whatWorkedWhitespaceWords', 'whatToImproveWhitespaceWords']) {
    if (!Number.isInteger(output[key]) || output[key] < 1 || output[key] > 6) {
      problems.push(`${path}.${key} must be between 1 and 6`);
    }
  }
  expectEqual(output.readable, true, `${path}.readable`, problems);
  if (typeof output.suggestionDigest !== 'string' || !SHA256.test(output.suggestionDigest)) {
    problems.push(`${path}.suggestionDigest must be a lowercase SHA-256 digest`);
  }
}

function validateGeminiEvidence(observations, requiredTakeKeys, geminiResolver, problems) {
  if (!Array.isArray(observations)) {
    problems.push('geminiEvidence must be an array');
    return;
  }
  let authoritative = null;
  if (typeof geminiResolver !== 'function') {
    problems.push('geminiEvidence has no trusted persisted-session authority resolver');
  } else {
    try { authoritative = geminiResolver(); } catch {
      problems.push('geminiEvidence could not be read from trusted persisted-session authority');
    }
  }
  if (!Array.isArray(authoritative)) {
    problems.push('geminiEvidence is not present in trusted persisted-session authority');
  }

  const authorityBySession = new Map((Array.isArray(authoritative) ? authoritative : []).map((row) => [
    row?.persistedSessionId,
    row,
  ]));

  const freshByTake = new Map();
  const quotaOrdinals = new Set();
  let validCacheReplay = false;
  for (const [index, observation] of observations.entries()) {
    const path = `geminiEvidence[${index}]`;
    const keys = [
      'releaseSha', 'candidateId', 'journey', 'journeyId', 'attemptId', 'attemptSeq', 'comparisonNonce',
      'persistedSessionId', 'receiptSha256',
      'source', 'model', 'providerRequestMade', 'quota', 'output',
    ];
    if (!exactKeys(observation, keys, path, problems)) continue;
    const observationKey = exactTakeKey(observation);
    if (!requiredTakeKeys.has(observationKey)) problems.push(`${path} does not match a verified exact take`);
    if (!['fresh', 'cached'].includes(observation.source)) problems.push(`${path}.source is invalid`);
    expectEqual(observation.model, LOCKED_GEMINI_CONTRACT.model, `${path}.model`, problems);
    validateOutputShape(observation.output, `${path}.output`, problems);
    const sessionAuthority = authorityBySession.get(observation.persistedSessionId);
    if (!isObject(sessionAuthority)) {
      problems.push(`${path} has no trusted readback for persisted session ${observation.persistedSessionId}`);
    } else {
      // The collector refuses a rewritten value; an authority row that does not say so was not produced
      // by that check and cannot stand in for it.
      if (sessionAuthority.immutableDigestVerified !== true
        || typeof sessionAuthority.immutableSuggestionSha256 !== 'string'
        || !SHA256.test(sessionAuthority.immutableSuggestionSha256)) {
        problems.push(`${path} trusted persisted-session coaching is not bound to an immutable receipt digest`);
      }
      expectEqual(sessionAuthority.suggestionDigest, observation.output?.suggestionDigest,
        `${path} trusted persisted-session suggestionDigest`, problems);
      expectEqual(sessionAuthority.whatWorkedWhitespaceWords, observation.output?.whatWorkedWhitespaceWords,
        `${path} trusted persisted-session whatWorkedWhitespaceWords`, problems);
      expectEqual(sessionAuthority.whatToImproveWhitespaceWords, observation.output?.whatToImproveWhitespaceWords,
        `${path} trusted persisted-session whatToImproveWhitespaceWords`, problems);
      expectEqual(sessionAuthority.readable, observation.output?.readable,
        `${path} trusted persisted-session readable`, problems);
      expectEqual(sessionAuthority.provider, 'google_gemini', `${path} trusted provider`, problems);
      expectEqual(sessionAuthority.model, observation.model, `${path} trusted provider model`, problems);
    }

    // Provider, model, quota and cache-replay facts come from the server-owned receipt joined by the
    // credentialed readback. The contributor packet is compared to those facts; it is never authority
    // for its own claim that a paid request happened (or did not happen).

    if (observation.source === 'fresh') {
      expectEqual(observation.providerRequestMade, true, `${path}.providerRequestMade`, problems);
      if (isObject(sessionAuthority)) {
        expectEqual(sessionAuthority.providerRequestMade, observation.providerRequestMade,
          `${path} trusted providerRequestMade`, problems);
        for (const key of ['scope', 'userDigest', 'utcDate', 'limit', 'requestNumber']) {
          expectEqual(sessionAuthority.quota?.[key], observation.quota?.[key],
            `${path} trusted quota.${key}`, problems);
        }
      }
      if (freshByTake.has(observationKey)) problems.push(`${path} duplicates fresh coaching for ${observationKey}`);
      else freshByTake.set(observationKey, observation);
      const quotaKeys = ['scope', 'userDigest', 'utcDate', 'limit', 'requestNumber'];
      if (exactKeys(observation.quota, quotaKeys, `${path}.quota`, problems)) {
        expectEqual(observation.quota.scope, 'user_utc_day', `${path}.quota.scope`, problems);
        expectEqual(observation.quota.limit, LOCKED_GEMINI_CONTRACT.uncachedRequestsPerUserUtcDay,
          `${path}.quota.limit`, problems);
        if (typeof observation.quota.userDigest !== 'string' || !SHA256.test(observation.quota.userDigest)) {
          problems.push(`${path}.quota.userDigest must be a lowercase SHA-256 digest`);
        }
        if (typeof observation.quota.utcDate !== 'string' || !DATE.test(observation.quota.utcDate)) {
          problems.push(`${path}.quota.utcDate must be YYYY-MM-DD`);
        }
        if (!Number.isInteger(observation.quota.requestNumber)
          || observation.quota.requestNumber < 1
          || observation.quota.requestNumber > LOCKED_GEMINI_CONTRACT.uncachedRequestsPerUserUtcDay) {
          problems.push(`${path}.quota.requestNumber must be between 1 and ${LOCKED_GEMINI_CONTRACT.uncachedRequestsPerUserUtcDay}`);
        }
        const quotaKey = `${observation.quota.userDigest}/${observation.quota.utcDate}/${observation.quota.requestNumber}`;
        if (quotaOrdinals.has(quotaKey)) problems.push(`${path} duplicates uncached quota receipt ${quotaKey}`);
        quotaOrdinals.add(quotaKey);
      }
    } else {
      expectEqual(observation.providerRequestMade, false, `${path}.providerRequestMade`, problems);
      expectEqual(observation.quota, null, `${path}.quota`, problems);
      if (isObject(sessionAuthority)) {
        expectEqual(sessionAuthority.cacheReplayObserved, true, `${path} trusted cache replay`, problems);
      }
      const fresh = freshByTake.get(observationKey);
      if (!fresh) problems.push(`${path} has no preceding fresh observation for ${observationKey}`);
      else if (fresh.output?.suggestionDigest !== observation.output?.suggestionDigest) {
        problems.push(`${path} cached suggestion digest differs from the fresh result`);
      } else if (observation.output?.readable === true) validCacheReplay = true;
    }
  }
  for (const key of requiredTakeKeys) if (!freshByTake.has(key)) problems.push(`geminiEvidence is missing fresh coaching for ${key}`);
  if (!validCacheReplay) problems.push('geminiEvidence must include a readable cache replay with no provider request');
}

function validateSelection(selection, packetDigest, baseDir, approvalResolver, problems) {
  const keys = [
    'status', 'primary', 'fallback', 'sitsOut', 'approvalArtifact', 'approvalSha256',
  ];
  if (!exactKeys(selection, keys, 'selection', problems)) return;
  if (selection.status === 'pending_po_test') {
    for (const key of keys.slice(1)) expectEqual(selection[key], null, `selection.${key}`, problems);
    problems.push('selection is pending the Product Owner real-world CDP test');
    return;
  }
  expectEqual(selection.status, 'selected', 'selection.status', problems);
  const roles = [selection.primary, selection.fallback, selection.sitsOut];
  if (roles.some((candidate) => !CANDIDATE_SET.has(candidate))) {
    problems.push('selection roles must use the three comparison candidates');
  }
  if (new Set(roles).size !== COMPARISON_CANDIDATES.length) {
    problems.push('selection primary, fallback, and sitsOut must be distinct');
  }
  for (const candidate of COMPARISON_CANDIDATES) {
    if (!roles.includes(candidate)) problems.push(`selection omits ${candidate}`);
  }
  const approval = loadVerifiedJson(
    selection.approvalArtifact, selection.approvalSha256, baseDir, 'selection.approvalArtifact', problems,
  );
  if (!approval) return;
  let authoritativeApproval = null;
  if (typeof approvalResolver !== 'function') {
    problems.push('selection approval has no live GitHub authority resolver');
  } else {
    try { authoritativeApproval = approvalResolver(approval.html_url); } catch {
      problems.push('selection approval could not be read back from GitHub');
    }
  }
  if (!isObject(authoritativeApproval)) {
    problems.push('selection approval is not present in live GitHub readback');
  } else {
    const comparisons = [
      ['html_url', approval.html_url, authoritativeApproval.html_url],
      ['author_association', approval.author_association, authoritativeApproval.author_association],
      ['user.login', approval.user?.login, authoritativeApproval.user?.login],
      ['created_at', approval.created_at, authoritativeApproval.created_at],
      ['body', approval.body, authoritativeApproval.body],
    ];
    for (const [field, artifactValue, liveValue] of comparisons) {
      if (artifactValue !== liveValue) problems.push(`selection approval ${field} differs from live GitHub readback`);
    }
  }
  if (approval.author_association !== 'OWNER' || typeof approval.user?.login !== 'string') {
    problems.push('selection approval must be an owner-authored GitHub comment');
  }
  if (typeof approval.html_url !== 'string'
    || !/^https:\/\/github\.com\/relativityE\/speaksharp\/(issues|pull)\/\d+#issuecomment-\d+$/.test(approval.html_url)) {
    problems.push('selection approval must identify a SpeakSharp GitHub comment');
  }
  if (!isIsoInstant(approval.created_at)) problems.push('selection approval created_at must be an ISO instant');
  const body = typeof approval.body === 'string' ? approval.body : '';
  const requiredLines = [
    'SPEAKSHARP_MODEL_DOWNSELECTION_APPROVAL',
    `packet_sha256: ${packetDigest}`,
    `primary: ${selection.primary}`,
    `fallback: ${selection.fallback}`,
    `sits_out: ${selection.sitsOut}`,
  ];
  for (const line of requiredLines) if (!body.split(/\r?\n/).includes(line)) {
    problems.push(`selection approval is missing exact line ${JSON.stringify(line)}`);
  }
}

export function validateModelDownselectionEvidence(value, options = {}) {
  const problems = [];
  const baseDir = resolve(options.baseDir ?? '.');
  const keys = [
    'schemaVersion', 'evidenceDocumentId', 'environment', 'geminiContract', 'telemetryReadback',
    'candidateEvidence', 'geminiEvidence', 'selection',
  ];
  if (!exactKeys(value, keys, 'evidence', problems)) return { verdict: 'HOLD', problems };
  expectEqual(value.schemaVersion, MODEL_DOWNSELECTION_SCHEMA_VERSION, 'evidence.schemaVersion', problems);
  if (typeof value.evidenceDocumentId !== 'string' || !UUID_V4.test(value.evidenceDocumentId)) {
    problems.push('evidence.evidenceDocumentId must be a lowercase UUIDv4');
  }
  validateEnvironment(value.environment, problems);
  validateGeminiContract(value.geminiContract, problems);
  const releaseSha = typeof value.environment?.releaseSha === 'string' ? value.environment.releaseSha : '';
  const events = validateTelemetryReadback(
    value.telemetryReadback, releaseSha, value.evidenceDocumentId, options.telemetryResolver, problems,
  );
  const requiredTakeKeys = validateCandidateEvidence(
    value.candidateEvidence, events, releaseSha, value.evidenceDocumentId, baseDir,
    options.runAuthorityResolver, problems, options.geminiResolver,
  );
  validateGeminiEvidence(value.geminiEvidence, requiredTakeKeys, options.geminiResolver, problems);
  validateSelection(
    value.selection,
    completedEvidenceDigest(value),
    baseDir,
    options.approvalResolver,
    problems,
  );
  return { verdict: problems.length === 0 ? 'PASS' : 'HOLD', problems };
}
