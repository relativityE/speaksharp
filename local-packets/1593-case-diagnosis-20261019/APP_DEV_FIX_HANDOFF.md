# App Dev implementation handoff: live cases 3, 4, 9 and 11

Prepared by Browser PM,19 October2026. App Dev is the sole implementation writer. Follow the current selected branch/release sequence; this is a bounded handoff, not a second implementation or permission to run live tests.

Evidence: [independent diagnosis](DIAGNOSIS.md), [original receipts](retained-receipts.json), [executed source probes](source-probe-results.json). All original runs below used ecce3e8d9e154ddb12f7238a514f0ec85d4b75b4, attempt1. Implement against the selected current source, preserving later accepted changes; do not restore the historical files wholesale.

## Apply in this order

|Order|Work|Where|Done when|
|---|---|---|---|
|1|Finish the existing#1662 response/commit-order successor and its review.|Current#1662; b0dd763aa20ccb9a2b5ee1936dad2f1d290d7eaa observed06:25UTC, CI39209793072. Sam owns disposition.|Both event schedules plus failure/supersession controls accepted on the actual selected head; normal qualification. This handoff gives no new verdict on b0dd.|
|2|Fix the two confirmed harness interactions: case9 modal and case11 refusal-before-preparation.|tests/live/rwt-abandon-and-two-tabs.live.spec.ts and its existing helpers/tests.|Failing-before/passing-after controls below, with original journey assertions retained. Keep these bounded harness edits out of product behavior.|
|3|Complete case4 gate observability in the already planned telemetry integration.|MicCard composition, useSessionLifecycle, SessionOverhaulView and existing telemetry/receipt adapters.|One coherent render-time gate snapshot distinguishes the actual blocker; instrumentation and negative controls pass. Do not guess a product fix from the old label.|
|4|Install case3 timing observation before Start; integrate the already selected final-transcript ordering correction separately.|tests/live/helpers/rwtFocusPointsJourney.ts; the existing App-owned transcript/Stop implementation.|Actual marker-change times and existing oracle preserved; product cause is distinguishable from late sampling. Stop/finalization correctness is not claimed to solve a during-speech timing failure.|
|5|Publish one exact-head correction packet for independent review; propose the smallest release/rerun scope.|Actual owning PR, linking#1593.|Sam has source/review/CI evidence; final served-release binding and operational approval are explicit before any targeted live execution.|

The order names logical increments, not a requirement for five PRs. Use the existing selected lane and avoid expanding#1662 beyond its accepted scope. Do not repeat accepted cleanup, transfer/init-budget or page-lifetime fixes. Check the latest dispositions before starting a subtask already completed by another owner.

## Case9: close Focus setup before clicking Products again

**Original failure:** run39179788446, job117829896871. After leaving the recording successfully, the Focus setup dialog intercepts the next Products click. The log names objective-setup-form within objective-setup-dialog. The script navigates into Focus and never dismisses setup before returning to Open Mic.

**Implementation:** in the navigate-away variant, after arrival and the existing leave/microphone checks, dismiss the expected fresh-account setup through the real user interaction. Prove it closed, then use the existing Products helper. The pending-Start case already contains this pattern; reuse it rather than changing the menu's interaction policy.

For this fresh-account branch, where opening Focus is expected to open setup:

```ts
const setup = page.getByTestId('objective-setup-dialog');
await expect(setup).toBeVisible({ timeout: 15_000 });
await page.keyboard.press('Escape');
await expect(setup).toHaveCount(0, { timeout: 10_000 });
await openProductsItem(page, 'open-mic');
await page.waitForURL(/\/session/, { timeout: 45_000 });
```

Adapt placement to the selected source. A reused helper must take the scenario's expected setup state explicitly; an instantaneous isVisible check can miss a dialog that is still opening. Do not globally dismiss dialogs inside every Products action. Do not force-click through the overlay, navigate directly to/session, or weaken the exact Leave-confirm handler: those would skip the journey under test.

**Regression controls:** an open setup modal blocks the header click before the correction; the real close-then-Products sequence succeeds after it. A modal that fails to close still fails within the bound. Preserve exact leave-confirm handling, no unexpected dialogs, stopped microphone/no extra acquisition, persisted left take and original return/repeat checks. Source correction alone does not turn the historical run into PASS.

## Case11: observe cold lease refusal before waiting for any model preparation

**Original failure:** run39179796291, job117829919835. preparePrivateModelIfPrompted on deviceB waits for download-required to change and throws after30s. The account-lease refusal row is later in the script and never executes. A correctly refused cold Start should not begin model preparation, so the helper's success condition conflicts with the behavior being tested.

**Implementation:** split B's refused attempt from its admitted takeover. Preserve the existing same-browser local-refusal subcase and distinguish it from the separate-context account-lease subcase.

1. Keep A recording; open a genuinely isolated, normally signed-in B for the same run-owned account. Establish the intended cold state and bind B's page/attempt observation before pressing anything.
2. Snapshot B's existing engine/model request, microphone-acquisition and recording observations. Begin the refusal window before the press.
3. Click the **current rendered Start control once**. On the cold branch this is mic-download; it is a recording request that would download only after admission. Do not call the helper that waits for acquisition/RECORDING.
4. Within a bounded wait, observe the account-lease refusal using the existing BLOCKED_COPY contract and bind its request/attempt/page identity. Prove A still records and B has not started an engine, model acquisition or microphone. Absence of one telemetry event alone is not proof of zero work: retain the available request/mic observations and the existing gate-before-model oracle.
5. Only after that refusal, perform the explicit second Start/takeover gesture within the product's existing takeover window. Resolve the control again; do not assume mic-start appeared while B was refused. This step must be the second press, not a helper that silently adds another click.
6. After takeover is admitted, wait for the expected setup/recording state **without another Start press**. Then retain the actual displaced-A notice/stop, distinct completed B take and existing saved-identity checks. CLI's case10 packet owns the permanent fence, lease exclusion and recoverable displaced-take proof; join it rather than replacing its oracle with zero-active rows.

**Regression controls:** cold valid refusal with no model-status transition; warm valid refusal; missing/wrong refusal; B model/mic work before refusal; A unexpectedly stopping before takeover; second-press admitted takeover; stale first-attempt events; and a helper adding a third press. The first scenario should fail under the historical preparation-first sequence and pass after reordering. Retain both local-tab and account-lease distinctions.

The historical aborted row does not independently prove the lease refusal occurred. Keep that evidence limit until a bound receipt exists. Do not bypass admission, reset the account or prepare B's engine before the refused press merely to satisfy the old helper.

## Case4: identify the gate, then change only the proven owner of it

**Original failure:** run39179780974, job117829875427. On return: modelidle, shellbefore, visible mic-start, plain Start recording label, disabledtrue. Cancellation settled; microphone release, unchanged session identities, no automatic resume and zero coaching passed.

**Proven limit:** actual historical component renders show the same fields for runtimeENGINE_INITIALIZING/finalizingfalse and runtimeIDLE/finalizingtrue. A clear IDLE/nonfinalizing state enables Start. The old receipt does not identify which input was true, how long it lasted or whether a one-shot sample caught a legitimate re-entry transition.

**Implement observability first in the planned start_control_state lane:** derive a content-free snapshot from the same render inputs that compute the control. Include runtimeState; isTranscriptFinalizing; privateModelStatus; model-state blocker; progress-gate present/state and whether resolved for the viewer; startup-wait present; captureLive; rendered control kind; and computed disabled. Retain all active reasons rather than hiding a second blocker behind a single priority label. Bind it to the page/boot/release/attempt and a monotonic sequence/time through existing identity machinery. Publish only closed state/boolean values, not owner IDs, transcript, credentials or uncontrolled error text.

The returned receipt should join the actual rendered disabled state to that coherent input snapshot. A later store read mixed with earlier DOM reads is not atomic proof. Observe transition history within the existing bounded readiness contract; expiry must retain the last gate/reason as FAIL or HOLD as applicable, not silently extend the wait until a PASS appears.

**Use the result to choose the product fix:**

- If an abandoned operation leaves runtime transitional, trace its owning cancellation/teardown transition; retire only that operation and preserve any successor.
- If finalization remains active, prove its owning take and settlement before clearing it. Do not clear a valid post-Stop latch to enable Start.
- If Progress is unresolved, repair the owner-bound reconciliation/receipt path. Do not skip durable debt or inherit another owner's answer.
- If the visible and gate model states diverge, repair that publication/subscription path using source-bound evidence.

These are conditional paths, not four established bugs. First return the exact closed reason and chronology; then patch only the demonstrated cause.

**Regression controls:** clear state enables; each legitimate blocker disables with the corresponding reason; multiple blockers remain visible to diagnosis; cancellation/return reaches a truthful terminal action; an older cancellation cannot clear a newer take's runtime/wait; actual Stop finalization and Progress debt still block. Do not force-enable the button or use modelidle as a substitute for runtime readiness.

## Case3: separate the true marker transition from observer delay

**Original failure:** run39180659914, job117832503703. Fixture hash8a2bdb57440352e473b62e4a190077693d632da0856f3406cf4f33653c08722d. Point1 window2.91–6.21s; point2 starts9.02s. The original deadline is min(6.21+5,9.02)=9.02. First observed9.4s therefore fails the next-point rule;3.2s after point end is inside the separate five-second limit.

**Measurement correction:** install a page-side marker observer before the cold Start can acquire the microphone or begin playback. It must survive the relevant rendered rail replacement and be scoped to the current page/take; disconnect and drain it under the accepted finalization lifecycle. Capture each point's initial state and its earliest eligible transition timestamp, plus observation-start/binding completeness. Keep covered/partial/missing semantics and the rule that an unspoken point must never change. Do not manufacture an initial transition if the observer attached after a point was already marked: classify that timing as unobserved/HOLD.

Use one declared clock with microphone-acquisition time; do not subtract an unrelated Node Date.now from browser performance.now without a verified clock mapping. Reuse the existing fake-audio acquisition origin and record the timing method. Keep polling as a bounded liveness check if useful, while the pre-armed observer supplies the event time. Retain previous pending/first-changed observations or an explicit timing interval; missing observations cannot become exact timestamps.

**Then diagnose the actual product path:** if the DOM transition is truly late, join the first qualifying transcript emission/revision, local coverage decision and DOM publication on the same audio clock. This distinguishes ASR delivery from local matching/render delay. Use hashes/counts and closed statuses; keep speech/brief contents private. Repair only the stage shown late. The App-owned final-transcript/Stop ordering correction remains necessary for its own demonstrated defects, but does not by itself prove this during-speech marker cause.

**Regression controls:** a transition8.90s observed by a slow polling loop at9.40 must retain its pre-armed event time; a real9.10 transition must fail the9.02 deadline. Include observer attached too late, absent acquisition binding, page/take replacement, an unspoken-point mutation, and finalization draining late callbacks. Preserve the original fixture, audio windows and deadline. A new controlled fixture is supplemental and cannot replace this original failure.

Keep coaching separate: two answered502/provider429 exchanges and one unanswered request are real retained evidence. Preserve the coaching-budget HOLD until request-bound terminal/cost reconciliation arrives from Sam's lane. Do not attribute a local live-marker delay to provider quota without a causal join or claim useful Focus coaching from a quota-limited terminal result.

## Validation and return packet

On the selected head, run the focused regressions that cover the changed interaction/observer code, then the repository's required type/lint/quality checks. Existing#1662 focused command, where those files are present:

```sh
pnpm exec vitest run --config frontend/vitest.config.mjs \
  --coverage.enabled=false --maxWorkers=1 \
  tests/unit/rwtWatchdog1593.test.ts \
  tests/unit/rwtTelemetryTransportIdentity1258.test.ts
```

Use the repository's host-interlock wrapper where required by its current instructions. Add the actual new case-regression test paths; those two existing suites alone do not establish the new observer/modal/refusal corrections. Run the normal quality lane once for the resulting change; reuse valid unchanged evidence instead of repeating all suites for status updates. No test command in this document has been newly executed by writing it.

Return to the owning PR, linked from#1593:

1. Exact base/head, changed files, and finding→change→failing-before/passing-after control for each selected case.
2. Actual test commands/results and normal CI/review links. Distinguish author tests from independent disposition.
3. Which causal questions remain unknown, which corrected harness rows still need live proof, and any case10/received-telemetry dependency on CLI.
4. Smallest proposed release/rerun sequence bound to the served SHA, accounts, provider budget, time window and cleanup/retention disposition. Existing authorization is not silently reused for a different release or effect.

Sam owns the exact-head review/release decision; App owns implementation and selected execution; CLI retains cases7/10/15 proof; Browser PM reviews these four corrections independently; CLI PM updates the same15-row closure ledger. Historical PASS5/6/8 remain credited in their dated scope. No merge, deploy, migration, live dispatch, provider spending or destructive cleanup is authorized by this write-up.
