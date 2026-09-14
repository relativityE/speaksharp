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

## Authoritative RWT register

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

