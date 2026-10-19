# Case 2: Start helper rejects an in-progress model warm-up

Refs #1593. Source base: `83029ebb67216b2690eeff59e4ec1730d5f6ffe8`.

## Reproduced cause

`startBenchmarkRecording` reads `data-model-status` once. `micControlFor('loading')` intentionally has no actionable control: the actual MicCard disables Start while the model prepares. The helper therefore rejects immediately even when the model would become ready moments later. The Products-to-Focus path already calls this helper after its switch/setup sequence, so the correction belongs in the shared helper rather than another caller delay.

Nine new controls against the original helper produced **9 FAIL / 35 PASS** (`baseline-red.json`). These include the concrete loading-to-ready schedule, in-flight auto-resume, and terminal/lost-readiness outcomes. The existing 35 controls continued passing. A separate source-extraction probe reproduced premature rejection on all 30 deterministic loading-to-ready schedules; this demonstrates the one-shot read's mechanism, not its frequency in production.

## Correction

Only an observed `loading` state receives a model-readiness wait, capped at 30 seconds. It ends when the model leaves loading or an already-resuming take exposes its Stop control. A running take receives no second activation. Ready can proceed; terminal statuses, missing observations and a bounded timeout remain explicit failures. The wait never presses Retry or Download to hide the observed failure or grant consent.

The subsequent existing control budget remains separately bounded at eight seconds. Its readiness predicate returns the actual enabled DOM element or the already-running sentinel. There is no separate locator re-resolution. The element remains pinned through the explicitly preserved active human-reflex delay (500/1000 ms in RWT); waiting, delay and activation share the eight-second budget. A detached node fails rather than resolving to a new take's Start. Existing cold one-press download/auto-resume behavior, state-specific initial controls, and refusal-before-preparation contracts remain in the regression set.

## Executed evidence

| Receipt | Actual result | Scope |
| --- | --- | --- |
| `baseline-red.json` | 9 FAIL / 35 PASS | Original helper plus first nine regressions |
| `focused-green.json` | 48 PASS | Corrected helper, all original controls and thirteen added controls |
| `affected-green.json` | 102 PASS across four suites | Helper, switch isolation, actual rendered benchmark surfaces and MicCard rendered-state controls |
| `review-red.json` | 4 FAIL / 48 PASS | Published a474 source: real reflex installation omitted by pinned click, borrowed replacement and modeled 90-second default locator capture |
| `review-green.json` | 59 PASS across two suites | First correction: 52 helper controls plus seven existing actual reflex controls |
| `review-affected-green.json` | 116 PASS across five suites | 55 helper controls, existing reflex/switch/rendered suites; identity through delay, auto-resume and total-budget negatives included |
| `final-review-green.json` | 117 PASS across five suites on c9d46b2d | Final helper/control correction, including the same DOM node changing from Start to Retry during reflex; no silent activation |
| `activation-red.json` | 1 FAIL / 56 PASS | Published 5e69 source: same node changes Start to disabled/loading then Retry during actionability after the final check |
| `activation-green.json` | 64 PASS across two suites | First event-time guard correction plus existing reflex controls |
| `activation-final-green.json` | 121 PASS across five suites | Final event-time identity guard, product-handler exclusion, cleanup after rejection/timeout, valid post-click changes and transient identity excursion |

The initial `pnpm quality` and staged path guard passed on the initial implementation. Sam then returned two in-scope defects on a474: ElementHandle actions bypass the actual Locator/Keyboard human-reflex wrapper, and separate Locator.elementHandle lookup waits for attachment under the page default, potentially capturing a replacement. The installed Playwright client confirms that elementHandle delegates to waitForSelector(state='attached'), while waitForFunction returns the observed JSHandle. The new controls exercise actual applyHumanReflex class wrapping and model the default 90-second attachment wait; these are not claims of an executed Playwright browser run.

The 116-control run preceded the disjoint main update to `c9d46b2d4ffef7530cb0cccaa533b5818d200320`; helper/test bytes were unchanged by that update. The final 117-control run executes on that base, adding a control for the same element changing action identity during reflex. The full new `pnpm quality` checkpoint exited 0 on that base with the final correction; the final staged all-tracked path guard passed 3/3. Fresh exact-head CI and independent review remain required.

Sam's residual actionability RETURN on 5e69 was independently reproduced after those 117 controls passed. The existing identity check still preceded native click's actionability wait. The final correction retains the native ElementHandle click and adds a temporary document-capture click guard for this one action. It validates the pinned node and action identity at activation, drains/latches intervening identity/disabled mutations, and prevents invalid attempts from reaching MicCard's onClick. Such attempts fail the harness; they never become a passing Start or an automatic Retry/Download. Accepted activation removes the guard before normal product post-click transitions. Rejection, timeout and all exits remove the listener/observer in `finally`. No synthetic click replaces native input, and no product/shared prototype or caller is modified. The tests execute that actual page guard against jsdom native capture/propagation and model the actionability wait; a real Playwright browser/live run is not claimed.

**Additional actual native-browser proof:** `native-activation-probe.mjs` extracts the exact baseline 5e69 and corrected Start functions with TypeScript AST, stubbing only phase logging and error snapshots. Local headless Chromium executes real Playwright actionability/native click, with a controlled same-node Start-to-disabled-to-Retry schedule at click entry. Baseline activates Retry; corrected source rejects with zero product activations. The actual applyHumanReflex wrapper is installed for separate 500/1000ms controls; each native Start waits its configured interval and activates once. One composite Node test passed; receipt and reproducible script are retained. This is a local fixture browser proof, not a production campaign, real microphone or model/provider run. The final residual-correction `pnpm quality` exited 0; final staged path guard is recorded in ACTIVE_HANDOFF.

The tests call the actual helper with jsdom-backed Playwright-compatible page doubles. The related rendered suites mount actual product components. This is offline evidence; no new browser/live campaign, provider call, account mutation or model execution occurred. Test names and failure text are retained. JSON machine-path string prefixes are normalized before publication, with raw bytes and hashes retained separately.

## Handoff and limits

App remains the product-fix and shared Focus-caller owner. This increment edits only the two explicitly leased helper/test paths. Sam owns independent exact-head review, CI qualification, serialized landing and any authorized release-bound targeted rerun.

This correction does **not** establish a live case 2 PASS, resolve provider quota, prove the original unanswered coaching request, close the Stop-order targeted rerun, or resolve the separate historical Products-menu race. A release-bound rerun must retain the original case outcome and report model readiness, one recording, save/review and diagnostic-chain evidence separately.
