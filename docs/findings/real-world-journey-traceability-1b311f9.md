# Production real-world journey findings and traceability register

**Consultant assessment — documentation only**
**Evidence baseline:** Production `main@1b311f9288a383db1a4a224d69928f7af9a6753b`, exercised 2026-09-14
**Purpose:** give PM and the Product Owner one deduplicated register of the real-world findings, the user promise each finding affects, and the proof the repository actually had at the audited baseline.

This register does not authorize a fix, expand an implementation PR, select a model, or change release scope. It contains no transcript, coaching text, credential, account identifier, or raw session identifier.

## Status and coverage vocabulary

Finding state:

- **verified P1:** reproducible, in-scope release blocker under the PM freeze;
- **needs passive reproduction:** observed with the invasive test observer and not yet attributable to the product on a clean path;
- **nonblocking P2/P3:** verified or useful evidence transferred to `#1399`; it cannot hold MVP merge, deployment, real-world testing, or release;
- **validation activity:** work to perform, not a defect;
- **PO verification candidate:** an observation from the evidence bundle that has not yet received independent reproduction and PM classification.

Coverage state:

- **proven:** reaches the responsible boundary and has a discriminating casualty/mutation;
- **partial:** covers part of the promise or stops before a load-bearing boundary;
- **mock-only:** collaborators at the responsible boundary are replaced;
- **human-only:** only manual observation currently reaches the promise;
- **uncovered:** no evidence that a test asserts the user-visible outcome.

“Green” and test counts are not coverage states.

## Release disposition summary

| State | Findings | Binding disposition |
|---|---|---|
| verified P1 | RWT-01, RWT-04, RWT-05, RWT-07 + RWT-08, RWT-20 | Frozen lanes. RWT-20 is the active bounded lane in `#1463`; the rest remain ordered, not bundled. |
| needs passive reproduction | RWT-02, RWT-03 | Do not promote independently while RWT-01 can explain the observation. |
| nonblocking P2/P3 | RWT-06, RWT-09–17, RWT-19, RWT-21–23 | `#1399`; none is an MVP hold. RWT-10 is P2 copy accuracy even though the underlying acquisition/recovery failure is P1. |
| validation activity | RWT-18 | Rerun all six cells only after authorized P1 corrections are deployed and the observation path is passive. |
| PO verification candidates | C-01–C-12 | Preserve as candidates until PO verification, independent reproduction, and PM classification. |

Sources: [PM package](https://github.com/relativityE/speaksharp/pull/1432#issuecomment-5659014375), [row results](https://github.com/relativityE/speaksharp/pull/1432#issuecomment-5659031757), [PM transfer](https://github.com/relativityE/speaksharp/pull/1399#issuecomment-5659070994), and the frozen P1 disposition recorded on `#1432`.

## List 1 — initial Production RWT findings

| ID | Journey step / user promise | Finding and user impact | State | Coverage at `1b311f9` | Smallest missing proof |
|---|---|---|---|---|---|
| RWT-01 | Instrumented Start must behave like uninstrumented Start | Observer reloaded the page, replaced network APIs, paused workers, and every attached Start stalled. | **verified P1** | **uncovered**; observer tests used synthetic records, not a running-app equivalence check | Same deployed journey with and without observer: Start → RECORDING → Stop → save; no navigation, API replacement, worker pause, or timing change |
| RWT-02 | Every Start has one bounded visible outcome | Start remained disabled without a specific message for 2–7 minutes; late failure was generic `Error`. | **needs passive reproduction** | **uncovered** at deployed boundary | Clean passive Start reaches RECORDING or one stage-coded visible failure within a PM/PO-set bound |
| RWT-03 | Readiness copy and control state agree | “Mic ready” / “Downloading 100%” appeared while Start remained disabled. | **needs passive reproduction** | **mock-only/partial** component-state evidence | Clean deployed assertion that the visible readiness label and Start gate share the same authority |
| RWT-04 | A stale or abandoned Start never opens the microphone | Three stalled intents began recording when the observer detached, without a fresh action, then failed without save. | **verified P1** | **uncovered** | Stale/superseded intent casualty across delayed worker readiness and observer detach; fresh click required |
| RWT-05 | Focus Points save yields an evaluated per-point result or one truthful terminal failure | Real save called `objective-register-source`, received HTTP 422, showed detection unavailable, and produced no coverage telemetry. | **verified P1** | **mock-only** in ordinary E2E; no recurring real-stack coverage gate | Real deployed Focus Points: enter points → record → stop/save → coverage rendered, plus injected/register failure with visible and telemetered terminal outcome |
| RWT-06 | Reload preserves the chosen journey and entered setup | Refresh changed Focus Points to Open Mic. | **nonblocking P2** | **partial/mock-only** | Reload-persistence browser proof for mode, topic, points, and current recovery state |
| RWT-07 | Cold model acquisition waits for the real transfer or fails truthfully | Moonshine failed at about 5 seconds while assets were still downloading successfully. | **verified P1**, paired with RWT-08 | **uncovered** on real network | Cold-cache Production acquisition per approved candidate, bounded by actual download progress and stage-coded failure |
| RWT-08 | Acquisition failure leaves an honest recoverable state | After acquisition failure, Start stayed enabled but every press refused with identity mismatch and no setup retry. | **verified P1**, paired with RWT-07 | **mock-only/partial** | Failure-injection proof that retry reacquires, or Start remains disabled with an honest reason and recovery action |
| RWT-09 | Acquisition receipts contain decision-useful measurements | Successful receipts omitted bytes/download/init; failure reason was `unknown`. | **nonblocking P2** | **partial** telemetry structure; Production population unproven | Receipt completeness proof at real acquisition boundary; absence remains nonblocking |
| RWT-10 | Error copy names the actual failure class | Identity/acquisition failure blamed microphone permission or storage. | **nonblocking P2** | **mock-only/partial** | One message expectation per injected failure class at rendered surface |
| RWT-11 | One failure produces one error surface | The same setup failure appeared in status and mic window; PO preference is to remove mic-window duplication. | **nonblocking P2** | **partial** | Rendered proof that one failure maps to one owned surface |
| RWT-12 | Metrics and displayed counts have distinct authorities | Review latency names conflicted; saved and displayed word counts disagreed. | **nonblocking P3** | **partial** | Explicit authority and labels; compare telemetry to rendered value without treating absence as a blocker |
| RWT-13 | Authorized testing survives only the intended navigation lifecycle | Comparison authorization disappeared on reload and required pre-boot CDP installation. | **nonblocking P2** | **partial** authorization casualties, not a usable operator journey | PO-safe navigation/reload proof; no customer-facing selector |
| RWT-14 | Test tooling terminates on time and returns a receipt | Observer ran about four minutes past deadline and lost its receipt. | **nonblocking P2** | **partial** synthetic cleanup tests | Wall-clock termination casualty against a running browser |
| RWT-15 | Privacy validation distinguishes content risk from routine analytics transport | Observer privacy audit held on routine PostHog/empty-target traffic. | **nonblocking P2** | **partial** | Content-safe traffic classification with false-positive control |
| RWT-16 | Trusted validation prerequisites are reported without blocking unrelated product evaluation | Required validation migration was unavailable. | **nonblocking P2/admin** | **partial** | Administrative readiness proof in its owning lane; no implicit migration authorization |
| RWT-17 | Release gates exercise the user's deployed journey | Large green suites did not predict Start, coverage, acquisition, reload, or messaging failures. | **nonblocking P2 test-strategy debt** | **uncovered as an end-to-end promise** | Small deployed-stack journey tier, casualty-proven per promise; this audit defines the gap but does not implement it |
| RWT-18 | After fixes, compare v2/v4/Moonshine across Open Mic and Focus Points | Six-cell rerun was not completed; zero qualifying takes existed. | **validation activity** | **human-only**, currently incomplete | Run six cells after authorized fixes with passive observation and exact-release evidence |
| RWT-19 | Tester can establish which hidden candidate actually ran | PO could not distinguish an unplanned v2 take from Moonshine. | **nonblocking P2 test/support** | **partial** hidden identity evidence; no customer-facing identity required | Tester/evidence identity proof outside customer UI |
| RWT-20 | Saved-session reconciliation cannot lock Start indefinitely | “Finishing your last session” persisted about 88 minutes with a promised retry that did not occur. | **verified P1; active `#1463`** | **uncovered** at audited baseline | save → reload → repeated reconciliation failure → bounded terminal release while durable debt remains |
| RWT-21 | Production telemetry reconstructs the user's terminal journey outcome | Telemetry recorded activity but could not distinguish several failures from no request. | **nonblocking P2** | **partial** | Correlated, content-free start/acquisition/finalize/progress outcomes; observation failure remains nonblocking |
| RWT-22 | One failure emits one terminal state | Failure state flapped `FAILED` ↔ `FAILED_VISIBLE` multiple times. | **nonblocking P2** | **uncovered** at real controller seam | One injected failure → exactly one terminal visible state/event |
| RWT-23 | Idle teardown/reacquisition is intentional, observable, and safe | Engine was silently reclaimed and reacquired without page load. | **nonblocking P2** | **partial** internal lifecycle tests | Policy-level idle casualty and content-free lifecycle evidence |

## List 2 — post-RWT causal and exact-head review findings

This second list is intentionally separate from the initial Production observations. It records what later source analysis and exact-head review learned about cause, diagnostic blindness, and new defects introduced or exposed by the first bounded correction. Where a row explains an initial RWT item, it cross-references that item instead of pretending the same user failure happened twice.

### A. Product and telemetry findings discovered after the initial RWT

| ID | Later finding | Relationship to initial RWT | Current disposition | Required effectiveness proof |
|---|---|---|---|---|
| NEW-01 | A shared STT strategy initialization limit of about 5 seconds overrides Moonshine's own 60-second initialization allowance. A normal cold asset transfer can therefore be terminated while still making successful progress. | Confirmed mechanism for RWT-07; also contributes to RWT-08. | **P1 causal evidence** in the later cold-acquisition/recovery lane; do not fix in this audit PR. | Real cold-cache asset path; progress-aware timeout casualty; terminal recovery proof. |
| NEW-02 | Acquisition error classification recognizes a few message words but collapses distinct Moonshine outcomes such as an exceeded bound, superseded initialization, and identity mismatch into `unknown`. | Explains the diagnostic blindness in RWT-09 and RWT-21. | **nonblocking P2 telemetry correctness** in `#1399`. | One injected failure per governed reason; emitted category must distinguish the stage safely without raw error text. |
| NEW-03 | Moonshine has no equivalent of the dedicated v4 lifecycle/attempt telemetry, so engine initialization and teardown cannot be reconstructed from governed events. | Extends RWT-21; helps explain why Moonshine failure could not be diagnosed live. | **nonblocking P2 observability** in `#1399`. | Content-free lifecycle sequence with exactly one terminal per attempt; no transcript, model content, or credential. |
| NEW-04 | Five-minute idle reclamation matches the observed READY/IDLE/TERMINATED cycling and background reacquisition without a new user action. | Confirmed mechanism for RWT-23. | **nonblocking P2 policy/observability** in `#1399`. | Idle-policy casualty proving teardown/reacquisition is safe, intentional, visible to telemetry, and cannot create a stale Start. |
| NEW-05 | In `#1463@7776a351`, debt arriving while an older schedule's final RPC was in flight could be released with zero attempts of its own. | New exact-head defect in the attempted RWT-20 correction. | **P1; remains in bounded `#1463` scope** as review thread 4002335597. | Deterministic later-arrival casualty; each obligation exhausts only its own persisted budget. |
| NEW-06 | In `#1463@7776a351`, concurrent tabs could overwrite the shared queue and permanently lose another tab's debt while the writer reported success. | New exact-head durable-concurrency defect. | **P1; separate queued successor after the `#1463` Production micro-test**, review thread 4002335598. Not `#1399`. | True cross-renderer interleaving with durable readback, owner isolation, and legacy compatibility only if needed. |
| NEW-07 | In `#1463@7776a351`, reload ignored persisted attempts/time and restarted a full retry schedule, recreating an indefinite hold across repeated loads. | New exact-head defect that violates the RWT-20 objective directly. | **P1; remains in bounded `#1463` scope**, review thread 4002335600. | Run → reload mid-budget → resume casualty; repeated reload cannot extend the per-obligation bound. |
| NEW-08 | A malformed release marker such as `releasedAtIso: "corrupt"` allowed Start. | New defensive storage finding from exact-head review. | **nonblocking P2** transferred to `#1399`, review thread 4002335603. | Corrupt-marker fail-closed casualty in a separately authorized hardening lane. |
| NEW-09 | Re-enqueueing an existing debt could emit duplicate `enqueued` telemetry with a near-zero age, obscuring the actual debt duration. | New telemetry finding from exact-head review. | **nonblocking P2** transferred to `#1399`, review thread 4002335607. | Event-cardinality and original-age casualty; telemetry remains corroborating, not release proof. |
| NEW-10 | After auth changed from account A to B, the scheduler could continue retrying A's debt and mark it released locally. Backend ownership prevented the database write; no P0/P1 data impact was established. | New identity/security-hardening finding from exact-head review. | **nonblocking P2** transferred to `#1399`, review thread 4002356419. | Auth-epoch cancellation and owner-scoped state casualty; no cross-account local release claim. |
| NEW-11 | The first `#1463` test design modeled one tab, one owner, one schedule, and no reload mid-budget; all six NEW-05–10 cases were absent until Codex review and Dev reproduction. | Direct evidence that case count did not equal risk coverage. | **verified effectiveness failure**; input to this Consultant audit. | Consultant must map state dimensions and interleavings, then prove every retained gate with a breaking casualty. |

### B. Process escapes newly acknowledged after the initial RWT

These are control failures to include in the effectiveness audit. They are not additional product defects and must not be used to inflate the implementation queue.

| ID | Acknowledged escape | Missing control |
|---|---|---|
| ESC-01 | Dev ran comparison takes through an observer that had not been proven passive; it reloaded, wrapped network APIs, paused workers, and materially changed the outcome. | Mandatory with/without non-interference casualty before any instrument may qualify evidence. |
| ESC-02 | Long, expanding branches accumulated user-visible changes without a short deployed user check after each bounded fix; `#1432` reached 58 files and 6,862 lines. | One outcome/failure cluster per PR, then merge, deploy, and affected-journey micro-test before the next lane. |
| ESC-03 | Broad CI green was treated as readiness even though the canary executed zero product checks and no gate ran Start → save → coverage on the real deployed stack. | `NON_COVERAGE` for zero-check runs; no readiness claim without a row-level real-boundary result. |
| ESC-04 | The evidence schema could encode a successful take but not a blocked, stalled, abandoned, ghost, failed, or coverage-unavailable attempt. | Failure must be a first-class row with terminal state, safe reason, latency, recovery, and evidence status. |
| ESC-05 | Telemetry was not validated as a diagnostic before the test; Moonshine returned `unknown` and multiple failures looked like absence rather than a terminal. | Every journey/failure test also proves the content-free correlated telemetry terminal. |
| ESC-06 | The first RWT-20 fix repeated happy/single-context coverage and missed multi-tab, auth-change, corruption, duplicate-event, and reload-resume cases. | State-space/interleaving review before implementation; deterministic RED casualties precede a correction. |
| ESC-07 | Code paths behind the five-second Moonshine cutoff, swallowed Focus Points 422, and once-per-load progress drain were implemented or reviewed without being exercised as a user. | Production-code user validation at the exact affected journey after every deployed bounded change. |
| ESC-08 | PM did not provide—and Consultant did not refuse to proceed without—a granular PO/Ops procedure and expected-outcome rubric. | The procedure below is the denominator; missing rows make Consultant signoff unavailable, not implicitly green. |

## PO/Ops test procedure and expected-outcome rubric

This is the input denominator for the Consultant's effectiveness and traceability review. It separates normal user execution from deterministic failure probes. The Consultant may identify a missing budget or expectation, but must not invent product policy.

### Matrix and preparation

- Cover the approved three hidden candidates across both user journeys: Open Mic and Focus Points. The comparison packet therefore contains six candidate/journey cells.
- Record desktop and mobile coverage separately. A desktop result does not imply mobile coverage; an uncovered device class is explicit.
- Use the canonical Production deployment at the exact reviewed SHA. Preview/local behavior, stale evidence, and test counts are not substitutes.
- Use a fresh isolated normal browser session and the ordinary sign-in path. Baseline execution has no debugger, page-world API wrapper, forced navigation, worker pause, direct provider call, or manual suggestion-generation action.
- Record only content-free evidence: release SHA, candidate/journey identity, authorization/attempt references, stage/outcome, safe reason category, and latency. Never record credentials, transcripts, Focus Point text, or suggestion content.
- Mark cold/warm model state, device/browser class, and any network condition needed to interpret acquisition. Do not change those conditions silently during a row.

### Normal user path for every cell

| Step | User action | Expected visible/product outcome | Required evidence classification |
|---|---|---|---|
| P-01 | Enter the selected journey through normal product controls. | Correct journey, topic, and entered Focus Points are present; no hidden test control changes customer state. | Journey row and device class named. |
| P-02 | Wait for readiness without manipulating the page. | Readiness copy and Start enabled/disabled state agree. If setup is not ready, the user sees one truthful stage, not contradictory “ready” and “downloading” claims. | Real engine/worker boundary; elapsed readiness time recorded. |
| P-03 | Press Start exactly once. | Exactly one terminal within the authoritative product budget: RECORDING, or one visible safe stage-coded failed/refused outcome. No indefinite disabled state. If no authoritative budget exists, mark the budget as a product gap—never infer a pass. | One intent, one terminal, latency, safe reason. |
| P-04 | Speak the authorized content-safe comparison script naturally. | Recording remains active, mic state is truthful, and transcript behavior is observable without a test instrument changing the app. | Human quality judgment remains separate from automated functional proof. |
| P-05 | Press Stop exactly once. | Recording stops; no delayed or ghost restart occurs without a fresh Start action. | One stop intent and one terminal recording state. |
| P-06 | Wait for persistence. | Session saves durably or shows one truthful save failure within the authoritative budget. Stop/save latency is measured from the user's action. | Persisted readback or one safe failed/refused terminal. |
| P-07 | Take no manual generation action. | A successfully completed/saved session automatically starts suggestions and reaches exactly one user-visible rendered-success or safe failed/refused terminal. | Correlate session completed/saved → automatic request started → exactly one terminal with latency. Never emit readiness/rendered markers unless valid review appears. |
| P-08 | For Focus Points, inspect every entered point in order. | Every entered and substantively spoken point receives a rendered verdict, or the user sees one coverage-unavailable terminal. HTTP 422 or missing evaluation cannot become silent HOLD. | Real `objective-register-source`/finalization boundary and per-point terminal status without point text. |
| P-09 | Inspect recovery choices and error copy. | One failure owns one message surface; copy matches its actual class; offered retry/new-set actions are valid for the state. | Rendered surface, stage, safe reason, available recovery. |
| P-10 | Reload through the normal browser action, then return to the journey. | Selected journey/setup and durable obligations are reconstructed truthfully. Reconciliation has observable retry/backoff and an honest terminal; unresolved debt remains durable while Start eventually releases according to policy. | Cross-load evidence; no local-only claim. |
| P-11 | Press Start once after recovery/reload when the UI says it is usable. | Start works exactly once or returns one truthful bounded failure. No stale intent, identity mismatch loop, or hidden engine teardown. | Final affected-journey outcome at the same deployed SHA. |
| P-12 | Finish the cell. | Requested, expected, observed, and persisted hidden candidate identities agree for the whole take. | Exact-head authority and trusted content-free readback; no customer-facing selector required. |

### Deterministic failure and recovery probes

These probes are test responsibilities, not extra steps imposed on the PO's ordinary baseline session.

| Probe | Responsible real boundary | User outcome that must remain true |
|---|---|---|
| F-01 delayed worker/model readiness | real worker and controller scheduling | Start reaches RECORDING or one bounded truthful failure; readiness copy stays consistent. |
| F-02 slow/aborted cold model asset | real candidate asset path and orchestration timeout | Progress is not killed by an arbitrary shorter timer; terminal failure is honest and recoverable. |
| F-03 Focus Points registration returns 422 | real Edge/function contract | Coverage-unavailable appears once and is telemetered; no false coverage/readiness event. |
| F-04 reconciliation RPC fails repeatedly | durable queue plus real RPC contract | Each obligation gets its own persisted budget; debt remains; Start releases at the honest terminal. |
| F-05 reload mid-retry budget | durable cross-load state | Remaining schedule resumes; reload cannot restart or extend the bound. |
| F-06 two tabs interleave queue writes | real cross-renderer storage behavior | No obligation is overwritten or lost; readback proves owner/session isolation. |
| F-07 auth changes mid-schedule | auth epoch plus durable owner state | Prior owner's work is cancelled/isolated and cannot be released under the new owner. |
| F-08 corrupt/unreadable durable marker | browser storage/readback | Start fails closed with one recoverable, truthful outcome; corruption is never interpreted as release. |
| F-09 delayed/stale Start intent | controller plus mic acquisition | An abandoned or superseded intent cannot begin recording; a fresh Start still records once. |
| F-10 observation enabled vs disabled | running deployed app | Navigation, request behavior, workers, timings, and terminal user outcome are equivalent within the approved tolerance. |

### Consultant-required output

For every existing unit, E2E, canary, live, workflow, observer, and evidence-schema test, Consultant must map:

1. the List 1 and/or List 2 IDs it claims to protect;
2. the procedure row or failure probe;
3. the user-visible promise;
4. the responsible production boundary and which parts are mocked;
5. the terminal oracle;
6. the RED casualty/mutation and proof the test fails;
7. runtime and CI lane;
8. unique risk not protected elsewhere;
9. classification: **retain**, **consolidate**, **demote to mock-only evidence**, **repair**, **add**, or **delete candidate**;
10. residual human-only or uncovered risk.

A test with no journey/finding mapping is a bloat candidate. Two tests with the same boundary, oracle, and killed casualty are redundancy candidates. A test that stays green when its mapped finding is reintroduced is ineffective and cannot count toward readiness. A canary that executes zero product checks is `NON_COVERAGE`. Deletion still requires measured cost and proof that retained coverage preserves every unique killed failure.


## Candidate observations requiring PO verification

These are not verified defects and cannot expand an active PR. The numbers preserve the evidence-bundle vocabulary.

| ID | Journey step | Candidate observation | Current state | Existing overlap / disposition |
|---|---|---|---|---|
| C-01 | worker lifecycle | Empty-URL unresponsive workers appeared to accumulate after observer detach. | **PO verification candidate** | Could be observer/tooling residue; reproduce passively before any classification. |
| C-02 | Stop → save | Observed stop/save latencies were roughly 8–13 seconds. | **PO verification candidate** | Needs an explicit PO experience budget and clean timing source. |
| C-03 | model readiness | v4 setup was observed at roughly 18–20 seconds. | **PO verification candidate** | Needs cold/warm definition and target budget; do not merge into RWT-07 automatically. |
| C-04 | telemetry truth | “Setup” events appeared on nearly every Start/Stop, far more often than real acquisitions. | **PO verification candidate** | Possible RWT-21 telemetry semantics extension; P2 unless PM reclassifies. |
| C-05 | Start intent | Each Moonshine Start appeared to log accepted and failed intents. | **PO verification candidate** | Potential overlap with RWT-08/22; reproduce and deduplicate first. |
| C-06 | Focus Points recovery UX | Retry/new-set choices appeared while coverage was unavailable. | **PO verification candidate** | Possible P2 UX extension of RWT-05, not a new P1 by default. |
| C-07 | telemetry cost | Health events were about one quarter of the sampled events. | **PO verification candidate** | Cost/administration; nonblocking absent quantified harm. |
| C-08 | automatic review | Review-ready latency differed materially between observed takes. | **PO verification candidate** | Suggestions rendered successfully; latency needs a PO budget before defect status. |
| C-09 | saved/displayed count | Saved word count differed from transcript authority. | **PO verification candidate** | Extends RWT-12; do not duplicate unless a distinct customer harm is proved. |
| C-10 | During → Stop | Transcript stability was reported only at Stop. | **PO verification candidate** | Perceived live-transcript quality remains human judgment unless a product promise defines stability. |
| C-11 | mic feedback | Mic telemetry reported no signal on takes that yielded words. | **PO verification candidate** | Possible RWT-21 blind spot; P2 observability unless independently escalated. |
| C-12 | filler analysis | Filler measurement remained unobservable/pending on completed takes. | **PO verification candidate** | Needs corpus authority and PO analysis judgment; do not claim a product defect yet. |

## Test-estate/process findings

These explain coverage failure; they are not product defects and do not hold the MVP by themselves.

| ID | Finding | Corroboration | State / impact |
|---|---|---|---|
| T-01 | Production canary executed zero product checks on repeated main pushes while failing closed on readiness. | [`#1437` closure](https://github.com/relativityE/speaksharp/pull/1437#issuecomment-5651121397) | **verified test-gate finding; nonblocking P2** |
| T-02 | The only merged deployed Practice Loop diagnostic failed both Production attempts and was explicitly not Gate 3. | `tests/live/practice-loop-journey.live.spec.ts` plus linked `rc-gates` runs in the PM package | **verified test-gate finding**; it supplied evidence, not qualification |
| T-03 | That diagnostic is credential/manual-dispatch gated, uses fixture/fake media, and asserts only the Practice Loop outcome. | merged spec and `rc-gates.yml` dispatch contract | **verified design limitation** |
| T-04 | `#1437` promised two-product traceability but merged an inventory and one Practice Loop diagnostic; no authoritative Open Mic/Focus Points row matrix shipped. | [`#1437` traceability demand](https://github.com/relativityE/speaksharp/pull/1437#issuecomment-5647261377) vs merge commit `338431791ff8` | **verified ownership/deliverable gap** |
| T-05 | Observer tests exercised synthetic records but did not prove non-interference against the running app. | RWT-01 evidence and `tests/unit/humanTest*.test.js` | **verified test-instrument gap** |
| T-06 | Post-merge qualification jobs were red but classified as collector/structural noise. | [`#1437` closure](https://github.com/relativityE/speaksharp/pull/1437#issuecomment-5651121397) | **verified gate-hygiene finding; nonblocking** |
| T-07 | Draft PR runs skip substantive lanes, so a Draft “green” cannot qualify a head. | current workflow behavior cited in the evidence bundle | **process rule**, not a product defect |
| T-08 | Some console/error capture collapsed to generic `Object`; Sentry contents were not verified. | evidence bundle | **PO verification candidate / P2 evidence debt** |

## Journey-to-gate coverage matrix

| Journey promise | RWT/C/T references | Unit | mocked E2E | Canary | deployed/live | Human | Baseline verdict |
|---|---|---|---|---|---|---|---|
| App loads and states true readiness | RWT-03, C-03 | partial | mock-only | readiness only | partial | observed | **partial** |
| One Start → one bounded outcome | RWT-01–04, C-05 | partial | mock-only/fake media | no product check | uncovered | observed failure | **uncovered** |
| Cold candidate acquisition and recovery | RWT-07–09, RWT-23, C-03 | partial/mocked | mocked assets | no product check | manual evidence only | observed failure | **human-only** |
| During-state transcript/mic truth | C-10–12 | partial | mock-only | none | none | PO judgment | **human-only** |
| Stop → durable save within an experience budget | RWT-12, C-02, C-09 | partial | mock-only | none | Practice Loop diagnostic partial | observed | **partial** |
| Automatic suggestions reach exactly one terminal rendered/failure outcome | T-02/T-03, C-08 | casualty + helper tests | mock-only | none | one narrow diagnostic | two successes observed | **partial**; real spec was nonqualifying |
| Focus Points registration and coverage | RWT-05, C-06 | partial/mocked | backend mocked | none | none recurring | observed failure | **human-only/uncovered gate** |
| Reload/retry/recovery keeps journey usable | RWT-06, RWT-20 | partial | mock-only | none | none | observed failure | **uncovered** at baseline |
| Error is accurate, singular, and terminal | RWT-02, RWT-10/11/22 | component partial | mock-only | none | none | observed failure | **uncovered** |
| Requested = observed = persisted hidden candidate | RWT-19 | strong evidence machinery | partial | none | comparison path held | PO confusion | **partial**, not a customer-visible requirement |
| Test instrument is passive | RWT-01/04, T-05 | synthetic only | none | none | none | causal evidence | **uncovered** |
| Telemetry reconstructs journey without content | RWT-09/12/21, C-04/07/11/12, T-08 | vocabulary/allowlist tests | mock-only | none | partial readback | manual correlation | **partial** |

## Why `#1437` and `#1432` did not own this matrix

`#1437` was directed to establish the denominator and deliver two-product traceability, but its final implementation was narrowed to an inventory plus a single deployed Practice Loop diagnostic. The diagnostic was useful and appropriately labeled nonqualifying; it was not a matrix for Open Mic, Focus Points, acquisition, Start, reload, coverage, error, or recovery.

`#1432` then deliberately excluded an all-journey register and broad test work to protect the three-model downselection scope ([scope correction](https://github.com/relativityE/speaksharp/pull/1432#issuecomment-5647280175), [selective promotion rule](https://github.com/relativityE/speaksharp/pull/1432#issuecomment-5647294398)). Its evidence schema required a qualifying persisted take and observer receipt. A stall, blocked Start, acquisition failure, ghost recording, reload mode loss, or coverage-unavailable result therefore became an unstructured HOLD rather than a first-class journey outcome.

That scope firewall was reasonable for `#1432`; the delivery failure was that the traceability work removed from `#1432` was not completed elsewhere. This register closes the documentation gap without turning one PR into an implementation omnibus.

## Ruled out / do not reopen

- Automatic AI suggestions rendered in both successfully saved sessions; do not duplicate merged `#1422`.
- The evidence pull was content-free; no transcript or suggestion content belongs in repository evidence.
- The `index.html` request on Start was a bounded freshness check, not a defect.
- The audio worklet was served as JavaScript; the SPA-fallback hypothesis was refuted.
- Session replay/autocapture/Sentry replay were off in Production.
- A missing customer-facing model indicator is not grounds to expose a selector; RWT-19 is tester/evidence support only.

## Source index

- [`#1432` PM package](https://github.com/relativityE/speaksharp/pull/1432#issuecomment-5659014375)
- [`#1432` row-by-row results](https://github.com/relativityE/speaksharp/pull/1432#issuecomment-5659031757)
- [`#1432` initial RWT list](https://github.com/relativityE/speaksharp/pull/1432#issuecomment-5658290488)
- [`#1432` scope correction](https://github.com/relativityE/speaksharp/pull/1432#issuecomment-5647280175)
- [`#1437` authoritative-register requirement](https://github.com/relativityE/speaksharp/pull/1437#issuecomment-5647261377)
- [`#1437` final implementation scope](https://github.com/relativityE/speaksharp/pull/1437#issuecomment-5646972559)
- [`#1437` post-merge closure](https://github.com/relativityE/speaksharp/pull/1437#issuecomment-5651121397)
- [`#1399` nonblocking transfer](https://github.com/relativityE/speaksharp/pull/1399#issuecomment-5659070994)
