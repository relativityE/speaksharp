# Test-gate effectiveness audit after Production real-world testing

**Consultant assessment — documentation only**
**Audited baseline:** `main@1b311f9288a383db1a4a224d69928f7af9a6753b`
**Question:** why did thousands of green checks fail to predict the Product Owner's actual Open Mic and Focus Points experience?

This is a bounded audit, not a “fix everything” PR. It changes no product code, schema, telemetry, test, CI workflow, environment, migration, or release policy. Recommendations are successor lanes for PM/PO disposition; they are not implementation authority.

The companion register is `docs/findings/real-world-journey-traceability-1b311f9.md`.

## Binding Consultant assignment: audit against the supplied denominator

The companion register now supplies three required inputs that were absent from `#1437`:

1. **List 1:** the initial Production RWT findings, RWT-01–RWT-23;
2. **List 2:** later causal findings, exact-head `#1463` review findings, and the newly acknowledged PM/Dev/Consultant process escapes;
3. **Procedure:** PO/Ops normal-path rows P-01–P-12 and deterministic failure/recovery probes F-01–F-10.

Consultant must use those inputs as the denominator for a whole-estate effectiveness review. The output is a traceability matrix—not another file-count inventory—and must include every unit, E2E, canary, live, workflow, observer, and evidence-schema test. Each row must name its finding/procedure mapping, real versus mocked boundaries, terminal user oracle, breaking casualty/mutation, runtime, unique risk, and residual gap.

The audit must make explicit recommendations for:

- **gaps:** a required finding/procedure row has no effective test;
- **masking:** a green result can coexist with the mapped real user failure;
- **bloat:** a test maps to no user promise or killed failure;
- **redundancy:** multiple tests cover the same boundary, oracle, and casualty without distinct risk;
- **ineffectiveness:** the test stays green when its mapped failure is reintroduced;
- **action:** retain, consolidate, demote, repair, add, or delete candidate.

No recommendation to delete or consolidate is acceptable without measured runtime and proof that the retained set preserves every unique killed failure. No mock-only test, zero-product-check canary, local run, stale head, or raw test count may be presented as deployed journey proof.

This remains documentation/audit scope only. It does not authorize a broad test rewrite. After PO verification and exact-head review, PM will split any accepted implementation into bounded successor PRs, one outcome or coherent causal seam at a time, each followed by a deployed affected-journey micro-test.


## Executive finding

The estate was not ineffective because it lacked test count. It was ineffective because the gates mostly proved internal behavior behind mocks while the failures lived at real, timed boundaries:

- worker start and test-instrument interaction;
- cold model download and engine identity;
- real Edge-function eligibility returning HTTP 422;
- durable progress debt across reload;
- rendered readiness/error state;
- browser and Production telemetry transport.

At the audited baseline, the principal gates could all be green without executing the complete deployed promise:

> enter journey → become truthfully ready → Start once → RECORDING within a bound → Stop → save → automatic review terminal → Focus Points coverage terminal → reload/recover → Start remains usable.

The Production run therefore found failures that the estate had structurally removed from its test environment or could not encode as evidence.

## What each layer proved—and did not prove

| Layer | What it actually proved | Boundary removed or missing | Real-world findings it could stay green beside |
|---|---|---|---|
| Unit (`vitest`/`jsdom`) | Functions, reducers, hooks, components, vocabulary, and many failure branches under controlled collaborators | real worker scheduling, model assets/network, Edge functions, durable multi-load browser state, actual audio device, Production transport | RWT-01–08, RWT-20; most C candidates |
| Browser E2E shards | UI flow against repository-controlled E2E manifests and fake media | real Supabase/Edge response, real model acquisition, real authenticated Production state, real device/network timing | RWT-05, RWT-07/08, RWT-20 |
| Production canary | readiness/deployment preconditions when able to run | `#1437` closure records repeated fail-closed runs with zero product checks | every user-journey finding |
| `#1437` deployed Practice Loop diagnostic | one authenticated fixture-audio save and automatic 1+1 review oracle | only Practice Loop; manual/credential-gated; explicitly nonqualifying; no Focus Points/acquisition/reload/error coverage | RWT-01–11, RWT-20, RWT-23 |
| `#1432` human-test observer | model-comparison identity/evidence receipts | untested non-interference; it navigated, wrapped APIs, and paused workers | RWT-01/04 and observations contaminated by them |
| `#1432` evidence schema | successful take identity, persisted binding, Gemini contract, and binary Focus Points verdict | could not represent blocked, stalled, failed, abandoned, unavailable, or ghost outcomes | RWT-01–08, RWT-20 |
| merge/review qualification | CI collection and review policy | red collector/structural results could be normalized after merge; Draft checks are incomplete evidence | T-06/T-07; no direct user-journey prediction |

## Root causes

### 1. The suites asserted implementation intentions, not terminal user promises

The common oracle was “the function returned / state changed / event emitted.” The missing oracle was “the deployed user pressed Start and received exactly one truthful outcome within a bound.” A green internal state transition could not detect a disabled button, contradictory copy, swallowed 422, or an engine that never became usable.

### 2. The load-bearing boundaries were mocked away

The failures occurred exactly where deterministic suites substituted mocks: Supabase/Edge, model downloads, workers, media, storage timing, and authenticated transport. Mocking is appropriate for fast tests; treating mock-only evidence as deployed journey protection is not.

### 3. Happy paths dominated while failure and recovery contracts were absent

The estate lacked discriminating casualties for delayed worker readiness, cold acquisition timeout, failed acquisition recovery, Focus Points registration refusal, repeated reconciliation failure, stale Start intent, and reload continuity. The Production run exercised those states naturally.

### 4. Gate names overstated the product behavior executed

The canary could fail closed before any product check. The only deployed journey test was explicitly a diagnostic and failed both cited Production runs. Post-merge collector failures were classified as non-product noise. None of those facts is wrong in isolation; together they allowed “all substantive jobs green” to be heard as “the journey works.”

### 5. The evidence format excluded the most important outcomes

`#1432` optimized for a qualified model-comparison take. Required persisted IDs, nonces, receipts, and binary coverage verdicts make sense for successful comparison evidence. They also mean a Start stall, setup refusal, ghost recording, unavailable coverage, or blocked reload cannot become a complete row. The schema made failure invisible rather than first-class.

### 6. The instrument was inside the system it measured

The observer changed navigation, APIs, and worker startup and had no running-app equivalence casualty. Its synthetic unit tests proved record processing, not passivity. The three recordings that began on detach are strong causal evidence that the observer invalidated its own measurement path.

### 7. Journey traceability lost its owner between `#1437` and `#1432`

`#1437` was told to define the authoritative Open Mic/Focus Points denominator, but the merged scope became an inventory plus a Practice Loop diagnostic. `#1432` then explicitly rejected importing the broad register to preserve its downselection scope. The scope decisions were recorded; the missing control was a separate owner/deliverable check for the displaced matrix.

## Consultant accountability

Consultant contributed directly to this escape. I did not deliver the promised authoritative desktop/mobile Open Mic and Focus Points journey matrix in `#1437`. I allowed that PR to pivot to one Practice Loop diagnostic without marking the absent matrix as an unfulfilled deliverable that blocked Consultant signoff. I over-weighted inventory size and test counts, and did too little risk-to-test and mutation mapping to distinguish unique protection from deletable fake, duplicate, or low-value tests. I also failed to prove that the canary executed product checks, that the observer was non-interfering, or that real boundaries covered Start, acquisition, Focus Points, reload, recovery, and rendered error states. The result was a large green estate that did not protect the Product Owner's actual journey.

Binding corrections for future Consultant work:

1. Begin every effectiveness audit from a PO-authored granular journey denominator covering each user action, expected visible state, terminal outcome, failure/recovery path, device class, and required real boundary.
2. Count coverage as `proven` only when the responsible real boundary is exercised and a casualty or mutation demonstrates that the test fails when the user promise is broken.
3. Before recommending deletion or consolidation, measure runtime and identify the unique risk protected by each candidate and the retained test that preserves it.
4. Withhold Consultant signoff whenever a promised journey matrix is absent or a canary run executes zero product checks. Such a run is `NON_COVERAGE`, never journey evidence.

## The effective gate standard

A test protects a real-world promise only when all of the following are named:

1. journey row and user-visible promise;
2. responsible production boundary;
3. fixture/environment and which boundaries remain real;
4. terminal oracle, including failure/refusal;
5. red casualty or mutation that breaks that promise;
6. observed failure of the test under that casualty;
7. runtime/cost and CI lane;
8. residual human-only risk.

Tests missing these fields may still be valuable unit evidence, but cannot be counted as journey proof.

## Minimum deployed journey contract

This is the smallest useful post-merge journey tier. The time budgets (`N`) are Product Owner/PM decisions and must not be invented by implementation.

| Contract | Real boundary | Required terminal oracle | Example casualty |
|---|---|---|---|
| load → truthful readiness | deployed app + selected engine | visible state and Start gate agree | delay worker/model readiness |
| Start → one outcome ≤ N | real browser controller/media fixture | RECORDING, or one visible stage/reason refusal/failure | stall worker start beyond N |
| cold acquisition per approved candidate | real asset path/network policy | success identity, or bounded honest recoverable failure | slow/abort one model asset |
| Stop → save ≤ N | real persistence/Edge path | durable readback or one truthful save failure | timeout/fail persistence once |
| automatic suggestions | real saved-session trigger and provider boundary | request-started → exactly one rendered-success or safe failed/refused terminal | refuse/malformed/supersede response |
| Focus Points coverage | real `objective-register-source` + finalized coverage | per-point rendered verdict or one coverage-unavailable terminal | return 422 from registration seam |
| save → reload → usable Start | durable browser/server progress state | debt retained, bounded retry terminal, Start released | repeated reconciliation RPC failure |
| one accurate error | rendered app | one owned message surface matching stage/reason | inject identity mismatch vs mic denial |

These checks use content-safe fixture speech, real deployed boundaries, no debugger, no page-world API wrappers, and no direct suggestion-generation action. Perceived transcript quality and coaching credibility remain human-only.

## Telemetry as a corroborating oracle, not a substitute

Each successful completed/saved session should correlate:

1. session completed/saved;
2. automatic suggestions request started;
3. exactly one terminal rendered-success or failed/refused outcome with safe reason category and latency.

Never emit `practice_loop_ready` or `review_rendered` unless a valid review is visible. A missing/ambiguous telemetry chain is evidence debt recorded in `#1399`; it does not automatically block the downselect or expand an active PR. No credentials, transcript, point text, or suggestion content belongs in this evidence.

## Sequenced successor PRs—bounded, never omnibus

The order below preserves the PM lane freeze. Each implementation PR is independently reviewable and owns one user-outcome family. PM creates/edits/closes PRs; the assigned implementer creates/edits its branch and returns an exact remote head. A later lane does not silently enter an earlier PR.

### 0. Active lane: RWT-20 only (`#1463`)

- bounded reconciliation retry/backoff;
- one honest terminal state;
- release Start while durable unresolved debt remains;
- content-free attempt/success/failure evidence;
- casualty: save → reload → repeated failure → bounded terminal release.

No other RWT, gate redesign, or audit implementation belongs in `#1463`.

### 1. Observer passivity: RWT-01 only

- separate candidate control from observation;
- no navigation, fetch/XHR/sendBeacon/WebSocket replacement, or worker pause;
- running-app equivalence casualty with and without observation;
- after merge/deploy, passively reproduce RWT-02/03 before deciding whether they are independent product work.

RWT-04 remains a distinct queued product-safety lane; fixing the observer does not claim stale-intent safety is fixed.

### 2. Stale Start intent: RWT-04 only

- cancel stale/superseded intent before mic acquisition;
- prove delayed readiness or observer/control detach cannot start recording;
- positive control: one fresh Start records exactly once.

### 3. Focus Points finalization: RWT-05 only

- diagnose the real 422 at the registration/finalization boundary;
- produce coverage or one visible stage-coded failure;
- do not absorb reload persistence, copy cleanup, monitoring expansion, or suggestion work.

### 4. Cold acquisition and recovery: RWT-07 + RWT-08

These share one causal state machine and may form one bounded PR:

- cold transfer must not fail on an arbitrary timer while making progress;
- terminal failure has a safe stage/reason;
- retry reacquires, or Start stays disabled with an honest recovery path;
- requested/observed runtime identity cannot mismatch silently.

RWT-09/10/11/19/23 remain nonblocking `#1399` items even if nearby code is touched.

### 5. Clean-path reproduction decisions: RWT-02 and RWT-03

Only after the passive observer is deployed:

- reproduce each on a clean path;
- PM either promotes a bounded lane with exact evidence or resolves it as observer-induced/duplicate;
- no preemptive implementation.

### 6. Nonblocking hardening lanes from `#1399`

Schedule separately after P1 lanes unless PO/PM explicitly reprioritize. Group only by one coherent user outcome, for example:

- reload continuity (RWT-06);
- error-message ownership (RWT-10/11);
- acquisition/idle observability (RWT-09/23);
- telemetry semantics and reconstruction (RWT-12/21/22 and verified C overlaps);
- test authorization/cleanup/admin (RWT-13–16);
- tester-only identity support (RWT-19).

These remain P2/P3 and must not hold MVP release.

### 7. Test-gate implementation program

Do not create one “make all testing effective” PR. PM should create small successors after the journey register is accepted:

1. **Canary truthfulness:** a zero-product-check run reports `NON_COVERAGE`, never journey green. No new product journey yet.
2. **Start/save deployed gate:** one content-safe fixture journey with bounded terminal outcomes.
3. **Focus Points deployed gate:** real registration/finalization and failure outcome.
4. **Cold acquisition/recovery gate:** one candidate at a time, real asset boundary.
5. **Reload/progress gate:** durable save/reload/reconciliation usability.
6. **Gate evidence contract:** publish the journey-row IDs, terminal outcomes, and casualties each run covered.
7. **Mock-suite consolidation audit:** only after unique casualties/mutants and measured runtime identify true duplicates.

Each successor changes one gate family and must demonstrate a red casualty before its green result counts.

## Why blanket deletion or a coverage target would repeat the mistake

The estate inventory is useful for cost accounting, not a verdict on value. Mock count, LOC, file count, skipped tests, or runtime alone cannot identify bloat. A removal candidate needs:

- measured cost;
- named user promise;
- unique branch/behavior and mutants killed;
- retained overlapping test;
- failure class lost if removed.

Until those facts exist, this audit recommends no blanket deletion and no arbitrary percentage target.

## PM acceptance checklist for this documentation branch

- [ ] Exactly two documentation files; no product/test/workflow/schema/telemetry changes.
- [ ] Every RWT-01–23 appears once in the companion register.
- [ ] C-01–12 are labeled PO verification candidates, not verified defects.
- [ ] RWT-02/03 remain needs passive reproduction.
- [ ] RWT-06, 09–17, 19, 21–23 remain nonblocking P2/P3.
- [ ] RWT-18 is a validation activity, not a defect.
- [ ] RWT-20 remains owned by active `#1463`; no implementation duplicated.
- [ ] `#1437` and `#1432` scope history is explained without reopening either PR.
- [ ] Successor lanes are sequenced and bounded; no god-like implementation PR is proposed.
- [ ] Automatic suggestions are not reopened; telemetry failure remains nonblocking unless PO explicitly reclassifies it.
- [ ] No sensitive content appears.

## Evidence

- [`#1432` Production PM package](https://github.com/relativityE/speaksharp/pull/1432#issuecomment-5659014375)
- [`#1432` six-row results](https://github.com/relativityE/speaksharp/pull/1432#issuecomment-5659031757)
- [`#1432` original laundry list](https://github.com/relativityE/speaksharp/pull/1432#issuecomment-5658290488)
- [`#1432` all-journey scope exclusion](https://github.com/relativityE/speaksharp/pull/1432#issuecomment-5647280175)
- [`#1437` required authoritative register](https://github.com/relativityE/speaksharp/pull/1437#issuecomment-5647261377)
- [`#1437` bounded Practice Loop implementation](https://github.com/relativityE/speaksharp/pull/1437#issuecomment-5646972559)
- [`#1437` post-merge gate results](https://github.com/relativityE/speaksharp/pull/1437#issuecomment-5651121397)
- [`#1399` PM nonblocking transfer](https://github.com/relativityE/speaksharp/pull/1399#issuecomment-5659070994)
