# Coaching usefulness review: protocol and qualification bar (MVP outcome 3)

> **HISTORICAL EVIDENCE — dated protocol fixed 2026-11-11 before any session was reviewed, NOT current release truth.** Product authority stays in the canonical root documents.

**Dated 2026-11-11. Evidence protocol, not product authority.** The binding coaching contract stays in
[`PROGRESS_AND_NEXT_ACTION.md`](../../PROGRESS_AND_NEXT_ACTION.md) §7 and §9 and the human-evidence boundary in
[`QUALITY.md`](../../QUALITY.md). This file fixes, before any session is reviewed, how outcome 3 ("prove current
coaching is useful") is judged on real saved sessions.

**Approval.** Standard approved by Sam (2026-11-11 14:08 UTC). Qualification bar approved by Sam (2026-11-11
14:32 UTC, relayed by Akin), including a separate 50-second clock for Retry. This approves the bar only. Outcome 3
closes when the evidence below passes, not when this protocol is accepted. Valid JSON, green CI or an available
model is not proof. Two-part scoring (W, and G and S on both parts) added 2026-11-12 at Sam's request; the
numbers are unchanged.

## Standard

- Advice is grounded in the saved take, specific and actionable, with no unsupported claims.
- Advice is correctly generated, saved and reopened for the same session.
- Failures are stated truthfully and recovery works.
- Covers Open Mic, full Focus Points and partial Focus Points.
- Usefulness is judged by people. Latency thresholds are fixed here, before testing.

## Qualification bar

An initial bar on a small sample, not a statistical guarantee. Every count includes sessions with no advice: a
missing pair is a miss in the delivery and quality totals, never a free pass. Every count is reported separately
for Open Mic (of 10), full Focus (of 5) and partial Focus (of 5), so one mode cannot hide a systematic failure in
another.

| Gate | Bar | Reason |
|---|---|---|
| Sample | 20 real saved sessions: 10 Open Mic, 5 full Focus, 5 partial Focus (at least one point not detected); at least 4 speakers | Shows a repeated failure in each mode and fits the 10-per-user-per-UTC-day uncached coaching cap |
| Unsupported claims | 0 of 20 | One invented claim misleads the user; any one means fix, then review again |
| Grounded, specific and actionable (G, S, W and A all Yes) | At least 16 of 20, by two independent reviewers; every disagreement and its resolution recorded | Allows a few thin short takes; advice that is generic as a pattern fails |
| Focus fit | At least 8 of 10 Focus sessions get the detected and not-detected points right | Focus advice that misreads the points is worse than none |
| Same session and pair on reopen | Every pair actually produced: 0 mismatches | A mismatch is a correctness defect, not a judgment call |
| First try with no advice | At most 2 of 20, each with the truthful failure state and an exercised Retry. A broken Retry fails the bar | Provider errors happen; the bar is honesty plus working recovery |
| First-try latency | Advice visible within 20 s of Save in at least 18 of 20 | 20 s is one deployed provider attempt cap (`PROVIDER_ATTEMPT_CAP_MS`) |
| First clock | Starts at Save. Advice or the failure state within 50 s, every session | Covers the 45 s server provider budget plus rendering |
| Retry clock | Separate. Starts at the Retry press. Advice or the failure state within 50 s | Each press starts a new server request with its own budget |
| Would try it next take | Recorded per session and reported against 14 of 20. A usefulness signal, **not** a closure gate | Subjective, and does not prove improvement |

Both clocks are recorded for every session where they apply.

## Rubric (Yes/No per pair)

Each pair is read as its two actual parts: **What went well** (`what_worked`) and **Try this next run**
(`what_to_try_next`). G and S are judged on both parts; a pair passes only if both parts do.

- **G Grounded:** every claim and quote in either part appears in the saved transcript or the metrics shown.
- **S Specific:** swap test. If either part would still read as true under another session in the sample, it fails.
- **W What went well:** states something true of this take; where nothing went well, a neutral fact. Invented praise fails.
- **A Actionable:** "Try this next run" is one concrete step for the next take, not a number recital.
- **F Focus fit** (Focus only): matches which points were and were not detected.
- **U Would try it** (speaker only): "Will you try this on your next take?"

G, S, W, A and F are scored by two independent reviewers. A disagreement goes to a third reviewer (the Product
Owner), and the resolution is recorded in the tally.

## Procedure, per session

1. Speaker records a real rehearsal (interview answer, update, pitch) on the deployed product, not a script, and saves.
2. Start the first clock at Save. Record when advice or the failure state appears.
3. Read the pair on the saved review **before** pressing Practice again (a saved repeat retires the original's tip).
4. If no advice: record the failure state, press Retry, start the Retry clock and record the result.
5. For every pair produced: reload, reopen the same session from History, and confirm the same pair shows for
   the same session.
6. Submit Share Feedback from that review so the verdict is tied to the coaching request through
   `coaching_diagnostic_ref` (see `docs/ai-coaching-feedback-diagnostic-lookup.md`). Record model and release
   identity for the session.
7. Score the rubric.

All 20 sessions run on one coaching build. If the coaching Edge function is redeployed mid-review, the count
restarts on the new build.

## Privacy

Transcripts and advice text stay in a restricted reviewer sheet outside the repository, are seen by a second
reviewer only with the speaker's consent, and are deleted after the verdict. Only the content-free tally
([`coaching-usefulness-tally.template.md`](./coaching-usefulness-tally.template.md)) is committed.

## Offline evaluator

The offline coaching evaluator (`backend/supabase/functions/get-ai-suggestions/evaluation/`) is not proof of
usefulness. Its deterministic checks may pre-screen a pair (quote grounding, metric recital, word band). It
accepts only synthetic sets, so real transcripts never become fixtures. If the review leads to a prompt change,
compare incumbent and changed prompts on the synthetic set as regression evidence; that live run needs its own
approved bound.
