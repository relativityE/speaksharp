/**
 * #1432 / F-17 — executable contract for the Production three-model decision.
 *
 * This module does not choose a model. It accepts a completed, content-free evidence packet only
 * after the PO's real-world CDP test and fails closed when any row cannot be tied to a passing
 * Production observer receipt and decoded PostHog events from the same release/model/attempt.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

export const MODEL_DOWNSELECTION_SCHEMA_VERSION = 'speaksharp.model-downselection.v1';
export const PRODUCTION_ORIGIN = 'https://speaksharp-public.vercel.app';
export const COMPARISON_CANDIDATES = Object.freeze([
  'v2:base.en',
  'v4:distil:q4',
  'moonshine:streaming-medium',
]);
export const REQUIRED_JOURNEYS = Object.freeze(['open_mic', 'focus_points']);

export const LOCKED_GEMINI_CONTRACT = Object.freeze({
  model: 'gemini-3.6-flash',
  uncachedRequestsPerUserUtcDay: 10,
  quotaScope: 'user_utc_day',
  whatWorkedItems: 1,
  whatToImproveItems: 1,
  maxWhitespaceWordsPerPhrase: 6,
  cachedResultsReadable: true,
});

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
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
  value.attemptSeq, value.controlNonce, value.persistedSessionId, value.receiptSha256,
].join('/');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
};

/** Digest of the completed evidence before the PO disposition (avoids a circular approval hash). */
export function completedEvidenceDigest(value) {
  const evidence = {
    schemaVersion: value?.schemaVersion,
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

function validateReceipt(receipt, row, releaseSha, path, problems) {
  if (!isObject(receipt)) {
    problems.push(`${path}.receiptArtifact must contain a JSON object`);
    return;
  }
  expectEqual(receipt.verdict, 'PASS', `${path}.receipt.verdict`, problems);
  expectEqual(receipt.holdKind ?? null, null, `${path}.receipt.holdKind`, problems);
  expectEqual(receipt.dryRun, false, `${path}.receipt.dryRun`, problems);
  expectEqual(receipt.target?.origin ?? receipt.targetOrigin, PRODUCTION_ORIGIN, `${path}.receipt.target.origin`, problems);
  expectEqual(receipt.release ?? receipt.releaseSha, releaseSha, `${path}.receipt.release`, problems);
  for (const key of ['expectedCandidate', 'requestedCandidate', 'observedCandidate']) {
    expectEqual(receipt[key], row.candidateId, `${path}.receipt.${key}`, problems);
  }
  expectEqual(receipt.observedJourney, row.journey, `${path}.receipt.observedJourney`, problems);
  expectEqual(receipt.controlNonce, row.controlNonce, `${path}.receipt.controlNonce`, problems);
  if (!isIsoInstant(receipt.capturedAt)) problems.push(`${path}.receipt.capturedAt must be an ISO instant`);
  expectEqual(receipt.persistedSessionId, row.persistedSessionId, `${path}.receipt.persistedSessionId`, problems);
}

function validateTelemetryReadback(readback, releaseSha, telemetryResolver, problems) {
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
    'wordCount', 'controlNonce', 'transportInitialized',
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
    if (event.controlNonce !== null && (typeof event.controlNonce !== 'string' || !TOKEN.test(event.controlNonce))) {
      problems.push(`${path}.controlNonce is invalid`);
    }
    if (event.transportInitialized !== null && typeof event.transportInitialized !== 'boolean') {
      problems.push(`${path}.transportInitialized is invalid`);
    }
  }

  const controls = readback.events.filter((event) => event?.event === 'telemetry_positive_control');
  if (controls.length !== 1) problems.push('telemetryReadback must contain exactly one telemetry_positive_control event');
  else {
    expectEqual(controls[0].controlNonce, readback.positiveControlNonce,
      'telemetryReadback positive-control nonce', problems);
    expectEqual(controls[0].transportInitialized, true,
      'telemetryReadback positive-control transportInitialized', problems);
  }
  return readback.events;
}

function validateCandidateEvidence(rows, events, releaseSha, baseDir, problems) {
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
  const controlNonces = new Set();

  for (const [index, row] of rows.entries()) {
    const path = `candidateEvidence[${index}]`;
    const keys = [
      'releaseSha', 'candidateId', 'journey', 'journeyId', 'attemptId', 'attemptSeq', 'controlNonce',
      'persistedSessionId',
      'receiptArtifact', 'receiptSha256',
    ];
    if (!exactKeys(row, keys, path, problems)) continue;
    if (!CANDIDATE_SET.has(row.candidateId)) problems.push(`${path}.candidateId is not in the three-model slate`);
    if (!JOURNEY_SET.has(row.journey)) problems.push(`${path}.journey is not required`);
    expectEqual(row.releaseSha, releaseSha, `${path}.releaseSha`, problems);
    const key = takeKey(row.candidateId, row.journey);
    if (seen.has(key)) problems.push(`${path} duplicates ${key}`);
    seen.add(key);
    if (typeof row.journeyId !== 'string' || !TOKEN.test(row.journeyId)) problems.push(`${path}.journeyId is invalid`);
    if (typeof row.attemptId !== 'string' || !TOKEN.test(row.attemptId)) problems.push(`${path}.attemptId is invalid`);
    if (!Number.isInteger(row.attemptSeq) || row.attemptSeq < 1) problems.push(`${path}.attemptSeq must be positive`);
    if (typeof row.controlNonce !== 'string' || !TOKEN.test(row.controlNonce)) {
      problems.push(`${path}.controlNonce is invalid`);
    } else if (controlNonces.has(row.controlNonce)) {
      problems.push(`${path}.controlNonce reuses signed take authority ${row.controlNonce}`);
    } else {
      controlNonces.add(row.controlNonce);
    }
    if (typeof row.persistedSessionId !== 'string' || !TOKEN.test(row.persistedSessionId)) {
      problems.push(`${path}.persistedSessionId is invalid`);
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
    if (receipt) validateReceipt(receipt, row, releaseSha, path, problems);
    const exactKey = exactTakeKey(row);
    if (exactKeysSeen.has(exactKey)) problems.push(`${path} duplicates exact take authority`);
    exactKeysSeen.add(exactKey);

    const linked = events.filter((event) => event?.releaseSha === releaseSha
      && event?.candidateId === row.candidateId
      && event?.journeyId === row.journeyId
      && event?.attemptId === row.attemptId
      && event?.attemptSeq === row.attemptSeq
      && event?.controlNonce === row.controlNonce);
    const starts = linked.filter((event) => event.event === 'session_started');
    const saves = linked.filter((event) => event.event === 'session_saved');
    if (starts.length !== 1) problems.push(`${path} must link exactly one decoded session_started event`);
    if (saves.length !== 1) problems.push(`${path} must link exactly one decoded session_saved event`);
    else if (!Number.isInteger(saves[0].wordCount) || saves[0].wordCount < 1) {
      problems.push(`${path} session_saved must prove a non-empty decoded transcript`);
    }
    // Product identity is independently decoded from the journey telemetry. It is not trusted from
    // the operator label, and it need not carry the attempt id because Focus Points setup precedes Start.
    const expectedMode = row.journey === 'focus_points' ? 'objective' : 'quick';
    const journeyEvents = events.filter((event) => event?.releaseSha === releaseSha
      && event?.journeyId === row.journeyId && event?.productMode !== null);
    if (!journeyEvents.some((event) => event.productMode === expectedMode)) {
      problems.push(`${path} must link decoded ${expectedMode} journey telemetry`);
    }
    if (journeyEvents.some((event) => event.productMode !== expectedMode)) {
      problems.push(`${path} has contradictory decoded journey telemetry`);
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
      'releaseSha', 'candidateId', 'journey', 'journeyId', 'attemptId', 'attemptSeq', 'controlNonce',
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
      expectEqual(sessionAuthority.suggestionDigest, observation.output?.suggestionDigest,
        `${path} trusted persisted-session suggestionDigest`, problems);
      expectEqual(sessionAuthority.whatWorkedWhitespaceWords, observation.output?.whatWorkedWhitespaceWords,
        `${path} trusted persisted-session whatWorkedWhitespaceWords`, problems);
      expectEqual(sessionAuthority.whatToImproveWhitespaceWords, observation.output?.whatToImproveWhitespaceWords,
        `${path} trusted persisted-session whatToImproveWhitespaceWords`, problems);
      expectEqual(sessionAuthority.readable, observation.output?.readable,
        `${path} trusted persisted-session readable`, problems);
    }

    // The trusted session readback proves that the exact coaching payload reached persistence.
    // Provider/model/quota authority is deliberately owned by #1424/#1434 rather than copied into
    // this credentialed database reader; this validator still enforces their packet contract below.

    if (observation.source === 'fresh') {
      expectEqual(observation.providerRequestMade, true, `${path}.providerRequestMade`, problems);
      if (freshByTake.has(observationKey)) problems.push(`${path} duplicates fresh coaching for ${observationKey}`);
      else freshByTake.set(observationKey, observation);
      const quotaKeys = ['scope', 'userDigest', 'utcDate', 'limit', 'requestNumber'];
      if (exactKeys(observation.quota, quotaKeys, `${path}.quota`, problems)) {
        expectEqual(observation.quota.scope, 'user_utc_day', `${path}.quota.scope`, problems);
        expectEqual(observation.quota.limit, 10, `${path}.quota.limit`, problems);
        if (typeof observation.quota.userDigest !== 'string' || !SHA256.test(observation.quota.userDigest)) {
          problems.push(`${path}.quota.userDigest must be a lowercase SHA-256 digest`);
        }
        if (typeof observation.quota.utcDate !== 'string' || !DATE.test(observation.quota.utcDate)) {
          problems.push(`${path}.quota.utcDate must be YYYY-MM-DD`);
        }
        if (!Number.isInteger(observation.quota.requestNumber)
          || observation.quota.requestNumber < 1 || observation.quota.requestNumber > 10) {
          problems.push(`${path}.quota.requestNumber must be between 1 and 10`);
        }
        const quotaKey = `${observation.quota.userDigest}/${observation.quota.utcDate}/${observation.quota.requestNumber}`;
        if (quotaOrdinals.has(quotaKey)) problems.push(`${path} duplicates uncached quota receipt ${quotaKey}`);
        quotaOrdinals.add(quotaKey);
      }
    } else {
      expectEqual(observation.providerRequestMade, false, `${path}.providerRequestMade`, problems);
      expectEqual(observation.quota, null, `${path}.quota`, problems);
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
    'schemaVersion', 'environment', 'geminiContract', 'telemetryReadback',
    'candidateEvidence', 'geminiEvidence', 'selection',
  ];
  if (!exactKeys(value, keys, 'evidence', problems)) return { verdict: 'HOLD', problems };
  expectEqual(value.schemaVersion, MODEL_DOWNSELECTION_SCHEMA_VERSION, 'evidence.schemaVersion', problems);
  validateEnvironment(value.environment, problems);
  validateGeminiContract(value.geminiContract, problems);
  const releaseSha = typeof value.environment?.releaseSha === 'string' ? value.environment.releaseSha : '';
  const events = validateTelemetryReadback(value.telemetryReadback, releaseSha, options.telemetryResolver, problems);
  const requiredTakeKeys = validateCandidateEvidence(value.candidateEvidence, events, releaseSha, baseDir, problems);
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
