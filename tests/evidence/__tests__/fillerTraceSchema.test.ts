import { describe, it, expect } from 'vitest';
import {
  buildFillerTraceRow,
  evaluateTraceSet,
  type FixtureProvenance,
  type RouteProvenance,
  type StageTrace,
} from '../fillerTraceSchema';

/**
 * #1325 falsification tests for the evidence schema.
 *
 * Covers mutant 9 (preflight/local evidence mislabeled as deployed acceptance) and mutant 10
 * (downstream stop/finalized/persisted/rendered counts disagree but the packet still passes),
 * plus the fixture contract the human recording must satisfy before it can qualify.
 */

const humanFixture = (over: Partial<FixtureProvenance> = {}): FixtureProvenance => ({
  fixtureId: 'human-open-01',
  audioSha256: 'a'.repeat(64),
  referenceTranscript: 'um I think we should review the plan today',
  expectedFillers: ['um'],
  consentedHuman: true,
  naturalHesitation: true,
  ...over,
});

const deployedRoute = (over: Partial<RouteProvenance> = {}): RouteProvenance => ({
  evidenceClass: 'deployed-authoritative',
  releaseSha: '54195a5e7460aa1678e4029f2113e28024aacd15',
  browser: 'Chrome/140',
  os: 'macOS',
  modelName: 'whisper-base.en',
  modelRevision: '95bf40a508535962c6483ead40270b2e32267508',
  zeroRetiredProviderRequests: true,
  ...over,
});

const stages = (over: Partial<StageTrace> = {}): StageTrace => ({
  pcmSha256: 'b'.repeat(64),
  pcmSampleCount: 48_000,
  pcmDurationSeconds: 3,
  interimHypotheses: ['um I think', 'um I think we should'],
  finalHypothesis: 'um I think we should review the plan today',
  fillerCountTransitions: [{ um: 1 }],
  stopSnapshot: { um: 1 },
  usedLiveSnapshot: true,
  persistedSnapshot: { um: 1 },
  displayedTotal: 1,
  displayedChipSum: 1,
  lifecycleComplete: true,
  ...over,
});

describe('#1325 fillerTraceSchema — evidence classification and stop rules', () => {
  // ---- Mutant 9: preflight must never be accepted as deployed evidence ----
  describe('harness mutant: local preflight cannot satisfy deployed acceptance', () => {
    it('rejects a set built only from local-preflight rows', () => {
      const rows = [1, 2, 3].map((replay) =>
        buildFillerTraceRow({
          fixture: humanFixture(),
          route: deployedRoute({ evidenceClass: 'local-preflight' }),
          replay,
          stages: stages(),
        }),
      );
      const verdict = evaluateTraceSet(rows);
      expect(verdict.accepted).toBe(false);
      expect(verdict.reasons.join(' ')).toMatch(/no_deployed_authoritative_rows/);
    });

    it('preserves the evidence class on every row so a preflight row cannot be relabeled downstream', () => {
      const row = buildFillerTraceRow({
        fixture: humanFixture(),
        route: deployedRoute({ evidenceClass: 'local-preflight' }),
        replay: 1,
        stages: stages(),
      });
      expect(row.route.evidenceClass).toBe('local-preflight');
    });
  });

  // ---- Mutant 10: downstream disagreement must fail, never pass ----
  describe('downstream mismatch mutant: chain disagreement always fails', () => {
    it.each([
      ['persisted', { persistedSnapshot: { um: 2 } }],
      ['displayed total', { displayedTotal: 2 }],
      ['displayed chip sum', { displayedChipSum: 0 }],
    ])('fails when the %s disagrees with the stop snapshot', (_label, override) => {
      const row = buildFillerTraceRow({
        fixture: humanFixture(),
        route: deployedRoute(),
        replay: 1,
        stages: stages(override as Partial<StageTrace>),
      });
      expect(row.chainConsistent).toBe(false);
      expect(row.stopRuleViolations).toContain('chain_value_disagreement');
      expect(row.failureBoundary).toBe('display-or-save');
      expect(evaluateTraceSet([row]).accepted).toBe(false);
    });

    it('passes chain consistency only when every downstream value matches exactly', () => {
      const row = buildFillerTraceRow({
        fixture: humanFixture(),
        route: deployedRoute(),
        replay: 1,
        stages: stages(),
      });
      expect(row.chainConsistent).toBe(true);
      expect(row.stopRuleViolations).toEqual([]);
      expect(row.failureBoundary).toBe('none');
    });
  });

  // ---- Failure-boundary classification selects the remediation rung ----
  describe('failure boundary selects the remediation rung from the trace, not a guess', () => {
    it('classifies missing PCM as a capture failure (rung A)', () => {
      const row = buildFillerTraceRow({
        fixture: humanFixture(),
        route: deployedRoute(),
        replay: 1,
        stages: stages({ pcmSha256: null, pcmSampleCount: 0 }),
      });
      expect(row.failureBoundary).toBe('pcm-capture');
    });

    it('classifies "never emitted in interim OR final" as recognition (rung D/E)', () => {
      const row = buildFillerTraceRow({
        fixture: humanFixture(),
        route: deployedRoute(),
        replay: 1,
        stages: stages({
          interimHypotheses: ["so I'm I think"],
          finalHypothesis: "So I'm I think we should review the plan today",
          stopSnapshot: { um: 0 },
          persistedSnapshot: { um: 0 },
          displayedTotal: 0,
          displayedChipSum: 0,
        }),
      });
      expect(row.failureBoundary).toBe('recognition');
    });

    it('classifies "emitted in interim but lost from the snapshot" as interim-evidence-lost (rung B)', () => {
      const row = buildFillerTraceRow({
        fixture: humanFixture(),
        route: deployedRoute(),
        replay: 1,
        stages: stages({
          // The filler WAS recognized in an interim hypothesis...
          interimHypotheses: ['um I think'],
          // ...the final dropped it, and the canonical snapshot kept nothing.
          finalHypothesis: 'I think we should review the plan today',
          stopSnapshot: { um: 0 },
          persistedSnapshot: { um: 0 },
          displayedTotal: 0,
          displayedChipSum: 0,
        }),
      });
      expect(row.failureBoundary).toBe('interim-evidence-lost');
    });

    it('fails closed as unmeasurable when nothing was recognized at all', () => {
      const row = buildFillerTraceRow({
        fixture: humanFixture(),
        route: deployedRoute(),
        replay: 1,
        stages: stages({ interimHypotheses: [], finalHypothesis: null }),
      });
      expect(row.failureBoundary).toBe('unmeasurable');
    });
  });

  // ---- Stop rules ----
  describe('falsifiable stop rules', () => {
    it('fails a matched no-filler negative that manufactures a filler', () => {
      const row = buildFillerTraceRow({
        fixture: humanFixture({
          fixtureId: 'human-negative-01',
          referenceTranscript: 'I think we should review the plan today',
          expectedFillers: [],
        }),
        route: deployedRoute(),
        replay: 1,
        stages: stages({
          interimHypotheses: ['I think'],
          finalHypothesis: 'I think we should review the plan today',
          stopSnapshot: { um: 1 },
          persistedSnapshot: { um: 1 },
          displayedTotal: 1,
          displayedChipSum: 1,
        }),
      });
      expect(row.stopRuleViolations).toContain('false_filler_on_negative');
    });

    it('fails an incomplete lifecycle and a retired-provider request', () => {
      const row = buildFillerTraceRow({
        fixture: humanFixture(),
        route: deployedRoute({ zeroRetiredProviderRequests: false }),
        replay: 1,
        stages: stages({ lifecycleComplete: false }),
      });
      expect(row.stopRuleViolations).toContain('incomplete_stop_finalize_save_review');
      expect(row.stopRuleViolations).toContain('retired_provider_request_observed');
    });
  });

  // ---- Human fixture contract ----
  describe('human fixture contract is enforced before a set can qualify', () => {
    const buildSet = (fixture: FixtureProvenance, replays = 3) =>
      Array.from({ length: replays }, (_, i) =>
        buildFillerTraceRow({ fixture, route: deployedRoute(), replay: i + 1, stages: stages() }),
      );

    it('rejects a scripted "um" reading', () => {
      const verdict = evaluateTraceSet(buildSet(humanFixture({ naturalHesitation: false })));
      expect(verdict.reasons.join(' ')).toMatch(/scripted_um_reading_not_acceptable/);
    });

    it('rejects fewer than three replays', () => {
      const verdict = evaluateTraceSet(buildSet(humanFixture(), 2));
      expect(verdict.reasons.join(' ')).toMatch(/replays_2_lt_3/);
    });

    it('rejects a synthetic-only set (no consented human fixture)', () => {
      const verdict = evaluateTraceSet(buildSet(humanFixture({ consentedHuman: false })));
      expect(verdict.reasons.join(' ')).toMatch(/no_consented_human_fixture/);
    });

    it('rejects a set below the frozen 30 annotated true fillers', () => {
      const verdict = evaluateTraceSet(buildSet(humanFixture({ expectedFillers: ['um', 'uh'] })));
      expect(verdict.reasons.join(' ')).toMatch(/annotated_human_fillers_\d+_lt_30/);
    });

    it('rejects a set with no matched no-filler negative', () => {
      const fillers = Array.from({ length: 30 }, () => 'um');
      const verdict = evaluateTraceSet(buildSet(humanFixture({ expectedFillers: fillers })));
      expect(verdict.reasons.join(' ')).toMatch(/missing_matched_no_filler_negative/);
    });
  });
});
