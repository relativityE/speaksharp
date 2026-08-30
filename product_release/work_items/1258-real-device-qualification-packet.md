**Status:** PREPARED — NOT EXECUTED. No device run has taken place.
**Owner:** Engineering
**Last Reviewed:** 2026-08-30
**Applies To:** #1258 — qualifying the deployed Private Practice Loop on real devices.
**Class:** Procedure (work item — temporary).
**Authority:** The execution packet for #1258. It is NOT evidence of a device run and must never be cited as one.
**Not Authoritative For:** any claim that a device test passed, or that the product is device-qualified.

# #1258 — real-device qualification packet

> **READ THIS FIRST.** Every table below is a plan with **empty result columns**. I do not have device
> access, and I have not executed any part of it. A packet with blanks is honest; a packet with invented
> results is worse than no packet at all.

> **Provenance.** This packet was written on the #1254 branch (`c8c53072`) and then **deleted** by
> `91ca7386` when that PR was reduced to Focus Points only, so it never reached `main`. This restores it,
> with every cited path and constant re-verified against `main@024b574f` — two claims had gone stale and
> are corrected below.

## What must be qualified, and what must NOT be written against

Derived from the #1367 claim-by-claim audit of what is actually user-reachable on `main`, by production
wiring rather than file existence.

### Shipped and reachable — qualify these

| Surface | Production path | Gate |
|---|---|---|
| **Personal Progress** | `/session` (protected) → `SessionPage.tsx` → `SessionOverhaulView` → `ProgressVsBaseline`, slot C, before/during/after | **No feature flag, no entitlement gate** |
| **Focus Points coverage** | `SessionOverhaulView` → `FocusPointsRail` / `CoverageRail`, backed by `utils/focusCoverage.ts`; resolves at stop | none |

**The eligibility boundary is the thing worth testing.** A session counts toward the Progress baseline only
when `durationSeconds >= MIN_COMPARABLE_SECONDS` (30) **and** `compositeQuality(s) != null`
(`frontend/src/utils/aggregateProgress.ts:24,111`, re-verified on `main@024b574f`). A
new user must therefore see the **insufficient-evidence state**, not an invented trend. That is the failure
a device test can actually catch and a unit test cannot.

### NOT shipped — do not write acceptance criteria against these

- **The complete executive-rehearsal use case.** `frontend/src/services/rehearsal/` is enabling code; the
  coverage slice ships, the assembled experience does not. Neither "unwired" nor "fully shipped" is
  accurate for the pair.
- **Pro-interest capture.** Re-verified on `main@024b574f`: `pro_interest` now appears **nowhere** in
  `frontend/src` or `backend/` — no object, no reachable action, no submission journey, and no longer even
  a stray comment. The earlier note in this packet pointed at
  `frontend/src/components/practice/ObjectiveSetupDialog.tsx` (the path was also wrong, missing
  `practice/`); that file's header now records that the dialog **replaced** the pre-launch "coming soon /
  notify me" waitlist when Focus Points shipped. There is nothing to qualify here, and nothing to write
  acceptance criteria against.

## Privacy claims to verify ON DEVICE

`PRODUCT_REQUIREMENTS.md` §7.1 makes four separable claims. They must be checked separately — passing one
says nothing about the others.

| # | Claim | How to falsify it |
|---|---|---|
| P1 | Audio never leaves the device | Capture the network log for the whole session; **any** audio-bearing upload fails this |
| P2 | Transcript text **does** leave on save and **is** stored | Confirm the save request carries it — this claim is the opposite of P1 and is often misread |
| P3 | Storage is bounded to the **two newest** saved sessions | Save a **third** session, then confirm the oldest transcript is gone. Two saves cannot test a two-item bound |
| P4 | Transcript reaches Gemini **only** on an explicit AI-coaching request | Complete a session and open review **without** requesting coaching; any Gemini call fails this |

## Execution table — RESULTS INTENTIONALLY BLANK

| # | Step | Device | Expected | Observed | Verdict |
|---|---|---|---|---|---|
| 1 | Sign in on the deployed build; record `__APP_RELEASE__` | | matches deployed SHA | | |
| 2 | New account, first session <30s | | Progress shows **insufficient evidence**, no trend | | |
| 3 | Session ≥30s with speech | | session saves; Progress baseline becomes eligible | | |
| 4 | Focus Points: set points, record, stop | | coverage resolves; rail renders detected/not-detected | | |
| 5 | Save a **third** session | | oldest transcript expired (P3) | | |
| 6 | Open review without requesting coaching | | **no** Gemini call (P4) | | |
| 7 | Request AI coaching explicitly | | Gemini call occurs, and only now (P4) | | |
| 8 | Full-session network capture | | no audio upload (P1); transcript on save (P2) | | |

## Required metadata for any run that does happen

Without every field the result is not comparable to any other run:

- device model, OS version, browser + version;
- deployed `__APP_RELEASE__` **read from the running tab**, not assumed from the deploy log;
- account and entitlement state at start (free / trial / pro) and the trial dates;
- wall-clock start and end;
- full network capture, retained;
- explicit statement of which of P1–P4 were observed **and which were not attempted**.

## Known blockers

1. **No device access in this environment.** Steps 1–8 cannot be executed here. This is a capability gap,
   reported as such rather than worked around.
2. **A stale bundle invalidates the whole run.** A cached pre-cutover bundle has previously made a run
   verify nothing. Step 1 exists to catch that and must not be skipped.
3. **P3 needs three saves.** Any run that saves twice has not tested the newest-two bound.

## Explicitly out of scope

Production writes, migrations, deployment, activation, paid-provider calls, and any live Stripe action.
None of these is authorized by #1258 and none is required by this packet.
