# Bounded independent review of #1662 clock-mapping successor
Browser PM. Exact401da0f3e3d13795f2b8acaf36ce7bcc45eb65fa versus45c579099c86c38a91d1df811856e822e9cdde97. This review accepts only the request-time mapping correction; whole-PR acceptance, qualification, landing and live proof remain separate.

## Executed evidence

Command: `node scripts/host-interlock.mjs hold local -- node local-packets/1593-clock-review-20261019/probe.mjs`.

At13:35:31UTC,10 grouped controls passed using the actual TypeScript DocumentProvenance module and deterministic fake CDP/Page emitters. The parent reproduces a+20ms document-start shift during body retrieval; a capture3ms after the actual document start becomes earlier than the computed start. The successor freezes offsetMs in the browser record, so the same later clock sample leaves the computed document boundary unchanged.

Other controls preserve the boundary across later mappings of−20,0,+100ms, an inline body, and navigation while a delayed body resolves. A rejected body stays unattributed; duplicate candidate matching still invalidates both references; notified source loss with no queued event stays unproven. Actual source hashes and all outputs are in results.json.

This independently executes the responsible provenance boundary. It is not App's91-test suite, the entire watchdog integration, CI, a real-browser frequency estimate for the synthetic clock change, or Production proof. The narrow delta changes only rwtDocumentIdentity.ts and rwtWatchdog1593.test.ts; adverse/window files are unchanged.

## Existing whole-PR gaps verified current

Review threads were read directly with their resolution metadata; both below were unresolved and non-outdated on the current PR:

| Existing finding | Source inspection on401 | Receiving action |
|---|---|---|
| P1 r4314310162, blind telemetry beacon | AnalyticsTap records opaque POSTs as blindBeacons/blindAt without a decoded event. JourneyWatchdog.record checks unresolved/deferred events, provenance and readable DOM, but not that blind observation uncertainty. The clock delta does not change this surface. | App's existing watchdog/tap owner must preserve watched-page/window uncertainty as HOLD unless independently settled; do not globally treat all unrelated earlier beacons as current uncertainty. Add blind-window, foreign-page and positive settled controls. |
| P2 r4313846488, remaining finalizers seal before telemetry settle | The abandon/two-tab and adverse finalizers still call watch.record before their later coaching/cleanup settlement. The new clock delta does not change their source. | App must settle the bounded relevant telemetry before terminal verdict, or otherwise prove later events are included before sealing. Preserve timeout-safe single-flight cleanup/receipt and event capture-time/profile boundaries. |

These are existing Codex findings, not new PM discoveries or thread resolutions. Source inspection corroborates them; this packet does not claim a new executed whole-watchdog reproduction for either. Sam selects the coherent owned correction batch alongside the already-accepted case11 full-window and case13/14 adverse-history/counter findings.

Links: [P1](https://github.com/relativityE/speaksharp/pull/1662#discussion_r4314310162), [P2](https://github.com/relativityE/speaksharp/pull/1662#discussion_r4313846488), [accepted PM adverse evidence](https://github.com/relativityE/speaksharp/pull/1662#issuecomment-6268066765), [accepted PM window evidence](https://github.com/relativityE/speaksharp/pull/1662#issuecomment-6267979400).

## Remaining assignment status

Case1,9/11 and13/14 PM findings and six prepared human/device forms remain delivered. Forms are not observations. Original case13/14 recovery/save/no-Cloud positives remain, with original coaching HTTP502 separate from budget PASS. Stop-order83029ebb deployment is Sam's verified release receipt, not final15-case closure.

CLI #1665 at7e920bd6 was returned for impossible provider-attempt counts and is being corrected by its owner; do not call that older head accepted. App's case4 correction is still local at the latest read. Current source/CI/release states must be refreshed before subsequent work.

No product implementation file changed, no file lease claimed, no live/model/provider/account/DB/deployment operation.

