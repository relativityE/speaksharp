import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  COMPARISON_CANDIDATES, LOCKED_GEMINI_CONTRACT, MODEL_DOWNSELECTION_SCHEMA_VERSION,
  PRODUCTION_ORIGIN, REQUIRED_JOURNEYS, completedEvidenceDigest,
  modelComparisonSessionBindingSha256,
  validateModelDownselectionEvidence,
} from '../../scripts/human-test/modelDownselectionEvidence.mjs';
import { mintRunAuthorization } from '../../scripts/human-test/modelComparisonRunAuthority.mjs';

const RELEASE = 'a'.repeat(40);
const HASH = (character) => character.repeat(64);
const ISO = '2026-09-07T12:00:00.000Z';
const EVIDENCE_DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_DIR = mkdtempSync(join(tmpdir(), 'speaksharp-model-evidence-'));
const LIVE_APPROVALS = new Map();
const LIVE_TELEMETRY = new Map();
let LIVE_GEMINI = [];
// #1432 PM decisions 5651830241 / 5651842972 — each take's authority is one owner-dispatched rc-gates.yml
// comparison-authorization attempt at the exact release. LIVE_RUNS is what GitHub returns for that attempt
// (repository, the attempt, its jobs, its artifact); the validator re-reads it.
const OWNER = 'relativityE';
const ISSUED_AT = Date.parse('2026-09-07T11:59:30.000Z');
const LIVE_RUNS = new Map();
const runIdFor = (ordinal) => 700000 + ordinal;
const nonceFor = (ordinal) => `run-${runIdFor(ordinal)}-1-${String(ordinal).padStart(24, '0')}`;
/** What the trusted observer records after verifying one take's run against GitHub; registers that readback. */
const observerAuthorization = ({ candidateId, journey, ordinal, releaseSha = RELEASE, runId = runIdFor(ordinal), runAttempt = 1 }) => {
  const ref = 'refs/heads/evidence/production-model-downselection';
  const artifact = mintRunAuthorization({
    repository: 'relativityE/speaksharp', ref, workflowRef: `relativityE/speaksharp/.github/workflows/rc-gates.yml@${ref}`,
    workflowSha: releaseSha, sha: releaseSha, owner: OWNER, actor: OWNER, triggeringActor: OWNER, runId, runAttempt,
    releaseSha, cell: `${candidateId}/${journey}`, evidenceDocumentId: EVIDENCE_DOCUMENT_ID,
    randomHex: String(ordinal).padStart(24, '0'), now: ISSUED_AT,
  });
  LIVE_RUNS.set(`${artifact.runId}/${runAttempt}`, {
    artifact: structuredClone(artifact),
    repo: { full_name: 'relativityE/speaksharp', default_branch: 'main', owner: { login: OWNER } },
    run: {
      id: artifact.runId, run_attempt: runAttempt, repository: { full_name: 'relativityE/speaksharp' },
      path: '.github/workflows/rc-gates.yml', event: 'workflow_dispatch', head_branch: 'evidence/production-model-downselection',
      head_sha: releaseSha, status: 'completed', conclusion: 'success',
      actor: { login: OWNER }, triggering_actor: { login: OWNER },
      run_started_at: new Date(ISSUED_AT - 10_000).toISOString(), updated_at: new Date(ISSUED_AT + 20_000).toISOString(),
    },
    jobs: [
      { name: 'Gate 3 - DAST / Running App', status: 'completed', conclusion: 'skipped' },
      { name: 'Model Comparison Authorization', status: 'completed', conclusion: 'success' },
    ],
  });
  return { ...artifact, verifiedAt: new Date(ISSUED_AT + 5_000).toISOString() };
};
const runAuthorityResolver = (runId, runAttempt) => structuredClone(LIVE_RUNS.get(`${runId}/${runAttempt}`) ?? null);

afterAll(() => rmSync(ARTIFACT_DIR, { recursive: true, force: true }));

const writeArtifact = (name, value) => {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(join(ARTIFACT_DIR, name), bytes);
  return { path: name, digest: createHash('sha256').update(bytes).digest('hex') };
};

/** Coverage fields are null on every event except the coverage event that defines them. */
const NO_COVERAGE = Object.freeze({
  evaluatorVersion: null, pointsSupplied: null, pointsEvaluated: null, coveredThreshold: null, partialThreshold: null,
  pointPosition: null, verdict: null, matchRatio: null, keywordCount: null, latched: null, step: null, pointsEntered: null,
});
const EVALUATOR = { evaluatorVersion: 'keyword-ratio-v1', coveredThreshold: 0.7, partialThreshold: 0.4 };
const FINAL_POINTS = [
  { position: 0, verdict: 'covered', matchRatio: 0.9, keywordCount: 3, latched: false },
  { position: 1, verdict: 'partial', matchRatio: 0.5, keywordCount: 2, latched: true },
  { position: 2, verdict: 'missing', matchRatio: 0, keywordCount: 4, latched: false },
];
/** PM RETURN `5655220799` — the stop seam's durable binary record: `covered|partial` persist as `detected`. */
const PREDICATE = 'literal-cue-v1';
const FINALIZED = [
  { position: 0, verdict: 'detected' },
  { position: 1, verdict: 'detected' },
  { position: 2, verdict: 'not_detected' },
];
const finalizedRecord = (points = FINALIZED) => ({
  sessions: [{ points: points.map(({ position, verdict }) => ({ sortOrder: position, verdict, predicateVersion: PREDICATE })) }],
});

let fixtureSequence = 0;
function validEvidence() {
  fixtureSequence += 1;
  const suffix = fixtureSequence;
  const candidateEvidence = [];
  // The document control is emitted under the envelope's own native identity and carries no take nonce.
  const events = [{
    ...NO_COVERAGE,
    uuid: 'event-positive-control', event: 'telemetry_positive_control', releaseSha: RELEASE,
    candidateId: null, productMode: null, journeyId: 'native-journey-signin',
    attemptId: null, attemptSeq: 0,
    wordCount: null, comparisonNonce: null, controlNonce: EVIDENCE_DOCUMENT_ID, transportInitialized: true,
    evidenceDocumentId: EVIDENCE_DOCUMENT_ID, sessionBindingSha256: null,
  }];
  const geminiEvidence = [];
  let ordinal = 0;

  for (const candidateId of COMPARISON_CANDIDATES) {
    for (const journey of REQUIRED_JOURNEYS) {
      ordinal += 1;
      // POSITIVE CONTROL for PM Option A: the first two takes share ONE native journey (distinct attempts),
      // exactly as a single product visit would. Nonce binding must keep them apart.
      const journeyId = ordinal <= 2 ? 'native-journey-shared' : `native-journey-${ordinal}`;
      const attemptId = `attempt-${ordinal}`;
      const attemptSeq = ordinal <= 2 ? ordinal : 1;
      const persistedSessionId = `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
      const comparisonNonce = nonceFor(ordinal);
      // RWT-01 — a disconnected pre-take control receipt; the saved session is bound by telemetry, not by this receipt.
      const receipt = writeArtifact(`receipt-${suffix}-${ordinal}.json`, {
        evidenceKind: 'pre_take_control', verdict: 'PASS', holdKind: null, problems: [], dryRun: false,
        target: { origin: PRODUCTION_ORIGIN }, release: RELEASE,
        expectedCandidate: candidateId, requestedCandidate: candidateId, observedCandidate: candidateId,
        journey, comparisonNonce,
        evidenceDocumentId: EVIDENCE_DOCUMENT_ID, positiveControlNonce: EVIDENCE_DOCUMENT_ID,
        capturedAt: ISO,
        authorization: observerAuthorization({ candidateId, journey, ordinal }),
        control: {
          methodsUsed: ['Page.enable', 'Page.addScriptToEvaluateOnNewDocument', 'Page.navigate', 'Page.removeScriptToEvaluateOnNewDocument', 'Runtime.evaluate'],
          armScriptsInstalled: 1, armScriptRemoved: true, tripwireInstalled: false, workerAttachment: false,
          networkObservation: false, disconnectedBeforeTake: true, disconnectedAt: ISO,
          exclusiveBeforeArm: true, noAttachmentAfterDisconnect: true,
        },
      });
      const objective = journey === 'focus_points';
      candidateEvidence.push({
        releaseSha: RELEASE, candidateId, journey, journeyId, attemptId, attemptSeq,
        comparisonNonce, persistedSessionId,
        receiptArtifact: receipt.path, receiptSha256: receipt.digest,
        ...(objective ? {
          focusCoverage: { ...EVALUATOR, pointsEntered: 3, pointsSupplied: 3, pointsEvaluated: 3, predicateVersion: PREDICATE, points: structuredClone(FINALIZED) },
        } : {}),
      });
      events.push({
        ...NO_COVERAGE,
        uuid: `mode-${ordinal}`, event: 'practice_mode_selected', releaseSha: RELEASE,
        // Mode selection may precede engine attribution; take 1 proves a null candidate is not contradiction.
        candidateId: ordinal === 1 ? null : candidateId,
        productMode: journey === 'focus_points' ? 'objective' : 'quick', journeyId,
        attemptId: null, attemptSeq: 0, wordCount: null, comparisonNonce, controlNonce: null,
        transportInitialized: null, evidenceDocumentId: EVIDENCE_DOCUMENT_ID, sessionBindingSha256: null,
      });
      if (objective) {
        // Entry happens before Start: the native journey, no attempt and no nonce.
        events.push({
          ...NO_COVERAGE, uuid: `setup-${ordinal}`, event: 'journey_step', releaseSha: RELEASE, candidateId: null,
          productMode: null, journeyId, attemptId: null, attemptSeq: 0, wordCount: null, comparisonNonce: null,
          controlNonce: null, transportInitialized: null, evidenceDocumentId: null, sessionBindingSha256: null,
          step: 'setup_submitted', pointsEntered: 3,
        });
      }
      for (const event of ['session_started', 'session_saved']) {
        events.push({
          ...NO_COVERAGE,
          uuid: `${event}-${ordinal}`, event, releaseSha: RELEASE, candidateId, productMode: null, journeyId,
          attemptId, attemptSeq, wordCount: event === 'session_saved' ? 42 : null,
          comparisonNonce, controlNonce: null, transportInitialized: null, evidenceDocumentId: EVIDENCE_DOCUMENT_ID,
          sessionBindingSha256: event === 'session_saved'
            ? modelComparisonSessionBindingSha256(comparisonNonce, persistedSessionId) : null,
        });
      }
      if (objective) {
        // The governed envelope only: no nonce, no document id. CONTROL — an earlier settled emission at position 0
        // said `missing`; the later emission supersedes it rather than adding a point.
        const coverageEvent = (uuid, event, fields) => ({
          ...NO_COVERAGE, uuid, event, releaseSha: RELEASE, candidateId, productMode: null, journeyId, attemptId,
          attemptSeq, wordCount: null, comparisonNonce: null, controlNonce: null, transportInitialized: null,
          evidenceDocumentId: null, sessionBindingSha256: null, evaluatorVersion: EVALUATOR.evaluatorVersion, ...fields,
        });
        const evaluation = { pointsSupplied: 3, pointsEvaluated: 3, coveredThreshold: EVALUATOR.coveredThreshold, partialThreshold: EVALUATOR.partialThreshold };
        const pointFields = ({ position, ...rest }) => ({ pointPosition: position, ...rest });
        events.push(
          coverageEvent(`coverage-evaluation-${ordinal}-superseded`, 'coverage_evaluation', evaluation),
          coverageEvent(`coverage-point-${ordinal}-0-superseded`, 'coverage_point', pointFields({ ...FINAL_POINTS[0], verdict: 'missing', matchRatio: 0.2 })),
          coverageEvent(`coverage-evaluation-${ordinal}`, 'coverage_evaluation', evaluation),
          ...FINAL_POINTS.map((point) => coverageEvent(`coverage-point-${ordinal}-${point.position}`, 'coverage_point', pointFields(point))),
        );
      }
      geminiEvidence.push({
        releaseSha: RELEASE, candidateId, journey, journeyId, attemptId, attemptSeq,
        comparisonNonce, persistedSessionId, receiptSha256: receipt.digest,
        source: 'fresh', model: LOCKED_GEMINI_CONTRACT.model, providerRequestMade: true,
        quota: {
          scope: 'user_utc_day', userDigest: HASH('b'), utcDate: '2026-09-07',
          limit: LOCKED_GEMINI_CONTRACT.uncachedRequestsPerUserUtcDay, requestNumber: ordinal,
        },
        output: {
          whatWorkedItems: 1, whatToImproveItems: 1, whatWorkedWhitespaceWords: 5,
          whatToImproveWhitespaceWords: 6, readable: true,
          suggestionDigest: ordinal.toString(16).padStart(64, 'f'),
        },
      });
    }
  }
  geminiEvidence.push({ ...structuredClone(geminiEvidence[0]), source: 'cached', providerRequestMade: false, quota: null });

  const evidence = {
    schemaVersion: MODEL_DOWNSELECTION_SCHEMA_VERSION,
    evidenceDocumentId: EVIDENCE_DOCUMENT_ID,
    environment: { origin: PRODUCTION_ORIGIN, releaseSha: RELEASE },
    geminiContract: { ...LOCKED_GEMINI_CONTRACT },
    telemetryReadback: {
      source: 'posthog_decoded_readback', queryId: `posthog-query-${suffix}`, decodedAt: ISO,
      positiveControlNonce: EVIDENCE_DOCUMENT_ID, events,
    },
    candidateEvidence, geminiEvidence,
    selection: {
      status: 'selected', primary: COMPARISON_CANDIDATES[0], fallback: COMPARISON_CANDIDATES[1],
      sitsOut: COMPARISON_CANDIDATES[2], approvalArtifact: null, approvalSha256: null,
    },
  };
  LIVE_TELEMETRY.set(evidence.telemetryReadback.queryId, structuredClone(evidence.telemetryReadback));
  LIVE_GEMINI = evidence.candidateEvidence.map((row, index) => ({
    persistedSessionId: row.persistedSessionId,
    suggestionDigest: evidence.geminiEvidence[index].output.suggestionDigest,
    whatWorkedWhitespaceWords: evidence.geminiEvidence[index].output.whatWorkedWhitespaceWords,
    whatToImproveWhitespaceWords: evidence.geminiEvidence[index].output.whatToImproveWhitespaceWords,
    readable: evidence.geminiEvidence[index].output.readable,
    provider: 'google_gemini',
    model: evidence.geminiEvidence[index].model,
    providerRequestMade: true,
    quota: structuredClone(evidence.geminiEvidence[index].quota),
    cacheReplayObserved: index === 0,
    immutableSuggestionSha256: HASH('9'),
    immutableDigestVerified: true,
    // The collector attaches the finalized stop-seam record to the Focus Points session it is keyed by.
    finalizedCoverage: row.journey === 'focus_points' ? finalizedRecord() : null,
  }));
  const approvalValue = {
    html_url: 'https://github.com/relativityE/speaksharp/issues/1399#issuecomment-123456789',
    author_association: 'OWNER', user: { login: 'relativityE' }, created_at: ISO,
    body: [
      'SPEAKSHARP_MODEL_DOWNSELECTION_APPROVAL',
      `packet_sha256: ${completedEvidenceDigest(evidence)}`,
      `primary: ${evidence.selection.primary}`,
      `fallback: ${evidence.selection.fallback}`,
      `sits_out: ${evidence.selection.sitsOut}`,
    ].join('\n'),
  };
  LIVE_APPROVALS.set(approvalValue.html_url, structuredClone(approvalValue));
  const approval = writeArtifact(`approval-${suffix}.json`, approvalValue);
  evidence.selection.approvalArtifact = approval.path;
  evidence.selection.approvalSha256 = approval.digest;
  return evidence;
}

/** Make a mutated readback the authenticated authority, so only the discriminating rule can fail. */
const authorize = (value) => {
  LIVE_TELEMETRY.set(value.telemetryReadback.queryId, structuredClone(value.telemetryReadback));
  return value;
};
const eventByUuid = (value, uuid) => value.telemetryReadback.events.find((event) => event.uuid === uuid);

/** Rewrite one row's observer receipt through `mutate`, re-hashing it so only the rule under test fails. */
const rewriteReceipt = (value, rowIndex, name, mutate) => {
  const row = value.candidateEvidence[rowIndex];
  const priorDigest = row.receiptSha256;
  const receipt = JSON.parse(readFileSync(join(ARTIFACT_DIR, row.receiptArtifact), 'utf8'));
  mutate(receipt);
  const rewritten = writeArtifact(`${name}-${fixtureSequence}.json`, receipt);
  row.receiptArtifact = rewritten.path;
  row.receiptSha256 = rewritten.digest;
  for (const observation of value.geminiEvidence) {
    if (observation.receiptSha256 === priorDigest) observation.receiptSha256 = rewritten.digest;
  }
  return value;
};

const holdProblems = (value) => {
  const result = validateModelDownselectionEvidence(value, {
    baseDir: ARTIFACT_DIR,
    runAuthorityResolver,
    approvalResolver: (url) => structuredClone(LIVE_APPROVALS.get(url) ?? null),
    telemetryResolver: (queryId) => structuredClone(LIVE_TELEMETRY.get(queryId) ?? null),
    geminiResolver: () => structuredClone(LIVE_GEMINI),
  });
  expect(result.verdict).toBe('HOLD');
  return result.problems.join('\n');
};

describe('#1432 F-17 model-downselection evidence contract', () => {
  it('accepts a complete synthetic contract fixture without selecting a model in production', () => {
    expect(validateModelDownselectionEvidence(validEvidence(), {
      baseDir: ARTIFACT_DIR,
      runAuthorityResolver,
      approvalResolver: (url) => structuredClone(LIVE_APPROVALS.get(url) ?? null),
      telemetryResolver: (queryId) => structuredClone(LIVE_TELEMETRY.get(queryId) ?? null),
      geminiResolver: () => structuredClone(LIVE_GEMINI),
    }))
      .toEqual({ verdict: 'PASS', problems: [] });
  });

  it('keeps the committed template empty and held for the PO test', () => {
    const template = JSON.parse(readFileSync('product_release/evidence/human-test/model-downselection.template.json', 'utf8'));
    const problems = holdProblems(template);
    expect(template.selection).toEqual({
      status: 'pending_po_test', primary: null, fallback: null, sitsOut: null,
      approvalArtifact: null, approvalSha256: null,
    });
    expect(problems).toMatch(/pending the Product Owner real-world CDP test/);
    expect(problems).toMatch(/candidateEvidence is missing v2:base\.en\/open_mic/);
  });

  it('pins the JSON schema to the same slate and Gemini contract', () => {
    const schema = JSON.parse(readFileSync('product_release/evidence/human-test/model-downselection.schema.json', 'utf8'));
    expect(schema.properties.schemaVersion.const).toBe(MODEL_DOWNSELECTION_SCHEMA_VERSION);
    expect(schema.$defs.candidate.enum).toEqual(COMPARISON_CANDIDATES);
    expect(schema.properties.geminiContract.properties).toMatchObject({
      model: { const: LOCKED_GEMINI_CONTRACT.model },
      uncachedRequestsPerUserUtcDay: { const: LOCKED_GEMINI_CONTRACT.uncachedRequestsPerUserUtcDay },
      whatWorkedItems: { const: 1 }, whatToImproveItems: { const: 1 },
      maxWhitespaceWordsPerPhrase: { const: 6 }, cachedResultsReadable: { const: true },
    });
  });

  it('loads and hashes the actual observer receipt instead of trusting typed hex', () => {
    const arbitrary = validEvidence(); arbitrary.candidateEvidence[0].receiptSha256 = HASH('a');
    expect(holdProblems(arbitrary)).toMatch(/digest does not match the referenced artifact/);
    const missing = validEvidence(); missing.candidateEvidence[0].receiptArtifact = 'missing.json';
    expect(holdProblems(missing)).toMatch(/could not be read/);
  });

  it('fails closed on missing, duplicate, or reused candidate evidence', () => {
    const missing = validEvidence(); missing.candidateEvidence.pop();
    expect(holdProblems(missing)).toMatch(/candidateEvidence is missing moonshine:streaming-medium\/focus_points/);
    const duplicate = validEvidence(); duplicate.candidateEvidence[5] = structuredClone(duplicate.candidateEvidence[0]);
    expect(holdProblems(duplicate)).toMatch(/duplicates v2:base\.en\/open_mic/);
    const reused = validEvidence(); reused.candidateEvidence[1].receiptSha256 = reused.candidateEvidence[0].receiptSha256;
    expect(holdProblems(reused)).toMatch(/reuses observer receipt/);
  });

  it('binds the declared journey to decoded telemetry and the persisted session to observer/Gemini evidence', () => {
    const relabeled = validEvidence(); relabeled.candidateEvidence[0].journey = 'focus_points';
    expect(holdProblems(relabeled)).toMatch(/receipt\.journey must be "focus_points"/);
    expect(holdProblems(relabeled)).toMatch(/must link decoded objective journey telemetry/);
    const wrongSession = validEvidence();
    wrongSession.candidateEvidence[0].persistedSessionId = '99999999-9999-4999-8999-999999999999';
    // RWT-01: the control receipt no longer carries the session; the binding HOLD now comes from the telemetry readback.
    expect(holdProblems(wrongSession)).toMatch(/persistedSessionId|persisted session|persisted-session binding/);
  });

  it('never requires the persisted database session id in PostHog', () => {
    const evidence = validEvidence();
    expect(evidence.telemetryReadback.events.every((event) => !Object.hasOwn(event, 'persistedSessionId'))).toBe(true);
    evidence.telemetryReadback.events[1].persistedSessionId = 'must-not-enter-analytics';
    expect(holdProblems(evidence)).toMatch(/persistedSessionId is not allowed/);
  });

  it('joins each observer receipt to lifecycle telemetry through its signed comparison nonce', () => {
    const evidence = validEvidence();
    evidence.telemetryReadback.events.find(
      (event) => event.event === 'session_saved' && event.attemptId === 'attempt-1',
    ).comparisonNonce = 'another-signed-run';
    expect(holdProblems(evidence)).toMatch(/must link exactly one decoded session_saved/);
  });

  it('CASUALTY: binds the trusted session_saved event to the exact persisted session without emitting its id', () => {
    const evidence = validEvidence();
    const save = evidence.telemetryReadback.events.find(
      (event) => event.event === 'session_saved' && event.attemptId === 'attempt-1',
    );
    save.sessionBindingSha256 = HASH('e');
    LIVE_TELEMETRY.set(evidence.telemetryReadback.queryId, structuredClone(evidence.telemetryReadback));
    expect(holdProblems(evidence)).toMatch(/persisted-session binding/);
  });

  it('CASUALTY: a signed row cannot be moved into a second evidence document', () => {
    const evidence = validEvidence();
    const replacementDocumentId = '33333333-3333-4333-8333-333333333333';
    evidence.evidenceDocumentId = replacementDocumentId;
    // Contributor-authored receipt files can be rewritten, so remove them as an alternate failure
    // reason. The authenticated PostHog value must be the authority that prevents document replay.
    for (const row of evidence.candidateEvidence) {
      const priorDigest = row.receiptSha256;
      const receipt = JSON.parse(readFileSync(join(ARTIFACT_DIR, row.receiptArtifact), 'utf8'));
      receipt.evidenceDocumentId = replacementDocumentId;
      const rewritten = writeArtifact(`replayed-${row.attemptId}.json`, receipt);
      row.receiptArtifact = rewritten.path;
      row.receiptSha256 = rewritten.digest;
      for (const observation of evidence.geminiEvidence) {
        if (observation.receiptSha256 === priorDigest) observation.receiptSha256 = rewritten.digest;
      }
    }
    // Take linkage is by nonce, so the rows still find their events; the authenticated document id on
    // every one of those events is what refuses the replay.
    expect(holdProblems(evidence)).toMatch(/linked session_saved session_saved-1 evidenceDocumentId must be "33333333/);
    expect(holdProblems(evidence)).toMatch(/positive-control nonce must be "33333333/);
  });

  it('requires decoded PostHog linkage, a positive control, and unique event receipts', () => {
    const source = validEvidence(); source.telemetryReadback.source = 'client_claim';
    expect(holdProblems(source)).toMatch(/source must be "posthog_decoded_readback"/);
    const unlinked = validEvidence();
    unlinked.telemetryReadback.events = unlinked.telemetryReadback.events.filter(
      (event) => !(event.event === 'session_saved' && event.attemptId === 'attempt-1'),
    );
    expect(holdProblems(unlinked)).toMatch(/must link exactly one decoded session_saved/);
    const empty = validEvidence();
    empty.telemetryReadback.events.find((event) => event.event === 'session_saved' && event.attemptId === 'attempt-1').wordCount = 0;
    expect(holdProblems(empty)).toMatch(/non-empty decoded transcript/);
    const noControl = validEvidence(); noControl.telemetryReadback.events.shift();
    expect(holdProblems(noControl)).toMatch(/exactly one telemetry_positive_control/);
  });

  it('CASUALTY: the positive control belongs to this evidence document, not another comparison', () => {
    const evidence = validEvidence();
    const staleDocumentId = '33333333-3333-4333-8333-333333333333';
    evidence.telemetryReadback.positiveControlNonce = staleDocumentId;
    const control = evidence.telemetryReadback.events.find(
      (event) => event.event === 'telemetry_positive_control',
    );
    control.controlNonce = staleDocumentId;
    control.evidenceDocumentId = staleDocumentId;
    LIVE_TELEMETRY.set(evidence.telemetryReadback.queryId, structuredClone(evidence.telemetryReadback));

    expect(holdProblems(evidence)).toMatch(
      /positiveControlNonce must equal evidence\.evidenceDocumentId/,
    );
  });

  it('CASUALTY: rejects contributor-authored PostHog rows that differ from authenticated readback', () => {
    const evidence = validEvidence();
    evidence.telemetryReadback.events.find((event) => event.event === 'session_saved').wordCount = 999;
    expect(holdProblems(evidence)).toMatch(/differs from authenticated PostHog authority/);
  });

  it('CASUALTY: rejects one signed comparison nonce reused for a second test row', () => {
    const evidence = validEvidence();
    evidence.candidateEvidence[1].comparisonNonce = evidence.candidateEvidence[0].comparisonNonce;
    expect(holdProblems(evidence)).toMatch(/reuses signed take authority/);
  });

  it('binds every Gemini observation to the exact verified take', () => {
    const stale = validEvidence(); stale.geminiEvidence[0].attemptId = 'old-attempt';
    expect(holdProblems(stale)).toMatch(/does not match a verified exact take/);
    const wrongReceipt = validEvidence(); wrongReceipt.geminiEvidence[0].receiptSha256 = HASH('d');
    expect(holdProblems(wrongReceipt)).toMatch(/does not match a verified exact take/);
  });

  it('enforces the locked Gemini quota, output shape, and cache replay', () => {
    const tooMany = validEvidence();
    const cap = LOCKED_GEMINI_CONTRACT.uncachedRequestsPerUserUtcDay;
    tooMany.geminiEvidence[0].quota.requestNumber = cap + 1;
    tooMany.geminiEvidence[0].output.whatToImproveWhitespaceWords = 7;
    expect(holdProblems(tooMany)).toMatch(new RegExp(`requestNumber must be between 1 and ${cap}\\b`));
    const noCache = validEvidence(); noCache.geminiEvidence.pop();
    expect(holdProblems(noCache)).toMatch(/readable cache replay/);
  });

  it('CASUALTY: rejects contributor-authored Gemini rows that lack trusted session-bound readback', () => {
    const evidence = validEvidence();
    evidence.geminiEvidence[0].providerRequestMade = false;
    expect(holdProblems(evidence)).toMatch(/providerRequestMade|trusted persisted-session/);

    const forgedDigest = validEvidence();
    forgedDigest.geminiEvidence[0].output.suggestionDigest = HASH('e');
    expect(holdProblems(forgedDigest)).toMatch(/trusted persisted-session suggestionDigest/);

    const forgedModel = validEvidence();
    forgedModel.geminiEvidence[0].model = 'gemini-forged';
    expect(holdProblems(forgedModel)).toMatch(/trusted provider model/);

    const forgedQuota = validEvidence();
    forgedQuota.geminiEvidence[0].quota.requestNumber = 9;
    expect(holdProblems(forgedQuota)).toMatch(/trusted quota.requestNumber/);

    const unobservedCache = validEvidence();
    LIVE_GEMINI[0].cacheReplayObserved = false;
    expect(holdProblems(unobservedCache)).toMatch(/trusted cache replay/);

    // Codex P1 3984161768 — an authority row that was not produced by the immutable-digest check fails.
    const unbound = validEvidence();
    LIVE_GEMINI[2].immutableDigestVerified = false;
    expect(holdProblems(unbound)).toMatch(/geminiEvidence\[2\] trusted persisted-session coaching is not bound to an immutable receipt digest/);
    const undigested = validEvidence();
    delete LIVE_GEMINI[3].immutableSuggestionSha256;
    expect(holdProblems(undigested)).toMatch(/geminiEvidence\[3\] trusted persisted-session coaching is not bound/);
  });

  it('fails closed when either independent authority resolver is absent', () => {
    const evidence = validEvidence();
    const result = validateModelDownselectionEvidence(evidence, {
      baseDir: ARTIFACT_DIR,
      runAuthorityResolver,
      approvalResolver: (url) => structuredClone(LIVE_APPROVALS.get(url) ?? null),
    });
    expect(result.verdict).toBe('HOLD');
    expect(result.problems.join('\n')).toMatch(/no independent PostHog authority resolver/);
    expect(result.problems.join('\n')).toMatch(/no trusted persisted-session authority resolver/);
  });

  it('requires a separately loaded owner-authored approval bound to the packet digest', () => {
    const pending = validEvidence();
    pending.selection = {
      status: 'pending_po_test', primary: null, fallback: null, sitsOut: null,
      approvalArtifact: null, approvalSha256: null,
    };
    expect(holdProblems(pending)).toMatch(/pending the Product Owner real-world CDP test/);

    const contributor = validEvidence();
    const approval = JSON.parse(readFileSync(join(ARTIFACT_DIR, contributor.selection.approvalArtifact), 'utf8'));
    approval.author_association = 'CONTRIBUTOR';
    const rewritten = writeArtifact('contributor-approval.json', approval);
    contributor.selection.approvalArtifact = rewritten.path;
    contributor.selection.approvalSha256 = rewritten.digest;
    expect(holdProblems(contributor)).toMatch(/owner-authored GitHub comment/);

    const changedPacket = validEvidence(); changedPacket.telemetryReadback.queryId = 'different-query';
    expect(holdProblems(changedPacket)).toMatch(/packet_sha256/);

    const noLiveAuthority = validEvidence();
    const result = validateModelDownselectionEvidence(noLiveAuthority, {
      baseDir: ARTIFACT_DIR,
      runAuthorityResolver,
      approvalResolver: () => null,
      telemetryResolver: (queryId) => structuredClone(LIVE_TELEMETRY.get(queryId) ?? null),
      geminiResolver: () => structuredClone(LIVE_GEMINI),
    });
    expect(result.verdict).toBe('HOLD');
    expect(result.problems.join('\n')).toMatch(/not present in live GitHub readback/);

    const forgedArtifact = validEvidence();
    const forged = JSON.parse(readFileSync(join(ARTIFACT_DIR, forgedArtifact.selection.approvalArtifact), 'utf8'));
    forged.body = `${forged.body}\ncontributor-added-line`;
    const forgedRef = writeArtifact('forged-owner-approval.json', forged);
    forgedArtifact.selection.approvalArtifact = forgedRef.path;
    forgedArtifact.selection.approvalSha256 = forgedRef.digest;
    expect(holdProblems(forgedArtifact)).toMatch(/body differs from live GitHub readback/);
  });

  describe('#1432 PM Option A — take nonce and native envelope identity are separate authorities', () => {
    it('CONTROL: the valid packet already places two takes inside one native journey', () => {
      const evidence = validEvidence();
      expect(evidence.candidateEvidence[0].journeyId).toBe(evidence.candidateEvidence[1].journeyId);
      expect(evidence.candidateEvidence[0].attemptId).not.toBe(evidence.candidateEvidence[1].attemptId);
      expect(validateModelDownselectionEvidence(evidence, {
        baseDir: ARTIFACT_DIR,
        runAuthorityResolver,
        approvalResolver: (url) => structuredClone(LIVE_APPROVALS.get(url) ?? null),
        telemetryResolver: (queryId) => structuredClone(LIVE_TELEMETRY.get(queryId) ?? null),
        geminiResolver: () => structuredClone(LIVE_GEMINI),
      }).verdict).toBe('PASS');
    });

    it('CASUALTY: a sibling take in the same native journey cannot lend its save to another take', () => {
      const evidence = validEvidence();
      eventByUuid(evidence, 'session_saved-2').comparisonNonce = nonceFor(1);
      const problems = holdProblems(authorize(evidence));
      expect(problems).toMatch(/candidateEvidence\[0\] must link exactly one decoded session_saved/);
      expect(problems).toMatch(/candidateEvidence\[1\] must link exactly one decoded session_saved/);
    });

    it('CASUALTY: two takes cannot claim the same native attempt', () => {
      const evidence = validEvidence();
      for (const uuid of ['session_started-2', 'session_saved-2']) {
        Object.assign(eventByUuid(evidence, uuid), { attemptId: 'attempt-1', attemptSeq: 1 });
      }
      Object.assign(evidence.candidateEvidence[1], { attemptId: 'attempt-1', attemptSeq: 1 });
      expect(holdProblems(authorize(evidence))).toMatch(/reuses telemetry correlation native-journey-shared\/attempt-1/);
    });

    it('CASUALTY: a different or later nonce cannot satisfy the intended take', () => {
      const evidence = validEvidence();
      eventByUuid(evidence, 'session_saved-1').comparisonNonce = 'comparison-nonce-later-take';
      const problems = holdProblems(authorize(evidence));
      expect(problems).toMatch(/candidateEvidence\[0\] must link exactly one decoded session_saved/);
      expect(problems).toMatch(/carries a comparisonNonce that belongs to no candidate row/);
    });

    it('CASUALTY: a take nonce cannot shadow the document positive control', () => {
      const shadowed = validEvidence();
      eventByUuid(shadowed, 'event-positive-control').comparisonNonce = nonceFor(1);
      expect(holdProblems(authorize(shadowed))).toMatch(/positive control must not carry a take comparisonNonce/);

      const impostor = validEvidence();
      impostor.telemetryReadback.events.shift();
      eventByUuid(impostor, 'session_started-1').controlNonce = EVIDENCE_DOCUMENT_ID;
      const problems = holdProblems(authorize(impostor));
      expect(problems).toMatch(/take event must not carry the document controlNonce/);
      expect(problems).toMatch(/exactly one telemetry_positive_control/);
    });

    it('CASUALTY: the packet copies of native journey/attempt identity must equal the authenticated readback', () => {
      const forged = validEvidence();
      forged.candidateEvidence[2].attemptId = 'attempt-typed-by-operator';
      expect(holdProblems(forged)).toMatch(/candidateEvidence\[2\]\.attemptId observed native attempt/);

      const split = validEvidence();
      eventByUuid(split, 'session_saved-3').attemptId = 'attempt-from-elsewhere';
      expect(holdProblems(authorize(split))).toMatch(/candidateEvidence\[2\] session_saved native attemptId/);

      const anonymous = validEvidence();
      Object.assign(eventByUuid(anonymous, 'session_started-3'), { attemptId: null, attemptSeq: 0 });
      expect(holdProblems(authorize(anonymous))).toMatch(/session_started carries no native attempt identity/);
    });

    it('CASUALTY: practice-mode evidence binds to the same nonce and rejects missing, contradictory, cross-model, cross-document and stale rows', () => {
      const missing = validEvidence();
      missing.telemetryReadback.events = missing.telemetryReadback.events.filter((event) => event.uuid !== 'mode-3');
      expect(holdProblems(authorize(missing))).toMatch(/candidateEvidence\[2\] must link decoded quick journey telemetry/);

      const contradictory = validEvidence();
      eventByUuid(contradictory, 'mode-4').comparisonNonce = nonceFor(3);
      expect(holdProblems(authorize(contradictory))).toMatch(/candidateEvidence\[2\] has contradictory decoded journey telemetry/);

      const crossModel = validEvidence();
      eventByUuid(crossModel, 'mode-3').candidateId = COMPARISON_CANDIDATES[0];
      expect(holdProblems(authorize(crossModel))).toMatch(/linked practice_mode_selected mode-3 candidateId must be "v4:distil:q4"/);

      const crossDocument = validEvidence();
      eventByUuid(crossDocument, 'mode-3').evidenceDocumentId = '33333333-3333-4333-8333-333333333333';
      expect(holdProblems(authorize(crossDocument))).toMatch(/linked practice_mode_selected mode-3 evidenceDocumentId/);

      const stale = validEvidence();
      eventByUuid(stale, 'mode-3').releaseSha = 'b'.repeat(40);
      expect(holdProblems(authorize(stale))).toMatch(/events\[\d+\]\.releaseSha must be/);

      const journeyOnly = validEvidence();
      // Same native journey, no nonce: exactly the fallback Option A forbids. It must not count.
      eventByUuid(journeyOnly, 'mode-2').comparisonNonce = null;
      const problems = holdProblems(authorize(journeyOnly));
      expect(problems).toMatch(/take event has no comparisonNonce/);
      expect(problems).toMatch(/candidateEvidence\[1\] must link decoded objective journey telemetry/);
    });

    it('CASUALTY: the observer receipt must carry the row nonce and no longer asserts native identity', () => {
      const evidence = validEvidence();
      const receipt = JSON.parse(readFileSync(join(ARTIFACT_DIR, evidence.candidateEvidence[0].receiptArtifact), 'utf8'));
      expect(receipt).not.toHaveProperty('journeyId');
      expect(receipt).not.toHaveProperty('attemptId');
      receipt.comparisonNonce = nonceFor(2);
      const rewritten = writeArtifact('receipt-wrong-nonce.json', receipt);
      evidence.candidateEvidence[0].receiptArtifact = rewritten.path;
      evidence.candidateEvidence[0].receiptSha256 = rewritten.digest;
      expect(holdProblems(evidence)).toMatch(new RegExp(`receipt\\.comparisonNonce must be "${nonceFor(1)}"`));
    });
  });

  describe('#1432 PM decisions 5651830241 / 5651842972 — each take is authorized by one rc-gates.yml attempt, re-read here', () => {
    const withoutRunResolver = () => ({
      baseDir: ARTIFACT_DIR,
      approvalResolver: (url) => structuredClone(LIVE_APPROVALS.get(url) ?? null),
      telemetryResolver: (queryId) => structuredClone(LIVE_TELEMETRY.get(queryId) ?? null),
      geminiResolver: () => structuredClone(LIVE_GEMINI),
    });
    const runKeyOf = (evidence, rowIndex) => {
      const receipt = JSON.parse(readFileSync(join(ARTIFACT_DIR, evidence.candidateEvidence[rowIndex].receiptArtifact), 'utf8'));
      return `${receipt.authorization.runId}/${receipt.authorization.runAttempt}`;
    };
    /** Change what GitHub reports for one row's authorization run. */
    const withRun = (evidence, rowIndex, mutate) => {
      const key = runKeyOf(evidence, rowIndex);
      const bundle = LIVE_RUNS.get(key);
      mutate(bundle);
      LIVE_RUNS.set(key, bundle);
      return evidence;
    };

    it('CASUALTY: a direct executor invocation or page claim leaves no GitHub run record and cannot pass', () => {
      const evidence = rewriteReceipt(validEvidence(), 1, 'no-run-record', (receipt) => { delete receipt.authorization; });
      expect(holdProblems(evidence)).toMatch(/candidateEvidence\[1\]\.receipt observer receipt has no GitHub run authorization record/);
    });

    it('CASUALTY: the validator holds without a GitHub run authority resolver', () => {
      const result = validateModelDownselectionEvidence(validEvidence(), withoutRunResolver());
      expect(result.verdict).toBe('HOLD');
      expect(result.problems.join('\n')).toMatch(/authorization has no GitHub run authority resolver/);
    });

    it('CASUALTY: a run GitHub cannot read back fails', () => {
      const evidence = validEvidence();
      LIVE_RUNS.delete(runKeyOf(evidence, 0));
      expect(holdProblems(evidence)).toMatch(/candidateEvidence\[0\]\.receipt authorization run \d+ could not be read back from GitHub/);
    });

    it.each([
      ['a failed run', (bundle) => { bundle.run.conclusion = 'failure'; }, /did not complete successfully/],
      ['another workflow', (bundle) => { bundle.run.path = '.github/workflows/ci.yml'; }, /is not the authorization workflow/],
      ['a run on another branch than its workflow ref', (bundle) => { bundle.run.head_branch = 'feature'; }, /workflow ref does not match the ref its run executed/],
      ['a different workflow revision', (bundle) => { bundle.run.head_sha = 'd'.repeat(40); }, /workflow revision does not match its run/],
      ['a dispatcher who is not the repository owner', (bundle) => { bundle.repo.owner.login = 'someone-else'; }, /not dispatched by the repository owner/],
      ['a different triggering actor', (bundle) => { bundle.run.triggering_actor.login = 'intruder'; }, /actor does not match the run's actor and triggering actor/],
      ['a push-triggered run', (bundle) => { bundle.run.event = 'push'; }, /was not a manual dispatch/],
      ['a #1437 diagnostic run (its Gate 3 job executed and was rejected)', (bundle) => { bundle.run.conclusion = 'failure'; bundle.jobs[0].conclusion = 'failure'; }, /executed jobs other than comparison authorization/],
      ['a failed authorization job', (bundle) => { bundle.jobs[1].conclusion = 'failure'; }, /no single successful comparison-authorization job/],
      ['another repository', (bundle) => { bundle.repo.full_name = 'someone/fork'; }, /repository is not the comparison repository/],
    ])('CASUALTY: %s is not authority', (_label, mutate, message) => {
      const problems = holdProblems(withRun(validEvidence(), 2, mutate));
      expect(problems).toMatch(/candidateEvidence\[2\]\.receipt authorization/);
      expect(problems).toMatch(message);
    });

    it('CASUALTY: a receipt record rewritten locally no longer matches its run artifact', () => {
      const evidence = rewriteReceipt(validEvidence(), 3, 'forged-record', (receipt) => { receipt.authorization.candidateId = 'moonshine:streaming-medium'; });
      expect(holdProblems(evidence)).toMatch(/candidateEvidence\[3\]\.receipt authorization candidateId does not match its run artifact/);
    });

    it('CASUALTY: only a nonce generated by its authorization run qualifies', () => {
      const evidence = rewriteReceipt(validEvidence(), 0, 'foreign-nonce', (receipt) => { receipt.authorization.nonce = `run-999-1-${'f'.repeat(24)}`; });
      expect(holdProblems(evidence)).toMatch(/candidateEvidence\[0\]\.receipt authorization nonce was not generated by its authorization run/);
    });

    it('CASUALTY: one authorization run cannot stand behind two rows (replay)', () => {
      const evidence = validEvidence();
      const first = JSON.parse(readFileSync(join(ARTIFACT_DIR, evidence.candidateEvidence[0].receiptArtifact), 'utf8'));
      rewriteReceipt(evidence, 1, 'reused-run', (receipt) => { receipt.authorization = first.authorization; });
      const problems = holdProblems(evidence);
      expect(problems).toMatch(/candidateEvidence\[1\] reuses authorization run/);
      expect(problems).toMatch(/candidateEvidence\[1\]\.receipt\.authorization\.nonce must be/);
    });

    it('CASUALTY: cross-candidate, cross-release and cross-document runs fail', () => {
      const crossModel = withRun(validEvidence(), 0, (bundle) => { bundle.artifact.candidateId = 'moonshine:streaming-medium'; });
      expect(holdProblems(crossModel)).toMatch(/candidateEvidence\[0\]\.receipt authorization candidateId must be "v2:base\.en"/);
      const crossRelease = withRun(validEvidence(), 0, (bundle) => { bundle.artifact.releaseSha = 'b'.repeat(40); });
      expect(holdProblems(crossRelease)).toMatch(/candidateEvidence\[0\]\.receipt authorization releaseSha must be/);
      const crossDocument = withRun(validEvidence(), 0, (bundle) => { bundle.artifact.evidenceDocumentId = '33333333-3333-4333-8333-333333333333'; });
      expect(holdProblems(crossDocument)).toMatch(/candidateEvidence\[0\]\.receipt authorization evidenceDocumentId must be/);
    });

    it('CASUALTY: an authorization the observer relied on before its run completed fails', () => {
      const evidence = withRun(validEvidence(), 3, (bundle) => { bundle.run.updated_at = new Date(ISSUED_AT + 10 * 60_000).toISOString(); });
      expect(holdProblems(evidence)).toMatch(/candidateEvidence\[3\]\.receipt authorization was relied on before its run completed/);
    });

    it('CASUALTY: a rerun attempt of one authorization run cannot authorize a second row (cross-attempt)', () => {
      const evidence = validEvidence();
      const first = JSON.parse(readFileSync(join(ARTIFACT_DIR, evidence.candidateEvidence[0].receiptArtifact), 'utf8'));
      const row = evidence.candidateEvidence[1];
      rewriteReceipt(evidence, 1, 'rerun-attempt', (receipt) => {
        receipt.authorization = observerAuthorization({
          candidateId: row.candidateId, journey: row.journey, ordinal: 91, runId: first.authorization.runId, runAttempt: 2,
        });
      });
      expect(holdProblems(evidence)).toMatch(new RegExp(`candidateEvidence\\[1\\] reuses authorization run ${first.authorization.runId}`));
    });

    it('CASUALTY (RWT-01): a receipt from the retired attached observer cannot qualify a row', () => {
      const evidence = rewriteReceipt(validEvidence(), 4, 'attached-observer', (receipt) => {
        delete receipt.evidenceKind;
        delete receipt.control;
        receipt.workerInstrumentation = { attached: 2, installed: 2, drained: 2, networkEnabled: 2, mainTripwireInstalled: true };
      });
      expect(holdProblems(evidence)).toMatch(/candidateEvidence\[4\]\.receipt receipt evidenceKind must be "pre_take_control"/);
    });

    it('CASUALTY (RWT-01): a control receipt still attached at the take HOLDs the row', () => {
      const evidence = rewriteReceipt(validEvidence(), 4, 'still-attached', (receipt) => { receipt.control.disconnectedBeforeTake = false; });
      expect(holdProblems(evidence)).toMatch(/candidateEvidence\[4\]\.receipt the control session did not disconnect before the take/);
    });

    it('CASUALTY: the packet row session binding is still enforced through telemetry', () => {
      const evidence = validEvidence();
      evidence.candidateEvidence[4].persistedSessionId = '99999999-9999-4999-8999-999999999999';
      expect(holdProblems(evidence)).toMatch(/candidateEvidence\[4\] session_saved persisted-session binding/);
    });
  });

  describe('#1432 PM RETURN `5654659496` / `5655220799` — Focus Points: finalized verdict of record, telemetry count chain, one evaluator, absent from Open Mic', () => {
    const resolvers = () => ({
      baseDir: ARTIFACT_DIR,
      runAuthorityResolver,
      approvalResolver: (url) => structuredClone(LIVE_APPROVALS.get(url) ?? null),
      telemetryResolver: (queryId) => structuredClone(LIVE_TELEMETRY.get(queryId) ?? null),
      geminiResolver: () => structuredClone(LIVE_GEMINI),
    });
    /** Re-authorize the readback and re-approve the changed packet, so only the discriminating rule can speak. */
    const problemsOf = (value) => {
      authorize(value);
      const approval = JSON.parse(readFileSync(join(ARTIFACT_DIR, value.selection.approvalArtifact), 'utf8'));
      approval.body = approval.body.replace(/^packet_sha256: .*$/m, `packet_sha256: ${completedEvidenceDigest(value)}`);
      LIVE_APPROVALS.set(approval.html_url, structuredClone(approval));
      const rewritten = writeArtifact(`approval-coverage-${fixtureSequence}.json`, approval);
      value.selection.approvalArtifact = rewritten.path;
      value.selection.approvalSha256 = rewritten.digest;
      return validateModelDownselectionEvidence(value, resolvers()).problems;
    };
    const coverageEvents = (value, ordinal) => value.telemetryReadback.events.filter(
      (event) => event.uuid.startsWith(`coverage-evaluation-${ordinal}`) || event.uuid.startsWith(`coverage-point-${ordinal}-`),
    );
    /** The finalized stop-seam record on one row's attested persisted-session authority. */
    const finalizedOf = (rowIndex) => LIVE_GEMINI[rowIndex].finalizedCoverage;
    /** A fourth point the stop seam and the row both carry. */
    const addFinalizedPoint = (value, rowIndex) => {
      finalizedOf(rowIndex).sessions[0].points.push({ sortOrder: 3, verdict: 'not_detected', predicateVersion: PREDICATE });
      value.candidateEvidence[rowIndex].focusCoverage.points.push({ position: 3, verdict: 'not_detected' });
    };

    it('CONTROL: the harness passes an unchanged packet, and a superseded settled emission is not an extra point', () => {
      const evidence = validEvidence();
      expect(evidence.candidateEvidence.filter((row) => row.focusCoverage).map((row) => row.journey))
        .toEqual(['focus_points', 'focus_points', 'focus_points']);
      expect(eventByUuid(evidence, 'coverage-point-2-0-superseded').verdict).toBe('missing');
      expect(finalizedOf(0)).toBeNull();
      expect(finalizedOf(1).sessions).toHaveLength(1);
      expect(problemsOf(evidence)).toEqual([]);
      expect(validateModelDownselectionEvidence(evidence, resolvers()).verdict).toBe('PASS');
    });

    it('CONTROL (divergence): pre-final telemetry that disagrees never overwrites or vetoes the finalized verdict', () => {
      const evidence = validEvidence();
      // The view-side derivation said `missing` at position 1 and `covered` at position 2; the stop seam decided otherwise.
      eventByUuid(evidence, 'coverage-point-2-1').verdict = 'missing';
      eventByUuid(evidence, 'coverage-point-2-2').verdict = 'covered';
      finalizedOf(1).sessions[0].points[1].verdict = 'not_detected';
      evidence.candidateEvidence[1].focusCoverage.points[1].verdict = 'not_detected';
      expect(problemsOf(evidence)).toEqual([]);
    });

    it('CASUALTY (divergence): a packet carrying the pre-final verdict instead of the finalized one fails', () => {
      const evidence = validEvidence();
      // Telemetry still says `partial` at position 1, which maps to detected; the persisted record says not detected.
      finalizedOf(1).sessions[0].points[1].verdict = 'not_detected';
      expect(problemsOf(evidence)).toEqual([
        'candidateEvidence[1].focusCoverage.points[1].verdict finalized stop-seam verdict must be "not_detected"',
      ]);
    });

    it('CASUALTY 1: a row missing one entered point fails', () => {
      const evidence = validEvidence();
      evidence.candidateEvidence[1].focusCoverage.points.pop();
      expect(problemsOf(evidence)).toEqual([
        'candidateEvidence[1].focusCoverage.points must carry exactly one finalized verdict per entered point (3)',
      ]);
    });

    it('CASUALTY 2: reordered or non-contiguous positions fail', () => {
      const reordered = validEvidence();
      const { points } = reordered.candidateEvidence[3].focusCoverage;
      reordered.candidateEvidence[3].focusCoverage.points = [points[1], points[0], points[2]];
      expect(problemsOf(reordered)).toEqual([
        'candidateEvidence[3].focusCoverage.points positions must be contiguous from 0 and in order',
      ]);

      const gapped = validEvidence();
      gapped.candidateEvidence[5].focusCoverage.points[2].position = 3;
      expect(problemsOf(gapped)).toEqual([
        'candidateEvidence[5].focusCoverage.points positions must be contiguous from 0 and in order',
        'candidateEvidence[5].focusCoverage.points[2] has no finalized stop-seam verdict at position 3',
      ]);
    });

    it('CASUALTY 3: a quick (Open Mic) row carrying the per-point structure fails', () => {
      const evidence = validEvidence();
      evidence.candidateEvidence[0].focusCoverage = structuredClone(evidence.candidateEvidence[1].focusCoverage);
      expect(problemsOf(evidence)).toEqual([
        'candidateEvidence[0].focusCoverage must be absent on a quick (Open Mic) take',
      ]);
    });

    it('CASUALTY 3 (schema): presence on an Open Mic row is a schema failure, not an emptiness check', () => {
      const schema = JSON.parse(readFileSync('product_release/evidence/human-test/model-downselection.schema.json', 'utf8'));
      const take = schema.$defs.candidateTake;
      expect(take.if).toEqual({ required: ['journey'], properties: { journey: { const: 'focus_points' } } });
      expect(take.then).toEqual({ required: ['focusCoverage'] });
      expect(take.else).toEqual({ not: { required: ['focusCoverage'] } });
      expect(take.required).not.toContain('focusCoverage');
      expect(take.properties.focusCoverage).toEqual({ $ref: '#/$defs/focusCoverage' });
      expect(schema.$defs.focusCoverage.properties.points.items.properties.verdict).toEqual({ enum: ['detected', 'not_detected'] });
    });

    it('CASUALTY: an Open Mic take whose attempt carries coverage telemetry, or whose session carries a finalized record, fails', () => {
      const evidence = validEvidence();
      for (const event of coverageEvents(evidence, 2)) event.attemptId = 'attempt-1';
      const problems = problemsOf(evidence).join('\n');
      expect(problems).toMatch(/candidateEvidence\[0\] quick \(Open Mic\) take links decoded coverage telemetry/);
      expect(problems).toMatch(/candidateEvidence\[1\] must link a decoded coverage_evaluation for its Focus Points take/);

      const finalized = validEvidence();
      LIVE_GEMINI[0].finalizedCoverage = finalizedRecord();
      expect(problemsOf(finalized)).toEqual(['candidateEvidence[0] quick (Open Mic) take has finalized stop-seam coverage']);
    });

    it('CASUALTY 4: candidates scored by different evaluator versions, thresholds or predicates fail', () => {
      const version = validEvidence();
      for (const event of coverageEvents(version, 4)) event.evaluatorVersion = 'keyword-ratio-v2';
      version.candidateEvidence[3].focusCoverage.evaluatorVersion = 'keyword-ratio-v2';
      expect(problemsOf(version)).toEqual([
        'candidateEvidence Focus Points takes were not scored by one evaluator: evaluatorVersion differs ("keyword-ratio-v1", "keyword-ratio-v2")',
      ]);

      const threshold = validEvidence();
      for (const event of coverageEvents(threshold, 6)) if (event.event === 'coverage_evaluation') event.coveredThreshold = 0.8;
      threshold.candidateEvidence[5].focusCoverage.coveredThreshold = 0.8;
      expect(problemsOf(threshold)).toEqual([
        'candidateEvidence Focus Points takes were not scored by one evaluator: coveredThreshold differs (0.7, 0.8)',
      ]);

      // PM RETURN `5655220799` — predicate-version drift across the three candidates.
      const predicate = validEvidence();
      for (const point of finalizedOf(3).sessions[0].points) point.predicateVersion = 'literal-cue-v2';
      predicate.candidateEvidence[3].focusCoverage.predicateVersion = 'literal-cue-v2';
      expect(problemsOf(predicate)).toEqual([
        'candidateEvidence Focus Points takes were not scored by one evaluator: predicateVersion differs ("literal-cue-v1", "literal-cue-v2")',
      ]);
    });

    it('CASUALTY 5 (PM): a point dropped before evaluation fails even when every position is contiguous', () => {
      const evidence = validEvidence();
      // Entry, supply and the finalized record agree on four; only evaluation saw three.
      eventByUuid(evidence, 'setup-2').pointsEntered = 4;
      eventByUuid(evidence, 'coverage-evaluation-2').pointsSupplied = 4;
      Object.assign(evidence.candidateEvidence[1].focusCoverage, { pointsEntered: 4, pointsSupplied: 4 });
      addFinalizedPoint(evidence, 1);
      expect(problemsOf(evidence)).toEqual([
        'candidateEvidence[1].focusCoverage dropped a point before evaluation: pointsSupplied 4, pointsEvaluated 3',
      ]);
    });

    it('CASUALTY 6 (PM 5654994284): a point lost between setup and evaluation fails even when supplied equals evaluated', () => {
      const evidence = validEvidence();
      eventByUuid(evidence, 'setup-4').pointsEntered = 4;
      evidence.candidateEvidence[3].focusCoverage.pointsEntered = 4;
      addFinalizedPoint(evidence, 3);
      expect(problemsOf(evidence)).toEqual([
        'candidateEvidence[3].focusCoverage lost a point between setup and evaluation: pointsEntered 4, pointsSupplied 3',
      ]);
    });

    it('CASUALTY (PM 5654994284): a missing, later or cross-journey setup is not the take\'s entered count', () => {
      const missing = validEvidence();
      missing.telemetryReadback.events = missing.telemetryReadback.events.filter((event) => event.uuid !== 'setup-6');
      expect(problemsOf(missing)).toEqual([
        'candidateEvidence[5] must link a decoded setup_submitted in its native journey before its session_started',
      ]);

      const crossJourney = validEvidence();
      eventByUuid(crossJourney, 'setup-6').journeyId = 'native-journey-4';
      expect(problemsOf(crossJourney)).toEqual([
        'candidateEvidence[5] must link a decoded setup_submitted in its native journey before its session_started',
      ]);

      const afterStart = validEvidence();
      const { events } = afterStart.telemetryReadback;
      const setup = events.splice(events.findIndex((event) => event.uuid === 'setup-6'), 1)[0];
      events.push(setup);
      expect(problemsOf(afterStart)).toEqual([
        'candidateEvidence[5] must link a decoded setup_submitted in its native journey before its session_started',
      ]);
    });

    it('CASUALTY (PM 5654994284): a second effective telemetry row for one position is ambiguity, not a merge', () => {
      const evidence = validEvidence();
      const { events } = evidence.telemetryReadback;
      const last = events.findIndex((event) => event.uuid === 'coverage-point-2-2');
      events.splice(last + 1, 0, { ...structuredClone(eventByUuid(evidence, 'coverage-point-2-1')), uuid: 'coverage-point-2-1-duplicate', verdict: 'covered' });
      expect(problemsOf(evidence).join('\n')).toMatch(/candidateEvidence\[1\] has more than one effective coverage_point at position 1/);
    });

    it('CASUALTY (PM 5655220799): zero, multiple, absent or malformed finalized stop-seam sessions fail', () => {
      const zero = validEvidence();
      finalizedOf(1).sessions = [];
      expect(problemsOf(zero)).toEqual(['candidateEvidence[1] must resolve exactly one finalized stop-seam session (found 0)']);

      const multiple = validEvidence();
      finalizedOf(3).sessions.push(structuredClone(finalizedOf(3).sessions[0]));
      expect(problemsOf(multiple)).toEqual(['candidateEvidence[3] must resolve exactly one finalized stop-seam session (found 2)']);

      const absent = validEvidence();
      LIVE_GEMINI[5].finalizedCoverage = null;
      expect(problemsOf(absent)).toEqual(['candidateEvidence[5] has no finalized stop-seam readback for its persisted session']);

      const malformed = validEvidence();
      LIVE_GEMINI[5].finalizedCoverage = { sessions: 'not-a-list' };
      expect(problemsOf(malformed)).toEqual(['candidateEvidence[5] has no finalized stop-seam readback for its persisted session']);
    });

    it('CASUALTY (PM 5655220799): a missing, extra or duplicate finalized row fails', () => {
      const missing = validEvidence();
      finalizedOf(1).sessions[0].points.pop();
      expect(problemsOf(missing)).toEqual([
        'candidateEvidence[1] finalized stop-seam evidence must carry exactly one row per entered point (entered 3, finalized 2)',
        'candidateEvidence[1].focusCoverage.points[2] has no finalized stop-seam verdict at position 2',
      ]);

      const extra = validEvidence();
      finalizedOf(3).sessions[0].points.push({ sortOrder: 3, verdict: 'detected', predicateVersion: PREDICATE });
      expect(problemsOf(extra)).toEqual([
        'candidateEvidence[3] finalized stop-seam evidence must carry exactly one row per entered point (entered 3, finalized 4)',
      ]);

      const duplicate = validEvidence();
      finalizedOf(5).sessions[0].points[2].sortOrder = 1;
      expect(problemsOf(duplicate)).toEqual([
        'candidateEvidence[5] finalized stop-seam sort_order must be contiguous from 0 with no duplicate',
        'candidateEvidence[5].focusCoverage.points[2] has no finalized stop-seam verdict at position 2',
      ]);
    });

    it('CASUALTY (PM 5655220799): an `unavailable` finalized verdict never qualifies', () => {
      const evidence = validEvidence();
      finalizedOf(1).sessions[0].points[2].verdict = 'unavailable';
      expect(problemsOf(evidence)).toEqual([
        'candidateEvidence[1] finalized stop-seam verdict at position 2 is unavailable',
      ]);
    });

    it('CASUALTY: an operator-authored verdict or a missing structure fails', () => {
      const verdict = validEvidence();
      verdict.candidateEvidence[1].focusCoverage.points[2].verdict = 'detected';
      expect(problemsOf(verdict)).toEqual([
        'candidateEvidence[1].focusCoverage.points[2].verdict finalized stop-seam verdict must be "not_detected"',
      ]);

      const predicate = validEvidence();
      predicate.candidateEvidence[1].focusCoverage.predicateVersion = 'typed-by-operator';
      expect(problemsOf(predicate)).toEqual([
        'candidateEvidence[1].focusCoverage.predicateVersion must equal the finalized stop-seam predicate_version',
        'candidateEvidence Focus Points takes were not scored by one evaluator: predicateVersion differs ("typed-by-operator", "literal-cue-v1")',
      ]);

      const absent = validEvidence();
      delete absent.candidateEvidence[5].focusCoverage;
      expect(problemsOf(absent)).toEqual(['candidateEvidence[5].focusCoverage is required on an objective (Focus Points) take']);
    });
  });

  it('rejects unknown fields instead of silently accepting drifted evidence', () => {
    const evidence = validEvidence(); evidence.selection.winner = COMPARISON_CANDIDATES[0];
    expect(holdProblems(evidence)).toMatch(/selection\.winner is not allowed/);
  });
});

describe('#1432 PM RETURN `5654016276` — the validator, schema and template follow the deployed Edge Gemini contract', () => {
  const edge = JSON.parse(readFileSync('backend/supabase/functions/get-ai-suggestions/contract.json', 'utf8'));
  const schema = JSON.parse(readFileSync('product_release/evidence/human-test/model-downselection.schema.json', 'utf8'));
  const template = JSON.parse(readFileSync('product_release/evidence/human-test/model-downselection.template.json', 'utf8'));
  /** Every `model` const anywhere in the schema, so a second copy cannot drift unseen. */
  const schemaModelConsts = (node, found = []) => {
    if (Array.isArray(node)) node.forEach((child) => schemaModelConsts(child, found));
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'model' && value && typeof value === 'object' && 'const' in value) found.push(value.const);
        schemaModelConsts(value, found);
      }
    }
    return found;
  };

  /** Every quota `limit` const and `requestNumber` maximum anywhere in the schema. */
  const schemaQuotaCaps = (node, path = '', found = []) => {
    if (Array.isArray(node)) node.forEach((child, index) => schemaQuotaCaps(child, `${path}[${index}]`, found));
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        const here = `${path}/${key}`;
        if (key === 'limit' && value && typeof value === 'object' && 'const' in value) found.push({ path: `${here}/const`, value: value.const });
        if (key === 'requestNumber' && value && typeof value === 'object' && 'maximum' in value) found.push({ path: `${here}/maximum`, value: value.maximum });
        schemaQuotaCaps(value, here, found);
      }
    }
    return found;
  };

  it('CASUALTY: the locked model and uncached daily cap are the Edge contract values, read from that one file', () => {
    expect(LOCKED_GEMINI_CONTRACT.model).toBe(edge.model);
    expect(LOCKED_GEMINI_CONTRACT.uncachedRequestsPerUserUtcDay).toBe(edge.uncachedGenerationCapPerUtcDay);
    const validatorSource = readFileSync('scripts/human-test/modelDownselectionEvidence.mjs', 'utf8');
    expect(validatorSource).toContain("'../../backend/supabase/functions/get-ai-suggestions/contract.json'");
    expect(validatorSource).not.toMatch(/model:\s*'gemini-|uncachedRequestsPerUserUtcDay:\s*\d/);
  });

  it('CASUALTY: the schema and the template carry exactly the same contract', () => {
    const models = schemaModelConsts(schema);
    expect(models.length).toBeGreaterThanOrEqual(2);
    expect(new Set(models)).toEqual(new Set([edge.model]));
    expect(schema.properties.geminiContract.properties.uncachedRequestsPerUserUtcDay.const).toBe(edge.uncachedGenerationCapPerUtcDay);
    // Codex P1 `4000011161` — the nested quota definition every fresh observation references must carry the same cap.
    const quotaCaps = schemaQuotaCaps(schema);
    expect(quotaCaps.length).toBeGreaterThanOrEqual(2);
    expect(quotaCaps).toEqual(quotaCaps.map(({ path }) => ({ path, value: edge.uncachedGenerationCapPerUtcDay })));
    // Compared to the contract file directly, not only to the validator's derived value (PM guardrail).
    expect(template.geminiContract.model).toBe(edge.model);
    expect(template.geminiContract.uncachedRequestsPerUserUtcDay).toBe(edge.uncachedGenerationCapPerUtcDay);
    expect(template.geminiContract).toEqual({ ...LOCKED_GEMINI_CONTRACT });
  });

  it('BOUNDARY (PM RETURN `5654225901`): request number at the contract cap is accepted; cap + 1 is refused — validator and schema', () => {
    const cap = edge.uncachedGenerationCapPerUtcDay; // deployed contract: 10
    const resolvers = () => ({
      baseDir: ARTIFACT_DIR,
      runAuthorityResolver,
      approvalResolver: (url) => structuredClone(LIVE_APPROVALS.get(url) ?? null),
      telemetryResolver: (queryId) => structuredClone(LIVE_TELEMETRY.get(queryId) ?? null),
      geminiResolver: () => structuredClone(LIVE_GEMINI),
    });

    // Executable validator. The trusted readback carries the same ordinal, so only the cap rule can speak.
    // Changing the packet also changes its approval digest, so acceptance is proven as "no quota problem".
    const atCap = validEvidence();
    atCap.geminiEvidence[0].quota.requestNumber = cap;
    LIVE_GEMINI[0].quota.requestNumber = cap;
    expect(validateModelDownselectionEvidence(atCap, resolvers()).problems.join('\n'))
      .not.toMatch(/requestNumber|quota\.limit|trusted quota/);

    const overCap = validEvidence();
    overCap.geminiEvidence[0].quota.requestNumber = cap + 1;
    LIVE_GEMINI[0].quota.requestNumber = cap + 1;
    expect(holdProblems(overCap)).toMatch(new RegExp(`geminiEvidence\\[0\\]\\.quota\\.requestNumber must be between 1 and ${cap}\\b`));

    // Schema: the nested quota definition every fresh observation references.
    const quota = schema.$defs.quota.properties;
    const schemaQuotaBoundsAccept = ({ limit, requestNumber }) => limit === quota.limit.const
      && Number.isInteger(requestNumber)
      && requestNumber >= quota.requestNumber.minimum
      && requestNumber <= quota.requestNumber.maximum;
    expect(schemaQuotaBoundsAccept({ limit: cap, requestNumber: cap })).toBe(true);
    expect(schemaQuotaBoundsAccept({ limit: cap, requestNumber: cap + 1 })).toBe(false);
    expect(schemaQuotaBoundsAccept({ limit: 20, requestNumber: cap })).toBe(false);
  });

  it('CASUALTY: the six-word phrase limit agrees with the Edge word budget', () => {
    expect(edge.wordBudget).toEqual({
      what_worked: LOCKED_GEMINI_CONTRACT.maxWhitespaceWordsPerPhrase,
      what_to_try_next: LOCKED_GEMINI_CONTRACT.maxWhitespaceWordsPerPhrase,
    });
  });

  it('CASUALTY: a packet or observation carrying the retired preview contract is not truthful evidence', () => {
    const stalePacket = validEvidence();
    stalePacket.geminiContract = { ...LOCKED_GEMINI_CONTRACT, model: 'gemini-3-flash-preview', uncachedRequestsPerUserUtcDay: 20 };
    const packetProblems = holdProblems(stalePacket);
    expect(packetProblems).toMatch(/geminiContract\.model must be/);
    expect(packetProblems).toMatch(/geminiContract\.uncachedRequestsPerUserUtcDay must be/);

    const staleModel = validEvidence();
    staleModel.geminiEvidence[0].model = 'gemini-3-flash-preview';
    expect(holdProblems(staleModel)).toMatch(/geminiEvidence\[0\]\.model must be/);

    const staleLimit = validEvidence();
    staleLimit.geminiEvidence[0].quota.limit = 20;
    expect(holdProblems(staleLimit)).toMatch(new RegExp(`geminiEvidence\\[0\\]\\.quota\\.limit must be ${LOCKED_GEMINI_CONTRACT.uncachedRequestsPerUserUtcDay}\\b`));
  });
});
