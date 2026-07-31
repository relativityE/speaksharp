**Status:** Authoritative (SSOT for the external, tester-facing beta copy)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-07-30
**Last Verified:** 2026-07-30 — extracted from the approved interim source (`SOFT_RELEASE_TESTER_INSTRUCTIONS.md`), reconciled against current product behavior (`PRODUCT_REQUIREMENTS.md`, `QUALITY.md`) and the shipped mode wording (`DOC_MIGRATION_LEDGER.md` §5, #1041/#1064). No volatile run IDs, SHAs, or current pass/fail posture are carried here.
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

SpeakSharp is a speaking-practice coach. You record a short practice session, see a transcript of what you said, and get feedback on things like filler words ("um", "like"), pacing, and pauses — so you can improve one thing at a time.

This is a small private beta. It is **free** for you, there is nothing to pay, and you do not need a card.

---

## 3. Beta invitation copy (send-ready; link included)

**Email (official — controlled invite-only beta):**

```text
Subject: A quick favor — test SpeakSharp (about 10 minutes)

Hi there,

Thanks in advance for your help.

I'm inviting a small group to test SpeakSharp, and I'd value your honest feedback, when you get a moment.

SpeakSharp is a speaking-practice coach that helps you become a clearer, more confident communicator. Record yourself practicing an interview answer, presentation, meeting update, or everyday conversation, then review your transcript, filler words, pace, and personalized feedback.

Could you take about 10 minutes to try SpeakSharp? As you go, please note anything in the interface that feels unclear, out of place, or interrupts the flow—the ease of finding and understanding everything is part of the test.

1. Create an account and start a practice session.
2. Use Browser transcription as a brief Quick preview of SpeakSharp's coaching flow.
3. Save the session and review your initial feedback.
4. Use the included Private sample for your main practice, then review its transcript and feedback.
5. Find your saved sessions and feedback in Analytics.
6. Download a PDF report.
7. Use Report Issue to share your feedback. A few questions to guide you: Did you complete the experience without help? Did Private feel meaningfully more useful than Browser? What felt most useful? What felt unclear, out of place, or interrupted the flow? What one change would you make first?

Please be candid—all observations are welcome and useful, and your feedback will directly shape what we improve next.

Note: Browser is a brief Quick preview and may miss some punctuation; Private is the main experience we're evaluating. Please tell us whether it feels like a meaningful improvement.

This beta is free—no payment information is needed. Please skip any Upgrade option during this test. Cloud transcription is not part of the test. Please use Report Issue whenever something feels confusing, inaccurate, slow, or broken.

Start testing SpeakSharp!
https://speaksharp-public.vercel.app/

Thank you,
Akin
```

**Short text message:**

```text
I'm opening a small private beta for SpeakSharp, a speaking-practice coach. You record a short practice session, see your transcript, and get feedback on filler words, pacing, and pauses.

We'd love for you to try it and tell us what you liked or what we can improve — use the "Report Issue" button for any feedback or problems. Natural speech is best.

Browser is a brief Quick preview; Private is the main experience we're evaluating. Cloud transcription is not part of this test, no payment info is needed, and you can skip any Upgrade option.

Beta link: https://speaksharp-public.vercel.app/
```

---

## 4. A simple walkthrough

We'd love for you to try SpeakSharp and tell us what you liked or what we can improve. Please use the **Report Issue** button for any feedback or problems. (Chrome works best.)

1. Create an account and start a practice session.
2. Try **Browser** transcription first as a brief **Quick preview**. Say a short answer, interview response, or presentation intro. (Drop in a few "um"s and "like"s on purpose so you can see how they're caught.)
3. Notice the live feedback: filler words, pace, and your SpeakSharp score.
4. Try **Private** transcription next — this is the main experience we're evaluating. Private runs on your own device, so your practice audio stays local. It may take a few seconds to get ready the first time. Free users get one Private sample of up to 5 minutes; it does not start counting down when you sign up — you choose when to use it. **No Pro purchase is needed for this beta** — the Private sample is included, and Pro purchasing isn't open during the test.
5. For a longer Private recording, give it time to finalize after you stop — it processes your whole take on your device, so a longer recording takes a little longer to finish. You'll see honest "Finalizing…" progress the whole time.
6. Review your saved session in **Analytics**.
7. Look at your transcript, filler words, SpeakSharp score, and AI speech suggestions.
8. Try the Analytics focus/theme options to see which view helps you most.
9. **Download a PDF report** from a saved session.
10. Use **Report Issue** anytime you have feedback or run into a problem.

You don't need to be polished. Natural speech is more useful for testing.

> If anything feels **confusing, broken, slow, inaccurate, or surprising**, please use the **Report Issue** button. You don't need to explain it technically — just say what you were trying to do and what happened.

---

## 5. What feedback helps most

After trying SpeakSharp, please tell us:

1. Did you **complete the experience without help**?
2. Did **Private** feel **meaningfully more useful** than Browser?
3. What felt **most useful**?
4. What felt **unclear, out of place, or interrupted the flow**?
5. What **one change** would you make first?

Even 3–4 sentences is a huge help. Thank you for testing it.
