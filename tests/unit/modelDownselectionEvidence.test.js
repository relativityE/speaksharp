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

const RELEASE = 'a'.repeat(40);
const HASH = (character) => character.repeat(64);
const ISO = '2026-09-07T12:00:00.000Z';
const EVIDENCE_DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_DIR = mkdtempSync(join(tmpdir(), 'speaksharp-model-evidence-'));
const LIVE_APPROVALS = new Map();
const LIVE_TELEMETRY = new Map();
let LIVE_GEMINI = [];
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
  const events = [{
    uuid: 'event-positive-control', event: 'telemetry_positive_control', releaseSha: RELEASE,
    candidateId: null, productMode: null, journeyId: 'boot-journey', attemptId: null, attemptSeq: 0,
    wordCount: null, controlNonce: 'pc-test-nonce', transportInitialized: true,
    evidenceDocumentId: null, sessionBindingSha256: null,
  }];
  const geminiEvidence = [];
  let ordinal = 0;

  for (const candidateId of COMPARISON_CANDIDATES) {
    for (const journey of REQUIRED_JOURNEYS) {
      ordinal += 1;
      const journeyId = `journey-${ordinal}`;
      const attemptId = `attempt-${ordinal}`;
      const persistedSessionId = `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
      const controlNonce = `comparison-nonce-${ordinal}`;
      const receipt = writeArtifact(`receipt-${suffix}-${ordinal}.json`, {
        verdict: 'PASS', holdKind: null, dryRun: false,
        target: { origin: PRODUCTION_ORIGIN }, release: RELEASE,
        expectedCandidate: candidateId, requestedCandidate: candidateId, observedCandidate: candidateId,
        observedJourney: journey, controlNonce, evidenceDocumentId: EVIDENCE_DOCUMENT_ID,
        persistedSessionId, capturedAt: ISO,
      });
      candidateEvidence.push({
        releaseSha: RELEASE, candidateId, journey, journeyId, attemptId, attemptSeq: 1,
        controlNonce, persistedSessionId,
        receiptArtifact: receipt.path, receiptSha256: receipt.digest,
      });
      events.push({
        uuid: `journey-${ordinal}`, event: 'practice_mode_selected', releaseSha: RELEASE,
        candidateId: null, productMode: journey === 'focus_points' ? 'objective' : 'quick', journeyId,
        attemptId: null, attemptSeq: 0, wordCount: null, controlNonce: null, transportInitialized: null,
        evidenceDocumentId: null, sessionBindingSha256: null,
      });
      for (const event of ['session_started', 'session_saved']) {
        events.push({
          uuid: `${event}-${ordinal}`, event, releaseSha: RELEASE, candidateId, productMode: null, journeyId,
          attemptId, attemptSeq: 1, wordCount: event === 'session_saved' ? 42 : null,
          controlNonce, transportInitialized: null, evidenceDocumentId: EVIDENCE_DOCUMENT_ID,
          sessionBindingSha256: event === 'session_saved'
            ? modelComparisonSessionBindingSha256(controlNonce, persistedSessionId) : null,
        });
      }
      geminiEvidence.push({
        releaseSha: RELEASE, candidateId, journey, journeyId, attemptId, attemptSeq: 1,
        controlNonce, persistedSessionId, receiptSha256: receipt.digest,
        source: 'fresh', model: 'gemini-3.6-flash', providerRequestMade: true,
        quota: { scope: 'user_utc_day', userDigest: HASH('b'), utcDate: '2026-09-07', limit: 10, requestNumber: ordinal },
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
      positiveControlNonce: 'pc-test-nonce', events,
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

const holdProblems = (value) => {
  const result = validateModelDownselectionEvidence(value, {
    baseDir: ARTIFACT_DIR,
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
      model: { const: 'gemini-3.6-flash' }, uncachedRequestsPerUserUtcDay: { const: 10 },
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

  it('joins each observer receipt to lifecycle telemetry through its signed control nonce', () => {
    const evidence = validEvidence();
    evidence.telemetryReadback.events.find(
      (event) => event.event === 'session_saved' && event.attemptId === 'attempt-1',
    ).controlNonce = 'another-signed-run';
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
    expect(holdProblems(evidence)).toMatch(/must link exactly one decoded session_saved/);
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

  it('CASUALTY: rejects contributor-authored PostHog rows that differ from authenticated readback', () => {
    const evidence = validEvidence();
    evidence.telemetryReadback.events.find((event) => event.event === 'session_saved').wordCount = 999;
    expect(holdProblems(evidence)).toMatch(/differs from authenticated PostHog authority/);
  });

  it('CASUALTY: rejects one signed comparison nonce reused for a second test row', () => {
    const evidence = validEvidence();
    evidence.candidateEvidence[1].controlNonce = evidence.candidateEvidence[0].controlNonce;
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
    tooMany.geminiEvidence[0].quota.requestNumber = 11;
    tooMany.geminiEvidence[0].output.whatToImproveWhitespaceWords = 7;
    expect(holdProblems(tooMany)).toMatch(/requestNumber must be between 1 and 10/);
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
  });

  it('fails closed when either independent authority resolver is absent', () => {
    const evidence = validEvidence();
    const result = validateModelDownselectionEvidence(evidence, {
      baseDir: ARTIFACT_DIR,
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

  it('rejects unknown fields instead of silently accepting drifted evidence', () => {
    const evidence = validEvidence(); evidence.selection.winner = COMPARISON_CANDIDATES[0];
    expect(holdProblems(evidence)).toMatch(/selection\.winner is not allowed/);
  });
});
