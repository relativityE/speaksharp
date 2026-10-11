# #1258 — RWT run 1 (Open Mic) on release `cc8e30b`, retained

Historical record of RWT diagnostic run [38104864048](https://github.com/relativityE/speaksharp/actions/runs/38104864048),
attempt 1, `rc-gates.yml` `gate-3-dast` with `tests/live/rwt-open-mic-first-session.live.spec.ts`, against
`main@cc8e30b4710bf271d765d4bc549a0e534dedf53c`. Every file from artifact `rwt-receipts-attempt-1` (id 11689650770, which
expires 2026-10-12T02:21:02Z) is retained here, original and unmodified; `manifest.json` and `SHA256SUMS` record their identity.
Placement: PM decision on #1258 (comment 6108892819).

| Files | What they are |
| --- | --- |
| `open-mic-first-session.receipt.json` | the run's content-free receipt: every row, verdict and the readback plan |
| `open-mic-first-session.readback-verdicts.json` | per-journey received-readback verdicts |
| `open-mic-first-session.human-worksheet.md` | the run-bound human worksheet, still unfilled |
| `*.readback.log` (7) | content-free per-journey qualification logs from the readback step: `USER_STAGE_RECEIPT`, `ACQUISITION_RECEIPT` and `TELEMETRY_READBACK_QUALIFICATION_EVIDENCE` records plus each journey's HOLD/QUALIFIED line. Added in a second commit per PM decision 6109462346 |

## Historical verdict — FAIL (unchanged)

`receiptAcceptance` = **FAIL**: 51 PASS, 3 FAIL, 7 HOLD (2 non-gating: `base_q4 primary`, `signup-stage telemetry received`),
2 HUMAN observations pending (`open_mic_coaching_relevant`, `open_mic_uh_detected`). Received readback: journey
`6b29d535…` QUALIFIED (`session_during`, `session_after_open_mic`, `analytics_inventory`); journey `14bcb70c…`
(`practice_again`) HOLD. Run-owned cleanup was verified in the job log (`residue=0`, 23 tables). The sequence stopped after
this run; runs 2–4 were not dispatched.

These files are evidence of that run only. They are not edited, re-scored or re-classified by any later finding.

## Later findings (linked, not applied to the files above)

| Finding | Disposition | Where |
| --- | --- | --- |
| F1 — Analytics *Practice again* stuck on *Try again* | Product defect: an unhinted PostgREST embed of `session_progress_evaluations` (three foreign keys to `sessions`) failed every first eligible session with PGRST201. Confirmed in Production; fixed and merged | #1258 comments 6105023190, 6106480758; PR #1584 (`f91574e1`) |
| F2 — `filler "um"` integrity / corpus rows | Test-oracle defect: the oracle counted the literal word, the product saves the `um` family (`um\|umm\|ummm\|uhm`). Corrected oracle; corpus exact-equality gate unchanged | #1258 comments 6104675789, 6106690031; PR #1585 |
| Accuracy (corpus "um" 5 vs 4) | Local reproduction with the pinned fixture and exact model gives family count 4 = expected 4; run 1's own transcript is not retained, so its count is unproven | #1258 comments 6106613938, 6106679470 |
| F3 — `share_feedback` / `session_pdf_export` RECEIVED bindings missing | Harness timing defect: PostHog batches events ~3 s, so the reloaded boot's positive control was still queued when the PDF and feedback actions were captured (`no_current_boot_control`). Product events were correct | #1258 comment 6108757201; branch `fix/1258-rwt-received-action-bindings` |
