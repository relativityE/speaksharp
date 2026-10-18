# Browser PM: campaign evidence review and final-release packet

Prepared 18 October 2026. Review/preparation only; operational HOLD. Coordination #1593. App owns implementation/execution, Sam central review/scope, PO specific approval and human acceptance. This packet does not dispatch or grant authority.

## Exact reviewed inputs and completed work

- Rejected adapter: `test/1593-campaign-helper-integration@7e3e6872836153becf9671e8000add428dc54b6d`; collect blob `481772af0699cea561d72f917e7e6955204621c9`.
- Maintained sources independently fetched at `188950542cd62919f11072e924843759cd3a10d9` (#1648 squash). GitHub confirms merge at10:12:54UTC. App reports canary39118365501 SUCCESS and served=S at10:15:37; Browser PM has not performed a new Production query.
- Reference contract: `ecd2c048`, vendored blob `fe5b6c7948274d7a20af1cbad34365c439830a51`; unchanged.
- Independently executed existing reference+adapter suites: **81/81 PASS**. This is offline characterization, not adapter safety or live acceptance.
- Independently executed six new review probes: **6/6 reproduced the known gaps/source mismatch**. Their PASS means the old adapter demonstrably accepts bad evidence or rejects the maintained schema. They are not regression acceptance for a corrected adapter.
- Commands: `node --test local-packets/1593-bootstrap/contract.test.mjs local-packets/1593-campaign-helper/collect.test.mjs`; `node --test local-packets/1593-pm-review/review.test.mjs`. No network/live calls in tests; fetched source snapshots were used locally.

## Consolidated review return — one App implementation batch

1. **Source-faithful identities:** Open Mic emits `signup` (spec:291), shared identity emits `session bears canary claim` (rwtJourney:1897–1905). Focus has no signup PASS row. Old DOMINANT_ROWS requires different labels. Fixtures must derive from each maintained suite, not rename the suite to fit synthetic fixtures. Never add absent evidence.
2. **Received artifact:** rc-gates.yml:367–448 acquires per-journey results, then writes `*.readback-verdicts.json`. Upload459–465 names `rwt-receipts-attempt-${github.run_attempt}`. Download/verify that exact attempt artifact; mere RWT_RECEIPT log presence is not readback. Validate suite/release, declared stage and attempt bindings, missingBindings, received FAIL/HOLD and bound coachingDiagnostic where applicable. Finalized receipt plus mandatory readback must agree.
3. **Provenance:** verify actual run/workflow/head/run_attempt/case/spec/grep/artifact identity and one unambiguous matching receipt; bind numeric zero-residue cleanup to that same case/account scope. Old ledgerEntry copies campaign/config/cleanup scope from authority and treats any parsed receipt as mandatoryReadbackComplete. The unrelated-suite probe obtains GO without artifact or received readback; a two-receipt log silently picks the first. Both must HOLD in the corrected adapter.
4. **Dominant stops:** privacy/content-free FAIL, unknown provider cost, unanswered/body-pending requests, selected outage/effect stops and missing required readback cannot be overridden by continuationApproved. Independent probes reproduce GO for privacy FAIL and unanswered cost HOLD. rwtCoachingCollector:360–419 already distinguishes browser requests from provider attempts; reuse it without fabricated zero/planned count. Ordinary product continuation is a separate scoped Sam disposition; it never waives these stops.
5. **Bootstrap/activity/freshness:** source-bound no-earlier-attempt and prior cleanup reconciliation; no hardcoded verified ledger, absent arrays defaulted empty, latest20-only activity or authority-stamped dependency proof. Query complete relevant active runs including older queued/waiting runs, verify dependencies or explicit bounded attestation, and take fresh decision time after collection. Expiry during collection must HOLD. Case1 remains explicit bootstrap/null predecessor; cases2–15 require actual ordered finalized predecessors.
6. **Maintained counts:** App's selected test-side change must emit whole-scenario automatic counts for Open Mic/full Focus/partial Focus, maxima4/7/4 with bounded settle. Existing production collector reports unanswered/malformed diagnostics as HOLD and enforces per-request provider cap3. First-three source currently lacks this budget emission. Separate maintained-spec PR from local helper; qualify/serve the source change, then rebind S/config. No manual-count decision remains pending.

These are the same six groups Sam consolidated at1792317800.759069, not a competing implementation. App acknowledged the full set at1792320040.661479. All remain open until the corrected exact artifact is independently reviewed. The immutable review probes intentionally characterize only the rejected head; App's successor tests must assert HOLD for unsafe inputs.

## Executable-case / expected-observation matrix

Binding source is collect.mjs CASES, independently checked against exact maintained spec titles (one selected test each). Nine spec groups, 15 serial cases; workers1, retries0, fullyParallel=false. Browser-request maxima sum30; theoretical provider reservation90 (max3 per browser request). This arithmetic is an allowance, not proof of actual consumed cost. All current-campaign live rows remain NOT RUN in this packet; historical runs do not populate them.

| Case | Maintained spec / exact grep | Max | Expected observed result | Current proof |
|---|---|---:|---|---|
| 1 | `tests/live/rwt-open-mic-first-session.live.spec.ts` / `a new person completes a first Open Mic session` | 4 | First Open Mic: real signup/sign-in, verified model/take identity, exactly-once save, visible=saved coaching, review/analytics/practice/next-take evidence. | NOT RUN; final corrected release pending |
| 2 | `tests/live/rwt-focus-points-session.live.spec.ts` / `PO corpus` | 7 | Full Focus: point markers/verdicts and persisted coverage; useful full coaching; New Set/Edit/product switching and repeated/next takes. | NOT RUN; final corrected release pending |
| 3 | `tests/live/rwt-focus-points-partial.live.spec.ts` / `partial fixture` | 4 | Partial Focus: partial points remain honestly not detected; visible/saved coverage and coaching; repeat/next-take and cleanup remain independent of full Focus. | NOT RUN; final corrected release pending |
| 4 | `tests/live/rwt-pending-start-navigation.live.spec.ts` / `leaving during a cold Start` | 0 | Cold Start navigation: leave while pending; release microphone; create no saved session; return exposes truthful Start without resuming. | NOT RUN; final corrected release pending |
| 5 | `tests/live/rwt-save-retry-recovery.live.spec.ts` / `request lost` | 2 | Request-lost save: alter completion once; honest recovery; Retry Save produces one saved take; next take saves only itself. | NOT RUN; final corrected release pending |
| 6 | `tests/live/rwt-save-retry-recovery.live.spec.ts` / `response lost` | 2 | Response-lost save: same durable-save boundaries independently proved after the response loss. | NOT RUN; final corrected release pending |
| 7 | `tests/live/rwt-feedback-association-boundaries.live.spec.ts` / `feedback selected for an older take` | 2 | Older-take feedback: two takes, selected older take's own request, exact diagnostic association and received chain; never borrow current take. | NOT RUN; final corrected release pending |
| 8 | `tests/live/rwt-feedback-association-boundaries.live.spec.ts` / `No session feedback` | 0 | No-session feedback: stored once with no-session association; must not invent a coaching chain or prompt-binding. | NOT RUN; final corrected release pending |
| 9 | `tests/live/rwt-abandon-and-two-tabs.live.spec.ts` / `navigate away mid-recording` | 2 | Navigate away mid-recording: answer Leave; saved left take, released mic, honest recovery and independent next take. | NOT RUN; final corrected release pending |
| 10 | `tests/live/rwt-abandon-and-two-tabs.live.spec.ts` / `close the tab mid-recording` | 2 | Close tab mid-recording: released recording/lease, honest return, no resumed abandoned take, truthful next Start. | NOT RUN; final corrected release pending |
| 11 | `tests/live/rwt-abandon-and-two-tabs.live.spec.ts` / `one account, two places` | 2 | Two tabs/devices: same-browser refusal, account lease refusal, explicit takeover moves one engine; both takes saved and none active. | NOT RUN; final corrected release pending |
| 12 | `tests/live/rwt-adverse-mic-model.live.spec.ts` / `mic denied` | 1 | Mic denial: honest blocked state, no capture; after allowing permission, one real take saves. | NOT RUN; final corrected release pending |
| 13 | `tests/live/rwt-adverse-mic-model.live.spec.ts` / `model download fails` | 1 | Download fails: honest failure; explicit retry acquires model and a take saves; no Cloud STT fallback. | NOT RUN; final corrected release pending |
| 14 | `tests/live/rwt-adverse-mic-model.live.spec.ts` / `offline mid-download` | 1 | Offline mid-download: honest interruption and explicit recovery; acquired model/take proof without hidden fallback. | NOT RUN; final corrected release pending |
| 15 | `tests/live/rwt-products-navigation.live.spec.ts` / `an existing user signs in` | 0 | Maintained returning user: login/history/Products Open Mic↔Focus; no mic on navigation; navigation writes nothing; no write/claim ACK or cleanup. | NOT RUN; final corrected release pending |

### Suite-specific mandatory and absent evidence

Use rwtAcceptance.ts:373–581, not a universal invented row list. Open Mic/full+partial Focus declare received journey rows. Feedback older-take and no-session declare their own received boundaries; no-session forbids coaching-chain/prompt-binding evidence. Pending Start, save-loss, abandon/two-tabs and adverse suites explicitly forbid journey readback rows because they qualify no journey; require their actual product/cleanup schema instead. Returning-user similarly forbids journey readback and must prove navigation writes nothing. A readback that is inapplicable by source is not a missing required readback; an absent/unreadable artifact or mandatory binding remains HOLD. Never manufacture empty QUALIFIED outputs for bridge suites.

Cases1–14 use individually bound run-owned disposable accounts and only approved scoped creation/claim/permanent cleanup. Each actual predecessor must have verified numeric residue0 in its approved scope before continuation, even where receipt-row requirements differ. Case15 uses the selected maintained account read-only, neither ACK, no account cleanup; read-only operation proof is required in addition to ACK absence. No global customer deletion authority is inferred.

## PO human/device worksheet — no automated substitutes

Complete the maintained per-run worksheet and finalize it against the same suite/release/journey ids/receipt filename. Record PASS or FAIL and named observer; do not fill results before actual observation. rwtAcceptance.ts:343–369 defines required IDs. Synthetic Open Mic adds its human “uh” check; real speech uses its own transcript evidence. Full and partial Focus are separate observations.

| Case/scope | Observation ID | Pass criterion | Result | Observer/device/run binding |
|---|---|---|---|---|
| case1 | `open_mic_coaching_relevant` | Each phrase relates to what was said in this take, rather than generic advice. | PENDING | PENDING |
| case1 if synthetic | `open_mic_uh_detected` | Human-spoken “uh” is marked live and saved; synthetic fixture cannot establish this. | PENDING | PENDING |
| case2 | `focus_coaching_covers_points` | Judge full Focus advice against the actual saved points/take; do not infer usefulness from rendering. | PENDING | PENDING |
| case3 | `focus_coaching_covers_points` | Judge partial Focus independently; retain honest missing-point treatment. | PENDING | PENDING |
| release/device | `real_microphone_permission_prompt` | Fresh real-device browser profile: prompt appears; Allow records; Deny explains and never records. Record device/OS/browser. | PENDING | PENDING |
| release/device | `mobile_stop_confirmation_visible` | Real phone: flick recording page, tap Stop in motion, wait; saved confirmation remains in viewport. Record phone/OS/browser. | PENDING | PENDING |

Only the two coaching-quality IDs may be NOT_EXERCISED under their own proved EXTERNAL parent, as the maintained finalizer permits; absent coaching never becomes quality PASS. Other human/device checks remain required. Supplemental automated scenarios have no invented human rows. Device actions involving real recording require their own scoped authority; the automated maintained-account navigation case stays read-only.

## Single final-release approval/acceptance packet — prepared, not approved

| Field | Prepared value / precise missing input |
|---|---|
| Last source/served observation | S188950542cd62919f11072e924843759cd3a10d9; App's10:15:37UTC observation, not a fresh PM read. |
| Final campaign S | **PENDING:** App's maintained-spec correction must qualify/land/serve; existing S is not final after that change. |
| Final effective config digest and dependency blobs | **PENDING:** recompute on final S across workflow/live config/9 specs and actual imported dependency proof or explicit bounded attestation; old1f504273… preliminary binding cannot be copied forward. |
| Corrected helper commit and independent result | **PENDING:** App's complete six-group successor;7e3e687 remains operational HOLD. |
| Qualification/served/canary receipts | **PENDING:** exact final source qualification and post-landing observation, separately recorded. No unrelated landing during the campaign. |
| Cases/commands | 15 exact spec/grep pairs above; Gate3 workflow on main at S; base URL https://speaksharp-public.vercel.app; comparison_cell=none; reflex500ms. No command executed by PM. |
| Limits | One worker, retries0, serial; maxima4/7/4/0/2/2/2/0/2/2/2/1/1/1/0, total30 browser/90 theoretical provider. Actual known cost required before successor. |
| Account scope | 14 separate run-owned disposable identities/case/run/attempt bindings; case15 named maintained identity read-only. **PENDING:** executor's verified account bindings/nonsecret identity proof. No credentials in this packet. |
| Specific PO authority | **PENDING:** exact final S/config, selected cases/window, bounded effects/account scope, run-owned creation/claim/permanent cleanup and maintained read-only permission. Urgency is not approval. |
| Fresh pre-dispatch decision | **PENDING at each case:** main=served=workflow=S, unchanged config/dependencies, complete idle activity, unexpired approval and guard, correct actual predecessor, finalized mandatory evidence and zero residue. |
| Per-case receipt ledger | NOT RUN: actual run/attempt, suite/spec/grep, artifact id/name/digest, release/config, request/provider counts and uncertainty, received verdicts, cleanup and human fields. No receipt or wake success invented. |

Before case1, source-bound bootstrap reconciles prior campaigns and proves no existing attempt. Before every successor, Sam dispositions ordinary product failures only after mandatory proof/cleanup and without dominant stops. On drift/unknown cost/privacy/outage/effect/cleanup or missing binding, stop; do not replay an uncertain attempt. App executes only after the final specific PO approval. Sam remains central coordinator. Broader #1643 account/global-drain work is independent and does not become a new RWT entry condition.

## Source manifest

| Path at S18895054 (unless explicitly adapter ref) | Blob SHA |
|---|---|
| `tests/live/rwt-open-mic-first-session.live.spec.ts` | `f47e46c13ca27c5dd420b34ae28a2170e4744af3` |
| `tests/live/rwt-focus-points-session.live.spec.ts` | `72c770f4d8a21a7fb4898db6c6164e13ae5645bb` |
| `tests/live/rwt-focus-points-partial.live.spec.ts` | `1d3398a86767c497ff911b17c62e6830126f8203` |
| `tests/live/rwt-pending-start-navigation.live.spec.ts` | `5dac7f9e3547d9d6079a653e43c6e46a7e330742` |
| `tests/live/rwt-save-retry-recovery.live.spec.ts` | `36106d6a12aca3afcd36a44581fe36a1c32d73f5` |
| `tests/live/rwt-feedback-association-boundaries.live.spec.ts` | `75419151b7d7ece304540d091d5493db02f017d7` |
| `tests/live/rwt-abandon-and-two-tabs.live.spec.ts` | `54ec853c6303406d5d855d865d7dca6fdbd3099a` |
| `tests/live/rwt-adverse-mic-model.live.spec.ts` | `fa187ecd1b418b4ea0b01c87e9a15a45c5ae862e` |
| `tests/live/rwt-products-navigation.live.spec.ts` | `d57ff839d55e44506ef9e00cfa1978a6a7db10ee` |
| `playwright.deployed-live.config.ts` | `0b0d5147c0b993f88c55b424c0e45838fa5e12a6` |
| `.github/workflows/rc-gates.yml` | `aadb4767083fe5cbd693c68dd35741fe4a655b22` |
| `tests/live/helpers/rwtAcceptance.ts` | `cdf8841bf1c018698a212d579dda813200a8d33c` |
| `tests/live/helpers/rwtJourney.ts` | `7d076b1ff4a9ef9f5a543cbce6e73891d3077442` |
| `tests/live/helpers/rwtFocusPointsJourney.ts` | `9d422858d465692f8f225a4b776b2c74a73e52ba` |
| `tests/live/helpers/rwtCoachingCollector.ts` | `ca9c0cf24dbd3fbbd3af5e9dcf9b8e6e4d7b4336` |

This is an evidence-review artifact, not a release source change. Keep the already reviewed six-file cf6a59cd model-phase correction in its selected later integration slot; it must not move the campaign candidate mid-run.
