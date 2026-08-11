**Status:** Authoritative
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-08-11
**Last Verified:** 2026-08-11 against current main, open implementation heads, and the retention migration contract
**Applies To:** The SpeakSharp Private Practice Loop
**Class:** Product requirement / decision
**Authority:** User-visible product guarantees, failure behavior, non-goals, and the single owner for each open requirement
**Not Authoritative For:** Current SHAs, CI, deployment, or go/no-go state (→ [RELEASE_STATUS.md](./RELEASE_STATUS.md)); sequencing (→ [ROADMAP.md](./ROADMAP.md))
**Supersedes:** Stale multi-product, alternate-transcription, and historical completion contracts
**Evidence Sources:** Current frontend, database migrations, [issue #1257](https://github.com/relativityE/speaksharp/issues/1257), and issues linked in the ownership table

# SpeakSharp Product Requirements

## Product contract

SpeakSharp helps a person practice an important speaking moment privately, understand grounded evidence from the take, choose one useful improvement, and repeat.

It is one product with two practice modes:

1. **Open Mic** — practice without declaring required points; review delivery evidence and one next action.
2. **Focus Points** — declare the ideas that must land; review which points were detected and what to retry.

“Detected” and “not detected” describe a conservative matcher. They are not semantic certainty and never prove what the speaker intended or failed to say.

## Transcription and failure behavior

- Every customer practice uses **Private on-device transcription**, independent of plan.
- Customers are not offered an engine selector or an alternate transcription fallback.
- Private never silently falls back to Cloud.
- A failed Private setup, recording, or finalization fails closed with truthful recovery or retry guidance.
- Initial setup may require a local model download with visible progress.
- A recording uses one locked engine from start intent through finalization, save, retry, recovery, or confirmed discard.

## Practice Loop

1. Choose Open Mic or Focus Points.
2. Optionally use a prompt or read-aloud helper.
3. Wait for an explicit ready cue.
4. Record, stop, and finalize locally.
5. Save the exact session or preserve recoverable work after a failure.
6. Review the transcript and evidence grounded in that take.
7. Receive one primary next action.
8. Repeat with only the relevant intention preserved.
9. Reopen the exact saved session after reload.
10. Compare progress only across sessions that satisfy the comparison contract.

A completed Focus Points brief is review state for that saved session. It must not populate the objective, point list, coverage rail, delivery strip, or point score of a later Open Mic take.

## Privacy, storage, and retention

- On-device speech audio is transient and is not persisted or sent to a transcription provider.
- Transcript and coaching text may be stored with a saved session and may be processed only by the service providers required for explicitly used server-backed features.
- Telemetry and support alerts must exclude audio, transcript text, free-form coaching text, email addresses, and raw user identifiers.
- The repository contains source-only retention migrations, but they explicitly state that they are not applied to production. Therefore this contract does **not** promise a newest-session count, deletion timing, or account-deletion control. Any exact retention or deletion promise requires separately authorized implementation, deployment verification, and Product Owner approval.

## Commercial state

- The controlled beta has a usable free path and requires no card.
- Private transcription is never a paid-plan benefit.
- Paid enrollment is outside the launch contract and must remain fail-closed unless product definition, operational evidence, and activation are separately approved.

## Release standard

Flawless Launch requires the deployed Private Practice Loop to work without operator help on supported devices; product, legal, pricing, tester, and runtime claims to agree; failures to preserve trust and recoverable work; observability to remain content-free; and operators to rehearse GO/HOLD and rollback.

## Open requirement ownership

Each surviving open requirement has exactly one current issue owner.

| Issue owner | Single surviving requirement |
|---|---|
| [#1254](https://github.com/relativityE/speaksharp/issues/1254) | Align every public, legal, pricing, analytics, Practice, signup, and tester surface to the Private-only product truth and enforce the copy contract. |
| [#1255](https://github.com/relativityE/speaksharp/issues/1255) | Make the session shell usable at supported phone widths without overflow and preserve the intended content order. |
| [#1256](https://github.com/relativityE/speaksharp/issues/1256) | Isolate completed Focus Points review state and prove the next Open Mic take starts clean. |
| [#1257](https://github.com/relativityE/speaksharp/issues/1257) | Maintain one canonical release status, requirements contract, detailed backlog, and roadmap. |
| [#1258](https://github.com/relativityE/speaksharp/issues/1258) | Qualify the deployed authenticated Private Practice Loop on supported real devices. |
| [#1259](https://github.com/relativityE/speaksharp/issues/1259) | Establish sanitized telemetry, a clean baseline, failure alerts, and actionable SLOs. |
| [#1260](https://github.com/relativityE/speaksharp/issues/1260) | Remove the unaffiliated domain from active repository surfaces and enforce a zero-reference CI guard. |
| [#1261](https://github.com/relativityE/speaksharp/issues/1261) | Verify hosted callers of exposed privileged database functions and apply only the exact hardening that verification supports. |
| [#1262](https://github.com/relativityE/speaksharp/issues/1262) | Make merged unit coverage fail closed without restoring the previous latency. |
| [#1263](https://github.com/relativityE/speaksharp/issues/1263) | Compare the maintained Private implementations and clean flag state without introducing a customer selector. |
| [#1264](https://github.com/relativityE/speaksharp/issues/1264) | Add optional Open Mic Practice Focus and preserve it through repeat. |
| [#1265](https://github.com/relativityE/speaksharp/issues/1265) | Define and show comparable personal progress with one next action and no universal score. |
| [#1266](https://github.com/relativityE/speaksharp/issues/1266) | Keep the beta free and define one evidence-based future paid offer. |
| [#1267](https://github.com/relativityE/speaksharp/issues/1267) | Provide Private-only launch support, rollback, and Product Owner GO/HOLD procedures. |
| [#1268](https://github.com/relativityE/speaksharp/issues/1268) | Define one discourse-marker metric and add personalization only through explicit opt-in after launch. |
| [#1275](https://github.com/relativityE/speaksharp/issues/1275) | Upgrade Vitest to 4.1.0 or newer and retire the temporary `GHSA-5xrq-8626-4rwp` suppression without regressing coverage or sharding. |

Anything not mapped above is completed history, rejected scope, or non-authoritative evidence—not an active product requirement.
