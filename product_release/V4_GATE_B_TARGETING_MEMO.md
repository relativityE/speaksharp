# Memo — Gate B (v4 PostHog operational proof): how to target a tester

**For:** Product owner review · **From:** Dev · **Date:** 2026-06-11 · **Candidate:** `dev/v4-integration@f69a2658`

## Decision required
To run **Gate B** (the operational PostHog proof) we need exactly one tester for whom the real flag
evaluates ON. Three things to decide: (1) which targeting option, (2) the specific test
email/distinct_id, (3) if Option A, explicit authorization for a production **flag-config change**.
This is the only part of the v4 closeout that touches live PostHog config — hence this memo instead
of me just doing it.

## Background (the whole picture on one screen)
- **Two-gate split** (per your direction): **Gate A** = technical WebGPU value (forceAuto allowed,
  artifact `selectionSource=dev_harness`) — **READY TO RUN, needs nothing here**. **Gate B** = does the
  *real production flag* select v4 for a targeted tester and stay off for everyone else
  (`selectionSource=posthog_flag`) — **this memo**.
- **The flag:** `private_stt_v4_enabled` (id **709644**) targets person property
  `isInternalTester == "true"` @ 100%; **0% / OFF for everyone else**. Conservative resolver still
  requires real WebGPU at runtime (no-WebGPU → v2-base), independent of the flag.
- **Three findings that constrain the options:**
  1. **No person has `isInternalTester=true` today** (checked via PostHog MCP, 2026-06-11) → cannot
     reuse an existing tester.
  2. **The app never sets `isInternalTester`** (grep of `frontend/src` is clean; `privateV4Flags`
     only *reads* the flag). So "becoming an internal tester" is a **manual PostHog operator action**,
     not an app allowlist or env toggle.
  3. **The PostHog MCP Dev has can edit flags but cannot write person properties.** So Dev can target
     a user *only* by editing the flag; Dev **cannot** set `isInternalTester` on a person.

## What a VALID Gate B run must show (so we judge the options against it)
- Run with **NO `STT_V4_*` knobs** (no forceAuto/device override).
- The targeted user evaluates the flag **ON** → v4 selected on WebGPU.
- Artifact **`selectionSource == 'posthog_flag'`** (the honest field now on the runtime decision).
- A **non-targeted** user → v2-base, **no** v4 constructor/init/model request.
- `?privateEngine` / localStorage in a production build do **not** select v4.
- Captured PostHog payloads: allowlisted fields only; no email/transcript/audio/raw stack/secrets.

> Most of this is **already unit-proven headless** (`privateV4FlagOperationalProof.test.ts` 6/6 +
> resolver + telemetry). Gate B is the on-hardware confirmation against the live flag.

## Options

### Option A — Dev adds a single-email release condition to flag 709644 (via MCP)
- **Mechanism:** flag filters become `isInternalTester=="true" OR email=="<test-email>"` @100%.
- **Who/when:** Dev, immediately, given your OK + the email.
- **Blast radius:** exactly one email; everyone else stays 0%. v4 still needs WebGPU at runtime.
- **Auditable:** yes — the flag activity log records the change + author. **Reversible:** yes — remove the condition after.
- **Faithfulness:** proves flag→v4→`posthog_flag` and off-for-others, but via an email match we added
  for the test — does **not** exercise the production `isInternalTester` rule itself.
- **Risk:** a real production flag-definition edit (low: single user, reversible). v4 stays off for all real users.

### Option B — Set `isInternalTester=true` on a test person (Product/operator)
- **Mechanism:** the *real* targeting rule — set the person property via the PostHog UI, or a one-off
  `$set` on the test user. Flag definition stays pristine.
- **Who/when:** Product/operator with a PostHog session; **Dev cannot do this via MCP**.
- **Faithfulness:** **best** — exercises the exact production path (`isInternalTester` → flag → v4).
- **Reversible:** yes (unset the property). **Risk:** lowest config-risk (no flag edit); needs a Product action.

### Option C — Reuse an existing internal tester
- **Unavailable:** none exist as of 2026-06-11.

### Option D — Defer Gate B
- v4 stays off-flag/hidden → Gate B is **not beta-blocking**. Gate A still closes the technical-value
  question. Revisit before any v4 exposure / A-B.
- **Cost:** the operational targeting claim stays at "unit-proven headless," not confirmed on the live flag.

## Comparison
| Option | Who can do it | Faithfulness | Mutates prod config | Reversible | Ready now |
|---|---|---|---|---|---|
| A — flag email condition | **Dev (MCP)** | flag→v4 (via email match) | flag 709644 (1 user) | yes | **yes** (needs OK + email) |
| B — person property | Product/operator | **real isInternalTester path** | person only | yes | needs Product |
| C — existing tester | — | — | — | — | **no (none exist)** |
| D — defer | owner | n/a (stays unit-proven) | none | n/a | n/a |

## Recommendation
- **Most faithful + cleanest:** **Option B** if Product can set one person property quickly — it tests
  the real rule and leaves the flag untouched.
- **Fastest / Dev-executable now:** **Option A** if you want it done without waiting on Product and
  accept a temporary, reversible, single-email flag condition.
- **Run Gate A now regardless** — it's independent and needs none of this.
- If beta is the only near-term goal, **Option D** is defensible (v4 is hidden).

## To proceed, I need
1. **A, B, or D.**
2. The **test email/distinct_id** to target (A or B).
3. If **A**: an explicit "yes, edit flag 709644" (production flag-config change).

## Rollback
- **A:** remove the email condition from 709644 (back to `isInternalTester`-only).
- **B:** unset `isInternalTester` on the test person.
- Either way, post-proof v4 returns to 0% / off for everyone.
