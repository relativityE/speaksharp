import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPARISON_CANDIDATES,
  LOCKED_GEMINI_CONTRACT,
  MODEL_DOWNSELECTION_SCHEMA_VERSION,
  PRODUCTION_ORIGIN,
  REQUIRED_JOURNEYS,
  validateModelDownselectionEvidence,
} from '../../scripts/human-test/modelDownselectionEvidence.mjs';

const RELEASE = 'a'.repeat(40);
const HASH = (character) => character.repeat(64);
const ISO = '2026-09-07T12:00:00.000Z';
const takeKey = (candidate, journey) => `${candidate}/${journey}`;

function validEvidence() {
  const candidateEvidence = [];
  const events = [{
    uuid: 'event-positive-control',
    event: 'telemetry_positive_control',
    releaseSha: RELEASE,
    candidateId: null,
    journeyId: 'boot-journey',
    attemptId: null,
    attemptSeq: 0,
    wordCount: null,
    controlNonce: 'pc-test-nonce',
    transportInitialized: true,
  }];
  const geminiEvidence = [];
  let ordinal = 0;

  for (const candidateId of COMPARISON_CANDIDATES) {
    for (const journey of REQUIRED_JOURNEYS) {
      ordinal += 1;
      const journeyId = `journey-${ordinal}`;
      const attemptId = `attempt-${ordinal}`;
      const key = takeKey(candidateId, journey);
      candidateEvidence.push({
        candidateId,
        journey,
        journeyId,
        attemptId,
        attemptSeq: 1,
        receipt: {
          verdict: 'PASS',
          holdKind: null,
          dryRun: false,
          targetOrigin: PRODUCTION_ORIGIN,
          releaseSha: RELEASE,
          expectedCandidate: candidateId,
          requestedCandidate: candidateId,
          observedCandidate: candidateId,
          capturedAt: ISO,
          receiptSha256: ordinal.toString(16).padStart(64, '0'),
        },
      });
      for (const event of ['session_started', 'session_saved']) {
        events.push({
          uuid: `${event}-${ordinal}`,
          event,
          releaseSha: RELEASE,
          candidateId,
          journeyId,
          attemptId,
          attemptSeq: 1,
          wordCount: event === 'session_saved' ? 42 : null,
          controlNonce: null,
          transportInitialized: null,
        });
      }
      geminiEvidence.push({
        takeKey: key,
        source: 'fresh',
        model: 'gemini-3.6-flash',
        providerRequestMade: true,
        quota: {
          scope: 'user_utc_day',
          userDigest: HASH('b'),
          utcDate: '2026-09-07',
          limit: 10,
          requestNumber: ordinal,
        },
        output: {
          whatWorkedItems: 1,
          whatToImproveItems: 1,
          whatWorkedWhitespaceWords: 5,
          whatToImproveWhitespaceWords: 6,
          readable: true,
          suggestionDigest: ordinal.toString(16).padStart(64, 'f'),
        },
      });
    }
  }

  const first = geminiEvidence[0];
  geminiEvidence.push({
    ...structuredClone(first),
    source: 'cached',
    providerRequestMade: false,
    quota: null,
  });

  return {
    schemaVersion: MODEL_DOWNSELECTION_SCHEMA_VERSION,
    environment: { origin: PRODUCTION_ORIGIN, releaseSha: RELEASE },
    geminiContract: { ...LOCKED_GEMINI_CONTRACT },
    telemetryReadback: {
      source: 'posthog_decoded_readback',
      queryId: 'posthog-query-1432',
      decodedAt: ISO,
      positiveControlNonce: 'pc-test-nonce',
      events,
    },
    candidateEvidence,
    geminiEvidence,
    selection: {
      status: 'selected',
      primary: COMPARISON_CANDIDATES[0],
      fallback: COMPARISON_CANDIDATES[1],
      sitsOut: COMPARISON_CANDIDATES[2],
      decidedBy: 'product_owner',
      decidedAt: ISO,
      decisionEvidenceDigest: HASH('c'),
    },
  };
}

const holdProblems = (value) => {
  const result = validateModelDownselectionEvidence(value);
  expect(result.verdict).toBe('HOLD');
  return result.problems.join('\n');
};

describe('#1432 F-17 model-downselection evidence contract', () => {
  it('accepts a complete synthetic contract fixture without selecting a model in production', () => {
    expect(validateModelDownselectionEvidence(validEvidence())).toEqual({ verdict: 'PASS', problems: [] });
  });

  it('keeps the committed template empty and held for the PO test', () => {
    const template = JSON.parse(readFileSync(
      'product_release/evidence/human-test/model-downselection.template.json',
      'utf8',
    ));
    const problems = holdProblems(template);
    expect(template.selection).toEqual({
      status: 'pending_po_test',
      primary: null,
      fallback: null,
      sitsOut: null,
      decidedBy: null,
      decidedAt: null,
      decisionEvidenceDigest: null,
    });
    expect(problems).toMatch(/pending the Product Owner real-world CDP test/);
    expect(problems).toMatch(/candidateEvidence is missing v2:base\.en\/open_mic/);
  });

  it('pins the JSON schema to the same slate and Gemini contract', () => {
    const schema = JSON.parse(readFileSync(
      'product_release/evidence/human-test/model-downselection.schema.json',
      'utf8',
    ));
    expect(schema.properties.schemaVersion.const).toBe(MODEL_DOWNSELECTION_SCHEMA_VERSION);
    expect(schema.$defs.candidate.enum).toEqual(COMPARISON_CANDIDATES);
    expect(schema.properties.geminiContract.properties).toMatchObject({
      model: { const: 'gemini-3.6-flash' },
      uncachedRequestsPerUserUtcDay: { const: 10 },
      whatWorkedItems: { const: 1 },
      whatToImproveItems: { const: 1 },
      maxWhitespaceWordsPerPhrase: { const: 6 },
      cachedResultsReadable: { const: true },
    });
  });

  it('fails closed on missing, duplicate, or reused candidate evidence', () => {
    const missing = validEvidence();
    missing.candidateEvidence.pop();
    expect(holdProblems(missing)).toMatch(/candidateEvidence is missing moonshine:streaming-medium\/focus_points/);

    const duplicate = validEvidence();
    duplicate.candidateEvidence[5] = structuredClone(duplicate.candidateEvidence[0]);
    expect(holdProblems(duplicate)).toMatch(/duplicates v2:base\.en\/open_mic/);

    const reusedReceipt = validEvidence();
    reusedReceipt.candidateEvidence[1].receipt.receiptSha256 =
      reusedReceipt.candidateEvidence[0].receipt.receiptSha256;
    expect(holdProblems(reusedReceipt)).toMatch(/reuses observer receipt/);
  });

  it('rejects an untrusted observer receipt and requested-vs-observed mismatch', () => {
    const dry = validEvidence();
    dry.candidateEvidence[0].receipt.dryRun = true;
    expect(holdProblems(dry)).toMatch(/receipt\.dryRun must be false/);

    const local = validEvidence();
    local.candidateEvidence[0].receipt.targetOrigin = 'http://127.0.0.1:5174';
    expect(holdProblems(local)).toMatch(/receipt\.targetOrigin/);

    const mismatched = validEvidence();
    mismatched.candidateEvidence[0].receipt.observedCandidate = COMPARISON_CANDIDATES[1];
    expect(holdProblems(mismatched)).toMatch(/receipt\.observedCandidate must be "v2:base\.en"/);
  });

  it('requires decoded PostHog linkage, a positive control, and unique event receipts', () => {
    const source = validEvidence();
    source.telemetryReadback.source = 'client_claim';
    expect(holdProblems(source)).toMatch(/source must be "posthog_decoded_readback"/);

    const unlinked = validEvidence();
    unlinked.telemetryReadback.events = unlinked.telemetryReadback.events.filter(
      (event) => !(event.event === 'session_saved' && event.attemptId === 'attempt-1'),
    );
    expect(holdProblems(unlinked)).toMatch(/must link exactly one decoded session_saved event/);

    const emptyDecode = validEvidence();
    emptyDecode.telemetryReadback.events.find(
      (event) => event.event === 'session_saved' && event.attemptId === 'attempt-1',
    ).wordCount = 0;
    expect(holdProblems(emptyDecode)).toMatch(/must prove a non-empty decoded transcript/);

    const duplicate = validEvidence();
    duplicate.telemetryReadback.events[2].uuid = duplicate.telemetryReadback.events[1].uuid;
    expect(holdProblems(duplicate)).toMatch(/uuid duplicates/);

    const noControl = validEvidence();
    noControl.telemetryReadback.events.shift();
    expect(holdProblems(noControl)).toMatch(/exactly one telemetry_positive_control/);
  });

  it('enforces the locked Gemini model, quota, 1+1 shape, six-word ceiling, and cache replay', () => {
    const model = validEvidence();
    model.geminiContract.model = 'another-model';
    expect(holdProblems(model)).toMatch(/geminiContract\.model must be "gemini-3\.6-flash"/);

    const tooMany = validEvidence();
    tooMany.geminiEvidence[0].quota.requestNumber = 11;
    tooMany.geminiEvidence[0].output.whatToImproveWhitespaceWords = 7;
    const tooManyProblems = holdProblems(tooMany);
    expect(tooManyProblems).toMatch(/requestNumber must be between 1 and 10/);
    expect(tooManyProblems).toMatch(/whatToImproveWhitespaceWords must be between 1 and 6/);

    const wrongShape = validEvidence();
    wrongShape.geminiEvidence[0].output.whatWorkedItems = 2;
    expect(holdProblems(wrongShape)).toMatch(/whatWorkedItems must be 1/);

    const noCache = validEvidence();
    noCache.geminiEvidence.pop();
    expect(holdProblems(noCache)).toMatch(/readable cache replay with no provider request/);

    const regeneratedCache = validEvidence();
    regeneratedCache.geminiEvidence.at(-1).providerRequestMade = true;
    expect(holdProblems(regeneratedCache)).toMatch(/providerRequestMade must be false/);
  });

  it('does not permit a decision without all three explicit, distinct PO-owned roles', () => {
    const pending = validEvidence();
    pending.selection = {
      status: 'pending_po_test',
      primary: null,
      fallback: null,
      sitsOut: null,
      decidedBy: null,
      decidedAt: null,
      decisionEvidenceDigest: null,
    };
    expect(holdProblems(pending)).toMatch(/pending the Product Owner real-world CDP test/);

    const duplicate = validEvidence();
    duplicate.selection.fallback = duplicate.selection.primary;
    expect(holdProblems(duplicate)).toMatch(/must be distinct/);

    const unauthorized = validEvidence();
    unauthorized.selection.decidedBy = 'developer';
    expect(holdProblems(unauthorized)).toMatch(/decidedBy must be "product_owner"/);
  });

  it('rejects unknown fields instead of silently accepting a drifted evidence shape', () => {
    const evidence = validEvidence();
    evidence.selection.winner = COMPARISON_CANDIDATES[0];
    expect(holdProblems(evidence)).toMatch(/selection\.winner is not allowed/);
  });
});
