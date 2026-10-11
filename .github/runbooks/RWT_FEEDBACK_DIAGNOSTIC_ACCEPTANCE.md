# RWT — runbook traceability and Share Feedback diagnostic acceptance (#1258)

**Status:** Working acceptance matrix for the RWT human-readiness gate (PM 6110562760, 6110575633). Engineering
traceability, not release status, not run authority, and not a human-test result.
**Owner:** App Dev (task RWT-feedback-journey-preparation, PM 6110520212); reviewed by Browser PM.
**Source runbook:** `RWT_TWO_PRODUCT_PO_RUNBOOK`, currentized 2026-10-11 at the PO's request (original source dated 2026-09-25),
in #1258 comment 6110783606; the edit history retains the original. Steps are cited by the source's own numbering
(Open Mic 1–8, Focus Points 1–7, returning-user path). This document does not restate or rewrite it; it maps each step to
evidence. PM rulings applied: 6110896661.
**Current status, run IDs, deployed SHA:** `product_release/RELEASE_STATUS.md` and #1258 only.

## 1. Evidence classes (never interchangeable)

| Class | What it is | Can it close a runbook step? |
| --- | --- | --- |
| **MOCKED** | Local E2E build against a scripted boundary (`tests/e2e/feedback-diagnostics-journey.e2e.spec.ts`) | No. Proves visible product logic only |
| **CI** | Exact-head CI on a PR (unit, E2E, DB) | No. Merge evidence only |
| **DEPLOYED** | An authorized `rc-gates.yml` RWT run on the frozen release: receipt rows + server rows + **received** PostHog readback + cleanup | Yes, for its automated rows |
| **HUMAN** | The PO's own observation on the deployed release, recorded in the run's human worksheet | Yes, and only it, for human rows |

A step is **covered** only when every required DEPLOYED row PASSes on the frozen release and every HUMAN row is recorded.
Anything else is a named gap below; nothing is implied.

## 2. Product 1 — Open Mic (`tests/live/rwt-open-mic-first-session.live.spec.ts`, suite `open-mic-first-session`)

| Step | Runbook expectation (summary) | DEPLOYED receipt rows | HUMAN-only | Gap / conflict |
| --- | --- | --- | --- | --- |
| 1 Join as a new person | real signup; admitted; account + plan accurate; UID/profile/entitlement/cleanup verified | `signup` · `sign-in` · `new-account entitlement` · `session bears canary claim` · `signup-stage telemetry (user class)` · run-owned cleanup log (`residue=0`) | the page "never shows an unexplained error" in a real browser | `signup-stage telemetry received` is a **non-gating HOLD** (PO 2026-09-28) |
| 2 Find the product | Products → Open Mic; mic off; ready state truthful | `Products → Open Mic` · `no mic on navigation` | real browser permission prompt and its copy | `real_microphone_permission_prompt` HUMAN (automation pre-grants) |
| 3 First mic use / model acquisition | time to usable; download vs setup measured separately; actual model/runtime; fallback; no mic if user leaves before Start finishes | `model identity` · `model download vs setup timing` · readback `ACQUISITION_RECEIPT` (`download_ms`, `init_ms`, `cache_result`) | — | v4 `base_q4` primary is a **non-gating HOLD** (PO 2026-09-28). "Navigate away before Start finishes" has **no** deployed row (gap) |
| 4 Speak ~1 min; fillers live and saved | um ×4, uh ×3, you know ×1 detected and saved; headline um/uh/ah; live = saved | `live filler highlighting` · `filler "<word>": transcript / display / saved` · `filler display matches saved (all words)` · `coachable filler headline` · `filler "<word>" vs corpus` | `open_mic_uh_detected` (synthetic "uh" cannot prove it) | Corpus accuracy: run 1 "um" family 5 vs 4 (CI); local repro 4 = 4. Re-measured by the corrected oracle (#1585) on the next run |
| 5 Stop; review | stops; exactly-once **automatic** save; review without reload; one speech-relevant "what worked" and one actionable "what to try next" under the reconciled headings; about 8–10 words each (soft target) | `session saved` · `saved exactly once` · `coaching rendered` · `coaching length` · `coaching phrases distinct` · `coaching visible = saved` · `coaching server receipt` | `open_mic_coaching_relevant` | **Length: resolved** (PM 6110896661): the 8–10-word soft target governs; the retired ≤ 6-word cap must not return, and longer valid phrases are not refused. **Heading: copy-reconciliation row** (§7): "Try this next run" is shipped vs the original "What to improve"; no parity is claimed |
| 6 Saved session in Analytics; reload; PDF | this session via its own control; transcript/metrics match; reload same; PDF transcript matches | `Analytics action` · `analytics session detail` · `reopen after reload` · `analytics detail shows both AI suggestions` · `saved review is the first block` · `session PDF` · `Analytics generates no coaching` · `revisit is not a generation` | — | Stop → usable review time is recorded, not judged |
| 7 Share feedback | acknowledgement; server receipt; **received** telemetry; retained after account deletion | `feedback` · `feedback outcome (sent)` · `feedback retention` · readback stage `share_feedback` | the PO's own judgement of the form | Run 1: the `share_feedback` binding was missing (F3 batching race, fix #1587). The full diagnostic chain (§5) is not yet provable |
| 8 Next Start | no false "Finishing up"; ≤ 15 s; mic tracks end; one Progress evaluation; no debt | `next Start` · `next take stopped, microphone off` · `Progress evaluation` · `Progress debt` | — | — |
| (suite extra) Practice again | not a runbook step | `Analytics Practice again opens the product` · `review Practice again starts, no hold` · `repeated take stopped, microphone off` | — | Run 1 FAIL (F1, fixed in #1584); needs a deployed PASS |

**Open Mic telemetry receipt** (runbook block): every item maps to a readback stage on the run's journey
(`session_during`, `session_after_open_mic`, `analytics_inventory`, `practice_again`, `share_feedback`, `session_pdf_export`).
Each item is reported as received / sent only / unobservable / missing, exactly as the runbook requires.

## 3. Product 2 — Focus Points (`rwt-focus-points-session` full, `rwt-focus-points-partial`)

| Step | Runbook expectation (summary) | DEPLOYED receipt rows | HUMAN-only | Gap / conflict |
| --- | --- | --- | --- | --- |
| 1 Products → Focus Points | setup opens; no mic; no recording; own account | `Products → Focus Points` · `no mic on navigation` · `new-account entitlement` | — | — |
| 2 Topic + four points | points appear beside the transcript, pending/empty; no mic | `Head to session` · `pace guide` · `rail before speaking` · `pending points labelled` · `rail legend` | — | — |
| 3 Start recording | model/runtime/fallback/setup for this product; indicators beside transcript | `model identity` · `model download vs setup timing` | — | as Open Mic step 3 |
| 4 Live point judgements | change during/after each point, in order, ≤ 5 s bound; none premature; partial fixture: unspoken point missing, paraphrase honest | `live marker changes` · `next point marked` · `marker timing vs audio` · `no red before Stop`; partial suite: exact `partial` 3/4 | the PO's own timing perception | — |
| 5 Stop; result | saved; final judgements match speech; 4/4; measured average per point | `session saved` · `final point verdicts` · `coverage count` · `average per point` · `final rail colours and words` · `persisted verdicts` · `not-detected explained` · Focus coaching rows | `focus_coaching_covers_points` | Coaching length/heading as Open Mic step 5 |
| 6 Analytics; reload | this session; transcript, coverage, point detail agree after reload | `Analytics action` · `analytics session detail` · `analytics point detail` · `reopen after reload` · `analytics detail shows both AI suggestions` | — | Point-level Analytics: the runbook's gap is now covered by `analytics point detail` (needs a deployed PASS) |
| 7 Share feedback | ack; server record; **received** `share_feedback` | `feedback` · `feedback retention` · `feedback outcome (sent)` · readback `share_feedback` (full suite only) | — | as Open Mic step 7 |

## 4. Returning-user sign-in (`rwt-products-navigation.live.spec.ts`)

| Runbook expectation | DEPLOYED receipt rows | HUMAN-only | Gap |
| --- | --- | --- | --- |
| real form with a pre-existing credential; plan; prior sessions; Products both ways; account state kept; maintained account never deleted | `returning-user sign-in` · `returning account state` · `returning-user access` · `returning history` · `Products → Open Mic` · `Products → Focus Points` · `back to Open Mic` · `navigation writes nothing` · `no mic on navigation` | `mobile_stop_confirmation_visible` · `real_microphone_permission_prompt` (worksheet rows carried by this suite) | The maintained account's access/history HOLDs are gating, and repairing the account is a separate PO decision |

## 5. Share Feedback diagnostic acceptance (AI request → report → support lookup)

The contract is `tests/live/helpers/feedbackDiagnosticContract.ts` (`validateFeedbackDiagnostics`): **PASS** only for a
complete, consistent, content-free chain; missing evidence → **HOLD**; contradicting evidence → **FAIL**.

| Scenario | Open Mic | Focus Points | Repeat take (Practice again) | MOCKED today | DEPLOYED requirement |
| --- | --- | --- | --- | --- | --- |
| Coaching success → report about the current take | required | required | report links the **repeat** take, never the first | PASS (one row, linked, ack) | contract PASS: `current_take`, the run's request, `observedModel` present |
| Coaching unavailable (503) → report | required | required | — | PASS (terminal, saved copy, manual retry) | contract PASS with `outcome=provider_error`, `failureCategory=unavailable` |
| Transport failure / timeout → report | required | — | — | PASS (one automatic retry, honest copy) | contract PASS with `transport_error`/`timeout`, `statusClass=none` |
| Delayed answer | required | — | — | PASS ("on its way" then the pair) | latency recorded (`totalMs`, `providerMs`) |
| Storage transport failure → retry | required | — | — | PASS (truthful alert, draft kept, one row) | one stored row; ack only after storage |
| Storage **server rejection** (42501) → retry | required | — | — | PASS (truthful alert, draft kept, logged once, one row) | one stored row; the rejection is logged, never acknowledged |
| Stored, reply lost → retry | required | — | — | PASS (idempotency index, one row) | one stored row |
| Report about an **older** take | required | — | — | PASS (links the older id) | contract PASS; never the current request (`current_attempt_attached_to_other_session`) |
| Report with **No session** | required | — | — | PASS (`session_id` null) | contract PASS; no invented link |
| Diagnostic lookup of the exact attempt | required | required | required | **HOLD**: today's client sends no request identity | contract PASS, after CLI Dev's diagnostics land |

## 6. Deployed proof procedure (prepared; NOT authorized by this document)

Runs only on a frozen, Canary-green release that includes CLI Dev's accepted diagnostics, under separate PO authority for
each run, any fault injection and any support lookup.

1. **Preflight:** `main` = served SHA = frozen SHA; no `rc-gates` run in flight; the diagnostics' configured model
   (`get-ai-suggestions/contract.json`) recorded.
2. **Provoke the AI outcome on a run-owned account:** success (natural), and one failure via the mechanism CLI Dev's
   packet provides (e.g. a canary-scoped fault switch). **Gap:** no authorized Production fault-injection mechanism exists
   today; without one, the failure rows stay MOCKED-only, and are named as such.
3. **Share Feedback from the take's page:** once about the current take, once about an older take, once with No session.
   Record the visible acknowledgement.
4. **Authorized support lookup** (service role, scoped to the run-owned account and its report ids only): map it to the
   contract fields and run `validateFeedbackDiagnostics` for each report. Required: PASS. Binding rules (PM 6111008437):
   - the request identity is captured **at the request boundary**: the run records the outgoing `get-ai-suggestions`
     invocation's `diagnostic_request_id` / `diagnostic_attempt_id` together with the verified saved session it was sent for,
     and the received `ai_coaching_diagnostic` record must carry the same ids. UI tap order or the report alone never binds
     a request to a session;
   - the report's stored link is `user_issue_reports.metadata.coaching_diagnostic_ref`; the feedback telemetry carries it as
     `coaching_diagnostic_id`;
   - the endpoint and provider HTTP classes are separate fields; `server_error` keeps its exact closed `serverReason`; the
     product `failureCategory` and the server reason are asserted independently; `source: unknown` is accepted only for a
     validated pre-provider failure.
5. **Received telemetry:** `share_feedback` bound for each report through the F3-settled action binding
   (`captureActionBindingSettled`); readback QUALIFIED.
6. **Cleanup:** run-owned account deleted with `residue=0`; reports retained by policy with the user link cleared
   (`feedback retention`).
7. **Stop** on any FAIL/HOLD, provider 5xx outside the provoked case, interruption, unproven cleanup, or SHA drift.
   No retries without new authority.

## 7. Reconciliations (recorded, not resolved here)

| Item | Source says | Current contract | Owner |
| --- | --- | --- | --- |
| Coaching length | original ≤ 6 words | **resolved:** the 2 October soft target of about 8–10 words governs; the currentized runbook records it | PM 6110896661 |
| Coaching headings | original **What to improve** | shipped "Try this next run" (the suite also accepts "What to try next"); explicit reconciliation row, no parity claimed | PM assesses with the product copy contract |
| TESTER_GUIDE "Save the session" (line 73) | explicit save step | saved automatically at Stop; a bounded correction is proposed in the doc packet (no manual-save action added) | PM |
| Original 2026-09-25 status block | "start the exploratory RWT now" | **replaced** in the currentized source by the de-risk-first handoff rule | — |

## 8. Named gaps (counted until closed)

1. Feedback diagnostic chain to the exact AI attempt: HOLD until CLI Dev's diagnostics land and the §6 proof PASSes.
2. Production fault injection for AI failure: no authorized mechanism (§6 step 2).
3. "Navigate away before Start finishes → mic must not start" (Open Mic step 3): no deployed row.
4. Coaching heading copy reconciliation (§7). The length conflict is resolved.
5. HUMAN rows: `real_microphone_permission_prompt`, `mobile_stop_confirmation_visible`, `open_mic_uh_detected`,
   `open_mic_coaching_relevant`, `focus_coaching_covers_points`.
6. Every DEPLOYED row above needs a PASS on the new frozen release. Run 1 (`38104864048`) remains historical FAIL.
