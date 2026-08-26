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
const STORAGE = readFileSync('frontend/src/lib/storage.ts', 'utf8');
const STATE_MIGRATION = readFileSync('backend/supabase/migrations/20260801000000_sessions_transcript_state.sql', 'utf8');
const PREFLIGHT = readFileSync('scripts/verify-read-authority.mjs', 'utf8');
const PREFLIGHT_WORKFLOW = readFileSync('.github/workflows/read-authority-preflight.yml', 'utf8');

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

  it('[advisory] the transcript assertion is SPLIT by lifecycle phase', () => {
    // Committed transcript is 0 by design while recording ("finalized when you stop"), so one
    // assertion cannot serve both phases. Attempt 6 failed on a healthy page showing 122 draft words.
    expect(SPEC).toMatch(/expectBenchmarkDraftActivity/);
    expect(SPEC).toMatch(/expectFinalizedTranscriptOutput/);
    // Finalized output is required only AFTER the save candidate exists.
    // lastIndexOf, not indexOf: the first hit for each name is the IMPORT list, whose order says
    // nothing about call order. Comparing those compared alphabetised imports, not the journey.
    const at = (name) => {
      const i = SPEC.lastIndexOf(`${name}(`);
      // -1 would silently satisfy "before stop", so a DELETED call must fail here, not pass.
      expect(i, `${name} must actually be CALLED, not merely imported`).toBeGreaterThan(-1);
      return i;
    };
    const stopIdx = at('stopBenchmarkRecording');
    expect(at('expectBenchmarkDraftActivity'), 'draft activity is asserted BEFORE stop').toBeLessThan(stopIdx);
    expect(at('expectFinalizedTranscriptOutput'), 'finalized output is asserted AFTER stop').toBeGreaterThan(stopIdx);
    // The retired single-phase assertion must not come back to this proof.
    expect(SPEC).not.toMatch(/expectBenchmarkTranscriptOutput/);
  });

  it('[advisory] the proof is not fed adversarially LOOPED audio', () => {
    // conv_01.wav is 3.56s and Chromium LOOPS fake-audio input, so a 60s recording replayed the same
    // 3.5s ~17 times — output indistinguishable from a model repetition loop.
    expect(SPEC).toMatch(/WASHINGTON_LONG_AUDIO/);
    expect(SPEC).not.toMatch(/FILLER_CONV_01_AUDIO/);
    expect(SPEC).not.toMatch(/HARVARD_BENCHMARK_LONG_AUDIO/);
  });

  it('[advisory] the proof reads the CURRENT during-state surface, not dead components', () => {
    // LiveTranscriptPanel and TranscriptPanel have no production render. Attempt 7 queried five of
    // their ids, found zero, and it was read as "the panel unmounted" — it had never been mounted.
    const cap = BENCH.slice(BENCH.indexOf('export async function captureTranscriptSurfaceDiagnostics'));
    const body = cap.slice(0, cap.indexOf('\nexport '));
    for (const id of ['SESSION_SHELL', 'TRANSCRIPT_CARD', 'TRANSCRIPT_LIVE_INDICATOR', 'LIVE_TRANSCRIPT']) {
      expect(body, `${id} must be part of the surface map`).toMatch(new RegExp(id));
    }
    // The dead ids may only appear as the RETIRED list, never as a live lookup.
    expect(body).toMatch(/retired/);
  });

  it('[advisory] the precondition snapshot is CONTENT-FREE at source', () => {
    // `logBenchmarkPhase` serialises this snapshot into the Actions log on SUCCESS paths, so any raw
    // field here is published on every healthy run. While the selector was dead it was accidentally
    // empty; pointing it at the real surface would have turned it into recognized speech.
    const fn = BENCH.slice(BENCH.indexOf('export async function collectBenchmarkPreconditionSnapshot'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    expect(body).toMatch(/transcriptChars/);
    expect(body).toMatch(/transcriptWords/);
    expect(body).toMatch(/bodyTextChars/);
    // The raw fields must not exist at all — a field that is absent cannot be forgotten.
    expect(body, 'no raw transcript field').not.toMatch(/^\s*transcript,\s*$/m);
    expect(body, 'no raw bodyText field').not.toMatch(/^\s*bodyText,\s*$/m);
    // Attached evidence is a downloadable artifact and must carry counts only.
    expect(BENCH, 'attached evidence must not write transcript text').not.toMatch(/transcriptText:/);
  });

  it('[advisory] transcript diagnostics are atomic and carry no transcript content', () => {
    expect(BENCH).toMatch(/captureTranscriptSurfaceDiagnostics/);
    expect(BENCH).toMatch(/TRANSCRIPT_SURFACE_DIAGNOSTICS/);
    // Shapes only: the capture must read lengths/counts, never push transcript text into evidence.
    const cap = BENCH.slice(BENCH.indexOf('export async function captureTranscriptSurfaceDiagnostics'));
    const body = cap.slice(0, cap.indexOf('\nexport '));
    expect(body).toMatch(/textContentLength/);
    expect(body).toMatch(/innerTextLength/);
    expect(body).toMatch(/childElementCount/);
    expect(body).toMatch(/isConnected/);
    // A read failure must PROPAGATE — no silent-empty catch inside the capture.
    expect(body, 'the capture must not swallow read errors').not.toMatch(/\.catch\(/);
  });

  it('[advisory] the v2 envelope is asserted PER RECORDING, before any row read', () => {
    // Attempt 8 captured all three envelopes but asserted them only after the retention step, so it
    // failed on a downstream row read without ever examining the most authoritative evidence.
    expect(SPEC).toMatch(/assertV2Envelope/);
    const perRecording = SPEC.lastIndexOf('await assertV2Envelope(ordinal, label);');
    const retentionStep = SPEC.indexOf('newest two retained, OLDEST evicted');
    expect(perRecording, 'the envelope must be asserted inside recordOneSession').toBeGreaterThan(-1);
    expect(perRecording, 'and BEFORE the retention step').toBeLessThan(retentionStep);
    // The three fields that make the contract atomic — asserted on the MAPPED values, which is why
    // these look for the mapped identifiers rather than the raw envelope keys.
    expect(SPEC).toMatch(/const outcome = safeEnum\(env\.transcript_outcome,/);
    expect(SPEC).toMatch(/const state = safeEnum\(env\.transcript_state,/);
    expect(SPEC).toMatch(/expect\(outcome,[\s\S]{0,80}toBe\('retained'\)/);
    expect(SPEC).toMatch(/expect\(retained,[\s\S]{0,80}toBe\(true\)/);
    expect(SPEC).toMatch(/expect\(state,[\s\S]{0,80}toBe\('available'\)/);
  });

  it('[advisory] envelopes are bound to the recording ORDINAL, not to array order', () => {
    // `v2Responses.push(...)` runs in parse-completion order; indexing by position assumes an ordering
    // nothing guarantees.
    // Behavioural, not presence-based: the set taken must be the slice SINCE the cursor. Checking only
    // that the names exist let an array-index mutation survive — the names stayed while the semantics
    // reverted.
    expect(SPEC).toMatch(/const added = v2Responses\.slice\(envelopeCursor\);/);
    expect(SPEC).toMatch(/envelopeCursor = v2Responses\.length;/);
    expect(SPEC, 'must not index the capture array by ordinal').not.toMatch(/v2Responses\[ordinal/);
    expect(SPEC).toMatch(/takeEnvelopeForRecording/);
    // Exactly one envelope per recording — a second is a silent double-save.
    expect(SPEC).toMatch(/must produce exactly ONE complete_session_v2 envelope/);
  });

  it('[advisory] the convergence poll DIAGNOSES and still fails — it can never pass a run', () => {
    const idx = SPEC.indexOf('PROOF_ROW_CONVERGENCE');
    expect(idx, 'the convergence history must exist').toBeGreaterThan(-1);
    // A `throw` must follow the history unconditionally: no branch may return/continue to a pass.
    // Window must span the verdict computation that sits between the log and the throw; 900 was tuned
    // to an earlier shape and silently stopped reaching the throw when that block grew.
    const after = SPEC.slice(idx, idx + 2_000);
    // UNCONDITIONAL. A presence check for `throw new Error` survived a mutation that guarded it behind
    // `if (converged) {} else throw ...` — the string was still there while the behaviour had flipped.
    // The property is "no bypass", not "textually adjacent": a `const verdict = ...` between the log
    // and the throw is legitimate, an `if (converged)` guard or an `else throw` bypass is not.
    expect(after, 'the block must throw').toMatch(/throw new Error\(/);
    expect(after, 'convergence must not be tolerated into a pass')
      .not.toMatch(/if\s*\(\s*converged\s*\)\s*\{[^}]*\}\s*else/);
    expect(after, 'the throw must not be reached only via an else branch').not.toMatch(/else\s+throw new Error\(/);
    // Both classification branches must exist: converged vs never-converged are different findings.
    expect(after).toMatch(/CONVERGED on re-read/);
    expect(after).toMatch(/NEVER converged/);
  });

  it('[advisory] read authority is POSITIVELY classified and caps the verdict', () => {
    // The classifier itself is executed in tests/unit/readEndpointAuthority.test.ts. This only pins
    // the WIRING: a hostname denylist must not come back, and the claim must be capped by authority.
    expect(SPEC).toMatch(/resolveReadAuthority\(process\.env\)/);
    expect(SPEC, 'no hostname denylist may return').not.toMatch(/read-replica\|-replica/);
    expect(SPEC, 'a persistence defect may only be claimed on a proven primary')
      .toMatch(/readAuthority\.maxClaim === 'persistence-defect'/);
    expect(SPEC).toMatch(/authority is UNKNOWN/);
  });

  it('the workflow runs the read-authority preflight with a STEP-SCOPED token', () => {
    expect(WORKFLOW).toMatch(/scripts\/verify-read-authority\.mjs/);
    expect(WORKFLOW).toMatch(/SUPABASE_ACCESS_TOKEN:\s*\$\{\{\s*secrets\.SUPABASE_ACCESS_TOKEN\s*\}\}/);
    // The token must appear EXACTLY ONCE — job-wide exposure would hand it to the Playwright step,
    // which has no need for it and every opportunity to leak it.
    expect((WORKFLOW.match(/SUPABASE_ACCESS_TOKEN/g) ?? []).length,
      'the management token must be scoped to the preflight step only').toBe(2);
    // ...and that occurrence must sit under the preflight step, not an unrelated one.
    const tokenIdx = WORKFLOW.indexOf('SUPABASE_ACCESS_TOKEN:');
    const stepIdx = WORKFLOW.lastIndexOf('- name:', tokenIdx);
    expect(WORKFLOW.slice(stepIdx, tokenIdx)).toMatch(/Resolve read authority/);
  });

  it('the preflight calls the DOCUMENTED project endpoint, not the nonexistent replica list', () => {
    // `GET /v1/projects/{ref}/read-replicas` DOES NOT EXIST — the published OpenAPI spec documents
    // only `POST .../setup` and `POST .../remove`. The standalone preflight caught it as a 404 before
    // any production run. This pins that it cannot come back.
    // Executable lines only: the comments deliberately record WHY that endpoint is not used, and that
    // history is worth keeping.
    const executable = (body) => body.split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    const helper = readFileSync('tests/helpers/readEndpointAuthority.ts', 'utf8');
    expect(executable(PREFLIGHT), 'the replica-list endpoint must not be called').not.toMatch(/read-replicas/);
    expect(executable(helper), 'no replica-list request anywhere').not.toMatch(/read-replicas/);
    expect(helper).toMatch(/\$\{endpoint\}\/\$\{ref\}/);
    // The documented load balancer must be rejected BY NAME, with its own reason.
    expect(helper).toMatch(/-all\\\.supabase\\\.co/);
    expect(helper).toMatch(/load_balancer_endpoint/);
    // ...and proven requires the ref to match.
    expect(helper).toMatch(/probe\.ref !== urlRef/);
  });

  it('the STANDALONE preflight workflow FAILS CLOSED on anything but a proven primary', () => {
    // The script exits 0 for `unknown` by design — in the production proof an unresolved authority
    // caps the verdict rather than failing the run. But the standalone workflow exists to POSITIVELY
    // demonstrate the live API contract, so echoing the result and exiting 0 would make missing token,
    // 404, malformed schema and replicas-present all green: the vacuous-green pattern, in the very
    // check built to prevent it.
    expect(PREFLIGHT_WORKFLOW).toMatch(/primary-proven/);
    expect(PREFLIGHT_WORKFLOW).toMatch(/canonical_project_endpoint/);
    expect(PREFLIGHT_WORKFLOW, 'a non-proven result must exit nonzero').toMatch(/exit 1/);
    expect(PREFLIGHT_WORKFLOW, 'both fields must be required together')
      .toMatch(/!=\s*"primary-proven"\s*\]\s*\|\|\s*\[\s*"\$reason"\s*!=\s*"canonical_project_endpoint"/);
  });

  it('the proof runs the preflight AFTER Node is pinned by Setup Environment', () => {
    // The preflight invokes `node --experimental-strip-types`; `.nvmrc` (22.12.0) is applied only by
    // the setup action. Running it earlier relied on whatever Node the mutable `ubuntu-latest` image
    // happens to ship — which works today and is not a pin.
    const setupIdx = WORKFLOW.indexOf('- name: Setup Environment');
    const preflightIdx = WORKFLOW.indexOf('- name: Resolve read authority');
    const proofIdx = WORKFLOW.indexOf('- name: Run #1306 three-session retention proof');
    expect(setupIdx).toBeGreaterThan(-1);
    expect(preflightIdx, 'preflight must come AFTER Setup Environment').toBeGreaterThan(setupIdx);
    expect(preflightIdx, 'and BEFORE the proof that consumes its verdict').toBeLessThan(proofIdx);
  });

  it('both preflight workflows are BOUNDED by explicit timeouts', () => {
    // An unbounded job wrapping a bounded request is still an unbounded step. The standalone workflow
    // exists to be a cheap, terminating check; without these a wedged runner or stalled setup hangs it.
    expect(PREFLIGHT_WORKFLOW, 'standalone job must have a job timeout').toMatch(/^\s{4}timeout-minutes:\s*\d+/m);
    expect(PREFLIGHT_WORKFLOW, 'and a step timeout on the probe').toMatch(/^\s{8}timeout-minutes:\s*\d+/m);
    // The production proof's preflight step is bounded too.
    const idx = WORKFLOW.indexOf('- name: Resolve read authority');
    expect(WORKFLOW.slice(idx, idx + 800)).toMatch(/timeout-minutes:\s*\d+/);
  });

  it('the preflight calls the TESTED implementation and does not re-implement it', () => {
    // The script previously re-implemented URL parsing, response validation and authority selection.
    // Two implementations mean the tested one stays green while the one that actually runs in
    // production drifts — the tests would be measuring the wrong code.
    expect(PREFLIGHT).toMatch(/from '\.\.\/tests\/helpers\/readEndpointAuthority\.ts'/);
    // `probeReplicas` now wraps `probeFromResponse` together with the bounded request, so the script
    // imports the wrapper rather than the inner validator.
    for (const fn of ['projectRefFromUrl', 'isLoadBalancerHost', 'probeProject', 'classifyFromProjectProbe']) {
      expect(PREFLIGHT, `${fn} must be imported, not redefined`).toMatch(new RegExp(fn));
      expect(PREFLIGHT, `${fn} must not be locally defined`)
        .not.toMatch(new RegExp(`function ${fn}\\s*\\(`));
    }
    // No local re-derivation of the project ref or the array check.
    expect(PREFLIGHT, 'no local ref parsing').not.toMatch(/supabase\\\.co\$\/\.exec/);
    expect(PREFLIGHT, 'no local array validation').not.toMatch(/Array\.isArray\(body\)/);
    // And no local, unbounded fetch: the request must go through the bounded helper.
    expect(PREFLIGHT, 'the script must not call fetch directly').not.toMatch(/await fetch\(/);
    expect(PREFLIGHT, 'no local AbortController').not.toMatch(/new AbortController\(/);
    // Strip-types is required for the .ts import; Node is pinned to 22.12.0 by .nvmrc.
    expect(WORKFLOW).toMatch(/node --experimental-strip-types scripts\/verify-read-authority\.mjs/);
  });

  it('the spec consumes the DERIVED verdict and cannot see the token', () => {
    expect(SPEC).toMatch(/resolveReadAuthority\(process\.env\)/);
    expect(SPEC, 'the proof must never reference the management token')
      .not.toMatch(/SUPABASE_ACCESS_TOKEN/);
  });

  it('the enum domains MATCH their sources — an omitted member destroys the diagnostic', () => {
    // `safeEnum` maps anything outside the list to `invalid`, so a missing member silently erases the
    // evidence for exactly that case. The first version listed `not_provided` as a STATE and omitted
    // `retention_failed` from the OUTCOMES — the latter being the most likely decisive value for #1306.
    const specStates = /const TRANSCRIPT_STATES = \[([^\]]+)\]/.exec(SPEC);
    const specOutcomes = /const TRANSCRIPT_OUTCOMES = \[([^\]]+)\]/.exec(SPEC);
    expect(specStates, 'the spec must name the state domain').not.toBeNull();
    expect(specOutcomes, 'the spec must name the outcome domain').not.toBeNull();
    const parse = (m) => m[1].match(/'([a-z_]+)'/g).map((x) => x.replace(/'/g, '')).sort();

    const check = /CHECK \(transcript_state IN \(([^)]+)\)\)/.exec(STATE_MIGRATION);
    expect(check, 'the CHECK constraint must be readable').not.toBeNull();
    expect(parse(specStates)).toEqual(parse(check));

    const outcomes = /export const TRANSCRIPT_OUTCOMES = \[([^\]]+)\]/.exec(STORAGE);
    expect(outcomes, 'storage.ts must export the outcome domain').not.toBeNull();
    expect(parse(specOutcomes)).toEqual(parse(outcomes));

    expect(parse(specOutcomes)).toContain('retention_failed');
    expect(parse(specStates)).not.toContain('not_provided');
  });

  it('every envelope field is VALIDATED before it is logged or asserted', () => {
    // A malformed response must not place arbitrary text into a public Actions log — and a failed
    // `toBe` echoes its RECEIVED value, so asserting on a raw field would republish it in the failure
    // message. Assertions must therefore read the MAPPED values.
    expect(SPEC).toMatch(/const safeEnum =/);
    expect(SPEC).toMatch(/transcript_state: state,/);
    expect(SPEC).toMatch(/transcript_outcome: outcome,/);
    expect(SPEC).toMatch(/retention_status: safeToken\(/);
    // The assertions themselves must not touch `env.` fields directly.
    expect(SPEC, 'assert on mapped values, never raw env fields')
      .not.toMatch(/expect\(env\.transcript_(state|outcome|retained)/);
    // Nor may a raw DB value be interpolated into a failure message.
    expect(SPEC, 'row disagreement must not echo a raw state')
      .not.toMatch(/was '\$\{String\(row\.transcript_state\)\}'/);
  });

  it('[advisory] the retention branch is identifiable without another production run', () => {
    // EACH field must go through the bounded token validator. Requiring only that `safeToken(`
    // appears somewhere let an unvalidated `retention_reason` survive, because `retention_sqlstate`
    // still used it — presence of the helper is not use of the helper.
    expect(SPEC, 'retention_reason must be validated').toMatch(/retention_reason:\s*safeToken\(/);
    expect(SPEC, 'retention_sqlstate must be validated').toMatch(/retention_sqlstate:\s*safeToken\(/);
    // The validator itself must stay bounded and character-classed.
    expect(SPEC).toMatch(/length <= 64/);
    expect(SPEC).toMatch(/\^\[A-Za-z0-9_\.:-\]\+\$/);
  });

  it('production authority gates are unchanged', () => {
    expect(WORKFLOW).toMatch(/must be dispatched from the default branch/);
    expect(WORKFLOW).toMatch(/exact production-data authorization phrase/);
    expect(WORKFLOW).toMatch(/\^\[0-9a-f\]\{40\}\$/);
  });
});
