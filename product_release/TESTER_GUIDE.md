**Status:** Authoritative (SSOT for the external, tester-facing beta copy)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-08-14
**Last Verified:** 2026-08-14 — reconciled to the Private-only Open Mic and Focus Points Practice Loop, the complete 30-day trial, the $10/month continuation contract, and the page-aware Report Issue behavior. No volatile run IDs, SHAs, or current pass/fail posture are carried here.
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

- Operator setup, environment rules, entitlement/scope checks, the automated first-time-tester proof, and internal rollout posture → `TESTER_OPERATIONS.md`.
- Engineering acceptance criteria ("what a successful session means") and the manual hardware-validation protocol → `QUALITY.md`.
- Current gate/run status, blockers, signoff SHA, and go/no-go → `RELEASE_STATUS.md`.
- Access, pricing, and billing mechanics → `ENTITLEMENTS_AND_BILLING.md`.
- Dated proof artifacts → `EVIDENCE_INDEX.md`.

Keep this file **free of technical detail** (flags, model variants, telemetry, evidence, SHAs, run IDs). Anything an operator needs but a tester does not belongs in `TESTER_OPERATIONS.md`.

---

> **Everything below this divider is the external tester-facing copy.** Operators send it as written. Do not paste governance metadata, internal notes, or status above this line into tester communications.

---

## 2. What is SpeakSharp?

SpeakSharp is a private speaking-practice coach. **Open Mic** is the simplest way to start an unstructured take. **Focus Points** is optional guidance when specific ideas must land. Every customer practice session uses **Private transcription on your device**; speech audio is not uploaded to a transcription provider.

The complete product is **free for 30 days**, then **$10/month** to continue with the same product. There is no permanent feature-limited Free tier, and Private transcription is not a paid add-on. Nothing starts recording automatically; the tester chooses when to begin.

---

## 3. Beta invitation email (official; send-ready)

```text
Subject: A quick favor — test SpeakSharp (about 10 minutes)

Hi there,

Thank you again for helping us test SpeakSharp.

SpeakSharp is a private speaking-practice coach. Open Mic is the simplest way to begin an unstructured take. Focus Points is optional guidance when you want to check that specific ideas came through. Every recording uses Private transcription on your device.

Nothing begins recording automatically. You remain in control of when to start.

How to test the Practice Loop

1. Sign in to SpeakSharp. You should land on the Practice page.
2. Start with Open Mic.
3. If this is your first session, allow the one-time Private transcription setup. Wait until the session says “Ready — speak now.”
4. Start recording when you are ready, speak for approximately 1–2 minutes, then stop.
5. Keep the page open while the transcript finishes on your device.
6. Save the session and review the transcript, delivery evidence, and suggested next action.
7. Open the saved session again from History or Progress. If a PDF report is available, open or export it.
8. Repeat once using the suggested next action. You may use Open Mic again or try Focus Points.
9. Use Report Issue from any page whenever something is confusing, broken, slow, inaccurate, or surprising.

What to evaluate

- Was it clear where to begin and that recording would not start automatically?
- Was the one-time Private setup clear?
- Did the live transcript and recording visualization respond while you spoke?
- Did the saved review preserve the beginning and end of your take?
- Did the saved recording visualization and session details look correct after the session?
- Did the filler-word, pacing, and pause feedback appear reasonable?
- Was the suggested next action specific enough to use in another take?
- If you tried Focus Points, did “detected / not detected” feel truthful?
- Did Open Mic and Focus Points remain clearly separate?
- Was anything confusing or difficult to navigate?
- What one change would make you want to return tomorrow?

Report Issue automatically records the product page where you submitted the report. Tell us what you were trying to do, what you expected, and what happened. Your transcript and audio are not included unless you explicitly choose to share optional details. Please do not include passwords, confidential material, or other sensitive personal information.

The complete product is free for 30 days. You will not need a card for this test. If any page asks you to pay during this beta test, stop and report it.

Optional one-minute practice sample

This sample intentionally includes a few filler phrases and a self-correction. Read it naturally—there is no need to perform it perfectly.

One place I enjoy visiting is a small neighborhood market. It has three main sections: fresh produce, baked goods, and household items.

Um, I usually begin at the fruit stand because the colors are easy to notice and describe. The owner, Maria, often recommends something unfamiliar. I might ask for four apples—actually, make that five—and a small bag of oranges.

The market can be noisy, so, you know, I sometimes pause or repeat myself. I may say a word incorrectly, correct it, and continue without starting over.

Before leaving, I check that I have everything I need. I like this market because it feels friendly, practical, and, like, connected to the neighborhood.

There is no need to perform the sample perfectly. Natural pauses, corrections, and speaking habits help us evaluate the experience.

Thank you for helping us improve SpeakSharp.

Start testing SpeakSharp:
https://speaksharp-public.vercel.app/

Thank you,
Akin
```

---

## 4. Short text message

```text
I'm opening a small controlled beta for SpeakSharp, a private speaking-practice coach. Start with Open Mic, record a 1–2 minute take using Private transcription on your device, save and review it, then repeat once using the suggested next action. You can also try Focus Points when specific ideas must land.

Nothing records automatically. The complete product is free for 30 days, and no card is needed for this test. Use Report Issue for anything confusing, inaccurate, slow, or broken.

Beta link: https://speaksharp-public.vercel.app/
```

---

## 5. Quick tester checklist

1. Complete one **Open Mic** take from start through saved review.
2. Confirm the live transcript and recording visualization respond during the take.
3. Reopen the exact saved session from History or Progress and inspect the transcript, evidence, recording visualization, and next action.
4. Repeat using the suggested next action.
5. Try **Focus Points** if you can identify two or three ideas that should be detected.
6. Confirm Focus Points results remain separate from Open Mic Progress.
7. Try Report Issue from the page where a problem occurs.
8. If anything asks for payment during this beta test, stop and report it.

You do not need to be polished. Natural speech is more useful for testing.

---

## 6. What feedback helps most

After trying SpeakSharp, please tell us:

1. Did you complete the full Practice Loop without help?
2. Was it clear that recording would not begin automatically?
3. Was the one-time Private setup clear?
4. Did the transcript preserve the beginning and end of your take?
5. Did the recording visualization behave correctly both during and after the session?
6. Did the delivery evidence feel plausible?
7. Was the suggested next action specific enough to use in another take?
8. In Focus Points, did “detected / not detected” feel truthful?
9. What frustrated you or made you consider leaving?
10. What one change would make you return tomorrow?

Even 3–4 sentences is a huge help. Thank you for testing it.
