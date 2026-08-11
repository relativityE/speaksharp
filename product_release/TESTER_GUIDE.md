**Status:** Authoritative (SSOT for the external, tester-facing beta copy)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-08-11
**Last Verified:** 2026-08-11 — reconciled to the Private-only Practice Loop and the customer-copy contract in #1254. No volatile run IDs, SHAs, or current pass/fail posture are carried here.
**Applies To:** The controlled invite-only SpeakSharp beta — the copy sent to human testers (intro, invitation, walkthrough, feedback prompts).
**Class:** Product copy (external).
**Authority:** The source for what testers are told and asked. This is the only place external tester copy is maintained; operators send from here verbatim.
**Not Authoritative For:** operator setup, environment rules, entitlement checks, model variants, telemetry, or the first-time-tester proof (→ `TESTER_OPERATIONS.md`); acceptance criteria and the manual hardware protocol (→ `QUALITY.md`); current gate/run status, blockers, and go/no-go (→ `RELEASE_STATUS.md`); tier/quota/billing mechanics (→ `ENTITLEMENTS_AND_BILLING.md`); dated proof artifacts (→ `EVIDENCE_INDEX.md`).
**Supersedes:** the external (tester-facing) content of `SOFT_RELEASE_TESTER_INSTRUCTIONS.md` (interim source; archived at documentation closeout per `DOC_MIGRATION_LEDGER.md` §3.H).
**Evidence Sources:** `DOC_MIGRATION_LEDGER.md` §3.H extraction mapping; the product surfaces the copy describes (verified in `PRODUCT_REQUIREMENTS.md` / `QUALITY.md`).

# SpeakSharp Beta Tester Guide

Canonical statement of the **external, tester-facing copy** for the controlled invite-only SpeakSharp beta: the plain-language intro, the send-ready invitation, the walkthrough, and the feedback prompts. It is written for someone who has never seen the code.

This is a **documentation** artifact. It changes no application code, test, workflow, or product behavior; it only defines the words testers receive.

**Precedence reminder (from `README.md` §1).** This is external product copy — a Level-1 (user-trust) surface: every claim here must be truthful about shipped behavior. If the copy ever conflicts with runtime truth (Level 2) or a stable product contract in `PRODUCT_REQUIREMENTS.md`, the copy is **wrong** and must be corrected; do not send copy that overstates what the product does.

---

## 1. Scope & boundaries

This document owns **only the words testers see**. It deliberately routes everything operational elsewhere:

- Operator setup, environment rules, entitlement/scope checks, the automated first-time-tester proof, and the internal v4 rollout posture → `TESTER_OPERATIONS.md`.
- Engineering acceptance criteria ("what a successful session means") and the manual hardware-validation protocol → `QUALITY.md`.
- Current gate/run status, blockers, signoff SHA, and go/no-go → `RELEASE_STATUS.md`.
- Tier, quota, pricing, and billing mechanics → `ENTITLEMENTS_AND_BILLING.md`.
- Dated proof artifacts → `EVIDENCE_INDEX.md`.

Keep this file **free of technical detail** (flags, model variants, telemetry, evidence, SHAs, run IDs). Anything an operator needs but a tester does not belongs in `TESTER_OPERATIONS.md`.

---

> **Everything below this divider is the external tester-facing copy.** Operators send it as written. Do not paste governance metadata, internal notes, or status above this line into tester communications.

---

## 2. What is SpeakSharp?

SpeakSharp is a private speaking-practice coach. Choose **Open Mic** for an unstructured take or **Focus Points** when specific ideas must land. Every customer practice session uses **Private transcription on your device**; speech audio is not uploaded to a transcription provider.

The controlled beta is **free**. No card or checkout is required.

---

## 3. Beta invitation copy (send-ready; link included)

**Email (official — controlled invite-only beta):**

```text
Subject: A quick favor — test SpeakSharp (about 10 minutes)

Hi there,

Thanks in advance for your help. I'm inviting a small group to test SpeakSharp, and I'd value your honest feedback.

SpeakSharp is a private speaking-practice coach. Choose Open Mic for an unstructured take or Focus Points when specific ideas must land. Every customer practice session uses Private transcription on your device.

Could you take about 10 minutes to try SpeakSharp? Create an account, complete a practice take, save and review it, then repeat once using the suggested next action. Please use Report Issue whenever something feels confusing, inaccurate, slow, or broken.

The controlled beta is free. No card or checkout is required.

Start testing SpeakSharp!
https://speaksharp-public.vercel.app/

Thank you,
Akin
```

**Short text message:**

```text
I'm opening a small controlled beta for SpeakSharp, a private speaking-practice coach. Choose Open Mic or Focus Points, record a take using Private transcription on your device, then review the evidence and one suggested next action.

We'd love for you to try it and tell us what you liked or what we can improve. The beta is free; no card or checkout is required. Use Report Issue for anything confusing, inaccurate, slow, or broken.

Beta link: https://speaksharp-public.vercel.app/
```

---

## 4. A simple walkthrough

We'd love for you to try SpeakSharp and tell us what you liked or what we can improve. Please use the **Report Issue** button for any feedback or problems.

1. Create an account and choose **Open Mic** or **Focus Points**.
2. On first use, allow the one-time Private model setup, then wait for **Ready — speak now**.
3. Record a natural practice take and stop.
4. Keep the page open while the transcript finalizes on your device.
5. Save and review the exact session: transcript, delivery evidence, and one suggested next action.
6. Repeat once using that next action.
7. Open History/Progress, hard reload the exact session, and check any available PDF report.
8. Use **Report Issue** whenever something feels confusing, inaccurate, slow, or broken.

You don't need to be polished. Natural speech is more useful for testing.

> If anything feels **confusing, broken, slow, inaccurate, or surprising**, please use the **Report Issue** button. You don't need to explain it technically — just say what you were trying to do and what happened.

---

## 5. What feedback helps most

After trying SpeakSharp, please tell us:

1. Did you **complete the loop without help**?
2. Was the one-time Private setup clear?
3. Did the transcript preserve the beginning and end of your take?
4. Was the next action specific enough to use in another take?
5. In Focus Points, did “detected / not detected” feel truthful?
6. What frustrated you or made you consider leaving?
7. What **one change** would make you return tomorrow?

Even 3–4 sentences is a huge help. Thank you for testing it.
