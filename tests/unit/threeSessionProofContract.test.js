// #1306/#1338 — contract over the three-session production proof and its workflow.
//
// The proof itself is dispatch-only and writes to production, so CI can never execute it. Removing one
// of its load-bearing assertions would therefore go unnoticed until someone spent a production run to
// find out. These checks make each required assertion falsifiable in ordinary CI: delete the assertion
// and a test here fails.
//
// This is a structural contract, not a substitute for the proof. It says the claim is still being
// made; only the production dispatch can say the claim is true.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SPEC = readFileSync('tests/live/three-session-retention-proof.live.spec.ts', 'utf8');
const WORKFLOW = readFileSync('.github/workflows/three-session-retention-proof.yml', 'utf8');
const CLEANUP = readFileSync('tests/live/helpers/runOwnedCleanup.ts', 'utf8');
const BENCH = readFileSync('tests/live/helpers/benchmark-utils.ts', 'utf8');

describe('three-session production proof — assertion contract', () => {
  it('the scan is not vacuous', () => {
    expect(SPEC.length).toBeGreaterThan(4000);
    expect(WORKFLOW.length).toBeGreaterThan(2000);
  });

  it('BOTH retained sessions assert their OWN transcript reaches their OWN PDF', () => {
    // All three recordings share one audio fixture, but decode output is not guaranteed byte-identical,
    // so the newest transcript cannot stand in for the middle one.
    expect(SPEC).toMatch(/newestPdf\.includes\(newestText\)/);
    expect(SPEC).toMatch(/middlePdf\.includes\(middleText\)/);
    // ...read separately, not aliased to one another.
    expect(SPEC).toMatch(/const middleText\s*=\s*normalizeForMatch/);
    expect(SPEC).toMatch(/const newestText\s*=\s*normalizeForMatch/);
  });

  it('the expired session marker is proven absent from every produced artifact', () => {
    expect(SPEC).toMatch(/newestPdf\.includes\(ids\[0\]\)/);
    expect(SPEC).toMatch(/middlePdf\.includes\(ids\[0\]\)/);
  });

  it('ALL THREE rows structurally validate their next action, not just the expired one', () => {
    expect(SPEC).toMatch(/validateNextActionSignal/);
    // Iterates the full set rather than checking a single row.
    expect(SPEC).toMatch(/\[oldest,\s*middle,\s*newest\]\.entries\(\)/);
    // A rendered UI title is not evidence that the persisted signal is usable.
    expect(SPEC).toMatch(/session \$\{i \+ 1\} must retain a VALID next action/);
  });

  it('ALL THREE rows assert the named measurement fields', () => {
    for (const field of ['total_words', 'filler_counts', 'duration', 'status']) {
      expect(SPEC.includes(field), `${field} must be asserted`).toBe(true);
    }
    // The expired row additionally keeps its differential pre/post snapshot.
    expect(SPEC).toMatch(/oldestMetricsBeforeExpiry/);
  });

  it('response bodies are a deterministic bounded capture, not a raw length check', () => {
    // Playwright does not await an async response handler, so a synchronous length check can read a
    // set that is still being parsed.
    expect(SPEC).toMatch(/const settleCaptures/);
    expect(SPEC).toMatch(/await settleCaptures\(\)/);
    expect(SPEC).toMatch(/v2Parsing\.push/);
    // The exact-count assertion must be preceded by a bounded settle, not stand alone.
    const idx = SPEC.indexOf('rpcCalls.complete_session_v2');
    expect(SPEC.slice(0, idx)).toMatch(/await settleCaptures\(\)/);
  });

  it('exact v2/v1 call accounting is preserved', () => {
    // Exact counts, not ">= 3": a silent double-save must fail the proof.
    expect(SPEC).toMatch(/rpcCalls\.complete_session_v2,[\s\S]{0,120}?\.toBe\(3\)/);
    expect(SPEC).toMatch(/rpcCalls\.complete_session,[\s\S]{0,120}?\.toBe\(0\)/);
  });

  it('entitlement is gated before every recording from the server authority', () => {
    expect(SPEC).toMatch(/evaluateThreeRecordingEntitlement/);
    expect(SPEC).toMatch(/check-usage-limit/);
    expect(SPEC).toMatch(/can_start/);
  });

  it('cleanup emits an explicit machine-readable verdict only after residue is verified', () => {
    expect(CLEANUP).toMatch(/cleanup_verified/);
    expect(CLEANUP).toMatch(/cleanup_not_required/);
    // The verdict must come AFTER the residue readbacks, not before them.
    const residueIdx = CLEANUP.indexOf('no run-owned residue in trial_entitlements');
    const verdictIdx = CLEANUP.lastIndexOf("writeCleanupVerdict('cleanup_verified'");
    expect(residueIdx).toBeGreaterThan(0);
    expect(verdictIdx).toBeGreaterThan(residueIdx);
  });

  it('the workflow requires the cleanup verdict and fails closed without it', () => {
    expect(WORKFLOW).toMatch(/PROOF_CLEANUP_VERDICT_FILE/);
    expect(WORKFLOW).toMatch(/if: always\(\)/);
    // Missing file, empty file, and unrecognised token must each fail.
    expect(WORKFLOW).toMatch(/no cleanup verdict was written/);
    expect(WORKFLOW).toMatch(/cleanup verdict file is empty/);
    expect(WORKFLOW).toMatch(/unrecognised cleanup verdict/);
    // Proof outcome is evaluated separately, so cleanup success cannot mask a failed proof.
    expect(WORKFLOW).toMatch(/steps\.proof\.outcome/);
  });

  it('the acquisition verdict keys on STATUS, never on the worker-blind request counters', () => {
    // Measured, not assumed: during a production load that reached `ready`, neither a window.fetch
    // patch nor a main-thread PerformanceObserver saw a single /models/ request, because the model
    // loads in a Worker. A verdict keyed on those counts would report "acquisition never started" for
    // a run that acquired the model perfectly.
    const diagnosis = SPEC.slice(SPEC.indexOf('verdictHint'), SPEC.indexOf('verdictHint') + 600);
    expect(diagnosis).not.toMatch(/modelRequests\.length === 0/);
    expect(diagnosis).toMatch(/reachedReady/);
    // The counters may still be REPORTED, but must be labelled so no reader treats a zero as evidence.
    expect(SPEC).toMatch(/InformationalOnly/);
    expect(SPEC).toMatch(/requestCountersAreWorkerBlind/);
  });

  it('the ACTUAL setup CTA is exercised and its before/after status recorded', () => {
    // The closure contract requires the real customer path, not a bypass. A before/after pair around
    // the CTA separates "the click did nothing" from "the click started work that then failed".
    expect(SPEC).toMatch(/statusBeforeCta/);
    expect(SPEC).toMatch(/statusAfterCta/);
    expect(SPEC).toMatch(/ctaRequired/);
    // And when setup was required, staying at download-required must FAIL — that is the
    // customer-visible "button does nothing" outcome.
    expect(SPEC).toMatch(/\.not\.toBe\('download-required'\)/);
  });

  // ADVISORY BACKSTOP ONLY. What QUALIFIES the desktop journey is behavioral:
  //   - tests/unit/benchmarkHarnessControls.test.ts EXECUTES the live helpers against a DOM holding
  //     only the controls the product renders, and falsifies each stale selector; and
  //   - MicCard/RecorderBar rendered-state tests pin tests/helpers/micControls.ts to the components.
  // A source scan could never have caught this defect — `session-start-stop-button` exists as a
  // constant, so scanning for it passed while it rendered on no viewport. These two checks only catch
  // a careless re-introduction early; they are not evidence that the journey works.
  it('[advisory] the proof path has ZERO executable uses of the retired combined control', () => {
    for (const [name, body] of [['spec', SPEC], ['benchmark-utils', BENCH]]) {
      const executable = body
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
      expect(executable, `${name} must not target the retired combined control`)
        .not.toMatch(/(getByTestId|locator|querySelector)\([^)]*session-start-stop-button/);
    }
  });

  it('[advisory] the journey asserts rendered state, not an attribute on an unmounted control', () => {
    // Stopping unmounts RecorderBar, so `data-recording` on the stopped control is an assertion about
    // an element that no longer exists — and no desktop control carries that attribute at all.
    const strip = (body) => body.split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(strip(SPEC)).not.toMatch(/toHaveAttribute\('data-recording'/);
    expect(strip(BENCH)).not.toMatch(/getByLabel\(\/Stop Recording/);
    expect(SPEC).toMatch(/expectMicControlForState/);
    expect(SPEC).toMatch(/stopBenchmarkRecording/);
  });

  it('production authority gates are unchanged', () => {
    expect(WORKFLOW).toMatch(/must be dispatched from the default branch/);
    expect(WORKFLOW).toMatch(/exact production-data authorization phrase/);
    expect(WORKFLOW).toMatch(/\^\[0-9a-f\]\{40\}\$/);
  });
});
