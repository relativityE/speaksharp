import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFillerTraceRow,
  classifyHarnessTarget,
  isValidFillerCountEvent,
  evaluateTraceSet,
  type FixtureProvenance,
  type RouteProvenance,
  type StageTrace,
} from '../fillerTraceSchema';

const testDir = dirname(fileURLToPath(import.meta.url));

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
  finalHypothesis: 'um I think we should review the plan today',
  fillerCountEvents: [
    { seq: 0, relativeMs: 10, phase: 'interim_observed', counts: { um: 1, uh: 0, ah: 0, custom_total: 0 } },
    { seq: 1, relativeMs: 20, phase: 'final_observed', counts: { um: 1, uh: 0, ah: 0, custom_total: 0 } },
    { seq: 2, relativeMs: 30, phase: 'combined', counts: { um: 1, uh: 0, ah: 0, custom_total: 0 } },
  ],
  stopSnapshot: { um: 1 },
  usedLiveSnapshot: true,
  finalizedSnapshot: { um: 1 },
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

  // ---- Mutant 9 at the REAL harness boundary: classification must be reachable AND fail closed ----
  describe('harness target classification (the boundary the proof script uses)', () => {
    const base = {
      authMode: 'real' as const,
      supabaseConfigured: true,
      deployedHostAllowlist: ['speaksharp-public.vercel.app'],
      expectedReleaseSha: '54195a5e7460aa1678e4029f2113e28024aacd15',
    };

    it('classifies a valid localhost:5174 target as local-preflight, never authoritative', () => {
      const r = classifyHarnessTarget({ ...base, url: 'http://localhost:5174/session' });
      expect(r.evidenceClass).toBe('local-preflight');
      expect(r.localPreflightEligible).toBe(true);
      expect(r.deployedAcceptanceEligible).toBe(false);
      expect(r.invalidReasons).toEqual([]);
    });

    it('DEPLOYED classification is reachable for a valid https allowlisted target', () => {
      const r = classifyHarnessTarget({
        ...base,
        url: 'https://speaksharp-public.vercel.app/session',
        liveReleaseSha: base.expectedReleaseSha,
      });
      expect(r.evidenceClass).toBe('deployed-authoritative');
      expect(r.deployedAcceptanceEligible).toBe(true);
      expect(r.invalidReasons).toEqual([]);
    });

    it('rejects a release SHA mismatch (a stale bundle never qualifies)', () => {
      const r = classifyHarnessTarget({
        ...base,
        url: 'https://speaksharp-public.vercel.app/session',
        liveReleaseSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      });
      expect(r.deployedAcceptanceEligible).toBe(false);
      expect(r.invalidReasons).toContain('release_sha_mismatch');
    });

    it.each([
      ['http (not https)', 'http://speaksharp-public.vercel.app/session', 'not_https'],
      ['unallowlisted host', 'https://evil.example.com/session', 'host_evil.example.com_not_allowlisted'],
    ])('rejects a deployed target with %s', (_label, url, reason) => {
      const r = classifyHarnessTarget({ ...base, url, liveReleaseSha: base.expectedReleaseSha });
      expect(r.deployedAcceptanceEligible).toBe(false);
      expect(r.invalidReasons).toContain(reason);
    });

    it('rejects a deployed target with no expected release SHA configured', () => {
      const r = classifyHarnessTarget({
        ...base,
        url: 'https://speaksharp-public.vercel.app/session',
        expectedReleaseSha: null,
      });
      expect(r.deployedAcceptanceEligible).toBe(false);
      expect(r.invalidReasons).toContain('missing_expected_release_sha');
    });

    /**
     * §13 BEHAVIORAL PARITY (replaces token-grep as the authority).
     *
     * The harness runs under plain `node` and cannot import this TypeScript module, so it
     * reimplements the classification rules. Grepping its source proves nothing about behavior, so we
     * EXECUTE its classifier over a shared adversarial case table (`--classifier-selftest`) and
     * compare complete normalized outputs. Changing only one implementation breaks this test.
     *
     * Running the real script also exercises harness module initialization, so a TDZ/runtime defect
     * cannot hide behind `node --check` (which proves syntax only).
     */
    it('harness classifier is BEHAVIORALLY identical to the TypeScript classifier', () => {
      const harnessPath = resolve(testDir, '../../../scripts/manual-stt-corpus-proof.mjs');
      const raw = execFileSync('node', [harnessPath, '--classifier-selftest'], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      const harnessResults = JSON.parse(raw) as Array<{
        name: string;
        result: ReturnType<typeof classifyHarnessTarget>;
      }>;

      expect(harnessResults.length).toBeGreaterThanOrEqual(8);

      // Same case table, evaluated by the TypeScript classifier.
      const cases: Record<string, Parameters<typeof classifyHarnessTarget>[0]> = {
        valid_localhost: { url: 'http://localhost:5174/session', authMode: 'real', supabaseConfigured: true, deployedHostAllowlist: ['speaksharp-public.vercel.app'], expectedReleaseSha: 'sha-expected' },
        valid_deployed: { url: 'https://speaksharp-public.vercel.app/session', authMode: 'real', supabaseConfigured: true, deployedHostAllowlist: ['speaksharp-public.vercel.app'], expectedReleaseSha: 'sha-expected', liveReleaseSha: 'sha-expected' },
        mock_auth_local: { url: 'http://localhost:5174/session', authMode: 'mock', supabaseConfigured: true, deployedHostAllowlist: ['speaksharp-public.vercel.app'], expectedReleaseSha: 'sha-expected' },
        mock_auth_deployed: { url: 'https://speaksharp-public.vercel.app/session', authMode: 'mock', supabaseConfigured: true, deployedHostAllowlist: ['speaksharp-public.vercel.app'], expectedReleaseSha: 'sha-expected', liveReleaseSha: 'sha-expected' },
        http_deployed: { url: 'http://speaksharp-public.vercel.app/session', authMode: 'real', supabaseConfigured: true, deployedHostAllowlist: ['speaksharp-public.vercel.app'], expectedReleaseSha: 'sha-expected', liveReleaseSha: 'sha-expected' },
        unallowlisted_host: { url: 'https://evil.example.com/session', authMode: 'real', supabaseConfigured: true, deployedHostAllowlist: ['speaksharp-public.vercel.app'], expectedReleaseSha: 'sha-expected', liveReleaseSha: 'sha-expected' },
        missing_expected_sha: { url: 'https://speaksharp-public.vercel.app/session', authMode: 'real', supabaseConfigured: true, deployedHostAllowlist: ['speaksharp-public.vercel.app'], expectedReleaseSha: null, liveReleaseSha: 'sha-live' },
        missing_live_sha: { url: 'https://speaksharp-public.vercel.app/session', authMode: 'real', supabaseConfigured: true, deployedHostAllowlist: ['speaksharp-public.vercel.app'], expectedReleaseSha: 'sha-expected', liveReleaseSha: null },
        mismatched_live_sha: { url: 'https://speaksharp-public.vercel.app/session', authMode: 'real', supabaseConfigured: true, deployedHostAllowlist: ['speaksharp-public.vercel.app'], expectedReleaseSha: 'sha-expected', liveReleaseSha: 'sha-other' },
        wrong_local_port: { url: 'http://localhost:5173/session', authMode: 'real', supabaseConfigured: true, deployedHostAllowlist: ['speaksharp-public.vercel.app'], expectedReleaseSha: 'sha-expected' },
      };

      for (const { name, result } of harnessResults) {
        const input = cases[name];
        expect(input, `harness case ${name} must exist in the TS table`).toBeDefined();
        const expected = classifyHarnessTarget(input);
        expect(result, `parity mismatch for case: ${name}`).toEqual({
          evidenceClass: expected.evidenceClass,
          localPreflightEligible: expected.localPreflightEligible,
          deployedAcceptanceEligible: expected.deployedAcceptanceEligible,
          invalidReasons: expected.invalidReasons,
        });
      }
    });

    // Source-token presence is retained ONLY as a smoke check; parity above is the authority.
    it('smoke: harness source still mentions the fail-closed rule tokens', () => {
      const harness = readFileSync(
        resolve(testDir, '../../../scripts/manual-stt-corpus-proof.mjs'),
        'utf8',
      );
      for (const token of ['DEPLOYED_RELEASE_MISMATCH', '__APP_RELEASE__']) {
        expect(harness).toContain(token);
      }
    });

    it('rejects mock auth for BOTH classes', () => {
      for (const url of ['http://localhost:5174/session', 'https://speaksharp-public.vercel.app/session']) {
        const r = classifyHarnessTarget({ ...base, url, authMode: 'mock', liveReleaseSha: base.expectedReleaseSha });
        expect(r.localPreflightEligible).toBe(false);
        expect(r.deployedAcceptanceEligible).toBe(false);
        expect(r.invalidReasons).toContain('auth_mock');
      }
    });
  });

  // ---- §10 mutants: the numbers-only contract is the filler authority ----
  describe('§10 numbers-only contract', () => {
    it('rejects an event carrying interim transcript text (schema is closed)', () => {
      const leaked = {
        seq: 0,
        relativeMs: 10,
        phase: 'interim_observed',
        counts: { um: 1, uh: 0, ah: 0, custom_total: 0 },
        interimHypothesis: 'so um I think',
      };
      expect(isValidFillerCountEvent(leaked)).toBe(false);
    });

    it('rejects string-valued counts and unknown phases at the schema boundary', () => {
      expect(isValidFillerCountEvent({
        seq: 0, relativeMs: 0, phase: 'combined', counts: { um: 'um', uh: 0, ah: 0, custom_total: 0 },
      })).toBe(false);
      expect(isValidFillerCountEvent({
        seq: 0, relativeMs: 0, phase: 'transcript', counts: { um: 1, uh: 0, ah: 0, custom_total: 0 },
      })).toBe(false);
      expect(isValidFillerCountEvent({
        seq: 0, relativeMs: 0, phase: 'combined', counts: { um: 1, uh: 0, ah: 0, custom_total: 0 },
      })).toBe(true);
    });

    it('scores recall from COUNTS, so a misheard-but-uncounted filler is a false negative regardless of transcript', () => {
      // The final hypothesis contains no filler text at all, but the counts say one was observed.
      // Transcript-regex scoring would report 0 recall; count-based scoring correctly reports 1/1.
      const row = buildFillerTraceRow({
        fixture: humanFixture(),
        route: deployedRoute(),
        replay: 1,
        stages: stages({ finalHypothesis: "So I'm I think we should review the plan today" }),
      });
      expect(row.filler?.truePositives).toBe(1);
      expect(row.filler?.recall).toBe(1);
    });

    it('counts over-reporting as a false positive (precision is measured, not assumed)', () => {
      const row = buildFillerTraceRow({
        fixture: humanFixture(), // expects exactly 1
        route: deployedRoute(),
        replay: 1,
        stages: stages({
          fillerCountEvents: [
            { seq: 0, relativeMs: 10, phase: 'combined', counts: { um: 3, uh: 0, ah: 0, custom_total: 0 } },
          ],
          stopSnapshot: { um: 3 },
          finalizedSnapshot: { um: 3 },
          persistedSnapshot: { um: 3 },
          displayedTotal: 3,
          displayedChipSum: 3,
        }),
      });
      expect(row.filler?.falsePositives).toBe(2);
      expect(row.filler?.precision).toBeCloseTo(1 / 3);
    });
  });

  // ---- §10: the FINALIZED snapshot is part of the enforced chain ----
  it('§10 fails when the finalized snapshot disagrees with the stop snapshot', () => {
    const row = buildFillerTraceRow({
      fixture: humanFixture(),
      route: deployedRoute(),
      replay: 1,
      stages: stages({ finalizedSnapshot: { um: 5 } }),
    });
    expect(row.chainConsistent).toBe(false);
    expect(row.stopRuleViolations).toContain('chain_value_disagreement');
    expect(row.failureBoundary).toBe('display-or-save');
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
          finalHypothesis: "So I'm I think we should review the plan today",
          // Executed, but NEVER counted a filler at any phase → recognition boundary.
          fillerCountEvents: [
            { seq: 0, relativeMs: 10, phase: 'interim_observed', counts: { um: 0, uh: 0, ah: 0, custom_total: 0 } },
            { seq: 1, relativeMs: 20, phase: 'final_observed', counts: { um: 0, uh: 0, ah: 0, custom_total: 0 } },
            { seq: 2, relativeMs: 30, phase: 'combined', counts: { um: 0, uh: 0, ah: 0, custom_total: 0 } },
          ],
          stopSnapshot: { um: 0 },
          finalizedSnapshot: { um: 0 },
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
          // The filler WAS counted in an interim transition...
          fillerCountEvents: [
            { seq: 0, relativeMs: 10, phase: 'interim_observed', counts: { um: 1, uh: 0, ah: 0, custom_total: 0 } },
            { seq: 1, relativeMs: 20, phase: 'final_observed', counts: { um: 0, uh: 0, ah: 0, custom_total: 0 } },
          ],
          // ...the final dropped it, and the canonical snapshot kept nothing.
          finalHypothesis: 'I think we should review the plan today',
          stopSnapshot: { um: 0 },
          finalizedSnapshot: { um: 0 },
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
        stages: stages({ fillerCountEvents: [], finalHypothesis: null }),
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
          finalHypothesis: 'I think we should review the plan today',
          fillerCountEvents: [
            { seq: 0, relativeMs: 10, phase: 'combined', counts: { um: 1, uh: 0, ah: 0, custom_total: 0 } },
          ],
          stopSnapshot: { um: 1 },
          finalizedSnapshot: { um: 1 },
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
