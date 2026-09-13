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

let fixtureSequence = 0;
function validEvidence() {
  fixtureSequence += 1;
  const suffix = fixtureSequence;
  const candidateEvidence = [];
  // The document control is emitted under the envelope's own native identity and carries no take nonce.
  const events = [{
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
      const receipt = writeArtifact(`receipt-${suffix}-${ordinal}.json`, {
        verdict: 'PASS', holdKind: null, dryRun: false,
        target: { origin: PRODUCTION_ORIGIN }, release: RELEASE,
        expectedCandidate: candidateId, requestedCandidate: candidateId, observedCandidate: candidateId,
        observedJourney: journey, comparisonNonce,
        evidenceDocumentId: EVIDENCE_DOCUMENT_ID,
        persistedSessionId, capturedAt: ISO,
        authorization: observerAuthorization({ candidateId, journey, ordinal }),
        sessionBindingSha256: modelComparisonSessionBindingSha256(comparisonNonce, persistedSessionId),
      });
      candidateEvidence.push({
        releaseSha: RELEASE, candidateId, journey, journeyId, attemptId, attemptSeq,
        comparisonNonce, persistedSessionId,
        receiptArtifact: receipt.path, receiptSha256: receipt.digest,
      });
      events.push({
        uuid: `mode-${ordinal}`, event: 'practice_mode_selected', releaseSha: RELEASE,
        // Mode selection may precede engine attribution; take 1 proves a null candidate is not contradiction.
        candidateId: ordinal === 1 ? null : candidateId,
        productMode: journey === 'focus_points' ? 'objective' : 'quick', journeyId,
        attemptId: null, attemptSeq: 0, wordCount: null, comparisonNonce, controlNonce: null,
        transportInitialized: null, evidenceDocumentId: EVIDENCE_DOCUMENT_ID, sessionBindingSha256: null,
      });
      for (const event of ['session_started', 'session_saved']) {
        events.push({
          uuid: `${event}-${ordinal}`, event, releaseSha: RELEASE, candidateId, productMode: null, journeyId,
          attemptId, attemptSeq, wordCount: event === 'session_saved' ? 42 : null,
          comparisonNonce, controlNonce: null, transportInitialized: null, evidenceDocumentId: EVIDENCE_DOCUMENT_ID,
          sessionBindingSha256: event === 'session_saved'
            ? modelComparisonSessionBindingSha256(comparisonNonce, persistedSessionId) : null,
        });
      }
      geminiEvidence.push({
        releaseSha: RELEASE, candidateId, journey, journeyId, attemptId, attemptSeq,
        comparisonNonce, persistedSessionId, receiptSha256: receipt.digest,
        source: 'fresh', model: 'gemini-3-flash-preview', providerRequestMade: true,
        quota: { scope: 'user_utc_day', userDigest: HASH('b'), utcDate: '2026-09-07', limit: 20, requestNumber: ordinal },
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
      model: { const: 'gemini-3-flash-preview' }, uncachedRequestsPerUserUtcDay: { const: 20 },
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
    expect(holdProblems(relabeled)).toMatch(/receipt\.observedJourney must be "focus_points"/);
    expect(holdProblems(relabeled)).toMatch(/must link decoded objective journey telemetry/);
    const wrongSession = validEvidence();
    wrongSession.candidateEvidence[0].persistedSessionId = '99999999-9999-4999-8999-999999999999';
    expect(holdProblems(wrongSession)).toMatch(/persistedSessionId|persisted session/);
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
    tooMany.geminiEvidence[0].quota.requestNumber = 21;
    tooMany.geminiEvidence[0].output.whatToImproveWhitespaceWords = 7;
    expect(holdProblems(tooMany)).toMatch(/requestNumber must be between 1 and 20/);
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

    it('CASUALTY: the observer session binding must match the packet row', () => {
      const evidence = rewriteReceipt(validEvidence(), 4, 'wrong-binding', (receipt) => { receipt.sessionBindingSha256 = HASH('e'); });
      expect(holdProblems(evidence)).toMatch(/candidateEvidence\[4\]\.receipt\.sessionBindingSha256 must be/);
    });
  });

  it('rejects unknown fields instead of silently accepting drifted evidence', () => {
    const evidence = validEvidence(); evidence.selection.winner = COMPARISON_CANDIDATES[0];
    expect(holdProblems(evidence)).toMatch(/selection\.winner is not allowed/);
  });
});
