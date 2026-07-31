**Status:** Authoritative (SSOT for internal tester administration — run/audit procedures)
**Owner:** Product-Ops / Quality (relativityE)
**Last Reviewed:** 2026-07-30
**Last Verified:** 2026-07-30 — extracted from approved interim sources (the operator parts of `INTERNAL_TEST_PROTOCOL.md` and the *run* parts of `MANUAL_HARDWARE_VALIDATION.md`; broad-launch operations from `PUBLIC_LAUNCH_LEDGER.md`; entitlement ops items from `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`) and verified against the repo (payment switches, sample profile fields, v4 flags, live workflows). No volatile run IDs, SHAs, or current pass/fail posture are carried here — those live only in `RELEASE_STATUS.md`.
**Applies To:** Operators, dev, and test agents administering the controlled invite-only SpeakSharp beta — pre-invite setup, entitlement/scope verification, the automated first-time-tester proof, the manual hardware run, and the internal Private-v4 rollout posture.
**Class:** Procedure (internal operations).
**Authority:** The source for how a tester wave is prepared, run, and audited — the operator checklist, tester-scope verification, first-time-tester proof, manual hardware run procedure, and the internal v4 rollout/promotion posture.
**Not Authoritative For:** tester-facing copy (→ `TESTER_GUIDE.md`); engineering acceptance criteria, the manual hardware *protocol*, the RC test inventory, and quality SLOs (→ `QUALITY.md`); gate definitions and the release workflow (→ `RELEASE_PROCESS.md`); current gate/run status, signoff SHA, blockers, go/no-go (→ `RELEASE_STATUS.md`); tier/quota/pricing/billing mechanics (→ `ENTITLEMENTS_AND_BILLING.md`); env/secrets/security controls and the paid-activation contract (→ `OPERATIONS_AND_SECURITY.md`); STT engine arms/latency (→ `STT.md`); dated proof artifacts (→ `EVIDENCE_INDEX.md`); open gaps (→ `ROADMAP.md`).
**Supersedes:** the operator/administration content of `INTERNAL_TEST_PROTOCOL.md`, the *run* content of `MANUAL_HARDWARE_VALIDATION.md`, the broad-launch operations narrative of `PUBLIC_LAUNCH_LEDGER.md`, and the entitlement ops items of `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` (interim sources; archived/retained at documentation closeout per `DOC_MIGRATION_LEDGER.md` §3.H / §3.I).
**Evidence Sources:** `DOC_MIGRATION_LEDGER.md` §3.H / §3.I extraction mapping; the code paths, profile fields, flags, and workflows cited inline; dated run artifacts indexed by `EVIDENCE_INDEX.md`.

# SpeakSharp Tester Operations

Canonical statement of how a controlled tester wave is **prepared, run, and audited**: the pre-invite operator checklist, tester entitlement/scope verification, the automated first-time-tester proof, the manual hardware run procedure, and the internal Private-v4 rollout posture. It is the internal counterpart to the external `TESTER_GUIDE.md`.

This is a **documentation** artifact. It changes no application code, test, workflow, DB value, or product behavior; it records the operating procedure.

**Precedence reminder (from `README.md` §1).** Operational survivability is **Level 5** — it never excuses violating a Level-1 user-trust promise, a Level-3 data-integrity invariant, or a Level-4 security invariant. Fail closed. A green run or a completed checklist is Level-6 evidence; it does not override a red or stale release gate in `RELEASE_STATUS.md`.

---

## 1. Scope & boundaries

This document owns **internal tester administration**. It deliberately routes:

- The words testers actually receive (intro, invite, walkthrough, feedback prompts) → `TESTER_GUIDE.md`.
- Engineering acceptance criteria ("what a successful session means"), the manual hardware *protocol* definition, the RC test inventory, and quality SLOs → `QUALITY.md` (this doc covers the *run*, not the protocol).
- Gate definitions, freshness rules, and the release workflow → `RELEASE_PROCESS.md`.
- Current gate/run status, signoff SHA, run IDs, blockers, and go/no-go → `RELEASE_STATUS.md`.
- Tier, quota, pricing, comped-access, and billing mechanics → `ENTITLEMENTS_AND_BILLING.md`.
- Environment variables, secrets, security controls, and the full paid-activation contract → `OPERATIONS_AND_SECURITY.md`.
- STT engine arms, model variants, and finalize-latency contracts → `STT.md`.
- Broad public-launch open gates and any unresolved ops items → `ROADMAP.md`.
- Dated proof artifacts (first-time-tester runs, hardware logs, launch gates) → `EVIDENCE_INDEX.md`.

---

## 2. Release posture (operator view)

The current release is a **controlled private beta / early-access, non-payment** line (engineering posture and freshness rule are in `QUALITY.md`; the changing signoff SHA, run IDs, and gate colors are in `RELEASE_STATUS.md`).

- **Checkout is closed by the payment switches, not by the Stripe key class.** It stays closed unless **both** `VITE_PAYMENTS_ENABLED=true` and `PAYMENTS_ENABLED=true`; either OFF keeps checkout closed (verified in `frontend/src/config/appRuntimeConfig.ts` and `backend/supabase/functions/stripe-checkout/index.ts`). This is not a broad public launch and not a paid public launch.
- **Opening paid checkout requires the full activation contract** — both switches ON, aligned live Stripe keys/webhook/prices, and entitlement verification, under written Product-Owner authorization — **not merely a key swap.** The complete activation contract is owned by `OPERATIONS_AND_SECURITY.md`; billing mechanics by `ENTITLEMENTS_AND_BILLING.md`.
- **Final pre-invite check:** re-run the full gate suite on the exact signoff SHA and confirm green (final-SHA freshness — every merge to `main` resets the signoff clock), then record the run in `RELEASE_STATUS.md`. Gate definitions live in `RELEASE_PROCESS.md`.

---

## 3. Pre-invite operator checklist

- Share only the production Vercel URL with human testers: `https://speaksharp-public.vercel.app`.
- **Never** share `127.0.0.1:5173` with human testers — that port is mocked E2E/test mode only.
- If a local rehearsal is required, use `pnpm dev` and `127.0.0.1:5174`; do **not** use `pnpm dev:test`.
- Do not generate or send tester codes. Free standard-mode access is automatic for new accounts.
- Confirm Vercel production does **not** set `VITE_TEST_MODE` or other E2E/test flags before sending invites.
- Confirm the Private-sample profile fields exist on new profiles: `private_sample_limit_seconds` and `private_sample_seconds_used` (present in `frontend/src/types/user.ts` and the sample migrations), and that no legacy timestamp grants paid access.
- Keep the tester path **Private-first**: Private is the main experience being evaluated (on-device model, one intentional sample); Browser is a brief **Quick preview**. Cloud STT is a paid Pro feature, **outside the Free beta path** (no new billing during the beta) — existing accounts with a valid paid-Pro entitlement retain access.

> **Wording note (#1064):** the user-facing "Recommended" tag has been **retired from every Private surface** — the current mode tags are Private = "Stays local", Browser = "Quick preview", Cloud = "Pro" (see `QUALITY.md` → Session UI truth). Do not reintroduce "Recommended" into operator scripts or tester copy. "Private-first" here means selector order and emphasis, not a "Recommended" badge.

---

## 4. Entitlement / scope verification

Entitlement *mechanics* (tiers, quotas, effective-Pro rules) are owned by `ENTITLEMENTS_AND_BILLING.md`; this section is the operator's verification procedure for a tester wave.

- **Free-path tester scope** must prove: standard (Browser) transcription, the one Private sample, and that Cloud is unavailable to Free testers (only existing paid-Pro accounts retain access). Use a known Free account with the sample in both **unused** and **used** states when exercising both sides.
- **Pro/admin/dev Cloud scope** (only if explicitly included in the wave): must prove Cloud recording, transcript, save/history/detail, analytics, and PDF export. Do **not** ask automatic-trial testers to validate Cloud.
- **Effective paid Pro requires a real `stripe_subscription_id`** — DB `subscription_status='pro'` alone is not effective paid Pro. Verify the subscription id, not the flag.
- **Pro recording cap for this release is 2h/day, 50h/month**, seeded in `tier_configs` (`backend/supabase/migrations/20260309000000_phase2_integration.sql`: `('pro', 7200, 180000, …)`) and enforced by the deployed usage functions — do **not** describe Pro as "unlimited" to any tester. Whether Pro should be raised is an unresolved product decision (→ `ROADMAP.md`); the requirement and provenance are in `ENTITLEMENTS_AND_BILLING.md`, and the dated entitlement audit is indexed by `EVIDENCE_INDEX.md`.

Acceptance criteria for a "successful session" (save/history/detail, custom words, PDF contents, Private-sample fidelity) are **not** repeated here — they are owned by `QUALITY.md`. Data-provenance rules (Supabase authoritative; PostHog observability-only; do not call active accounts "testers" without a roster) are likewise in `QUALITY.md`.

---

## 5. Automated first-time-tester proof (run before sending invites)

- Run `.github/workflows/live-release-matrix.yml` with the first-time-tester / sample suite. It clears browser model storage, creates a fresh account, prepares Private STT, records, stops, and verifies save/history like a first-time tester.
- This suite owns its own cleanup (the fresh account is deleted in `afterEach`). The reusable live-test accounts (`*-reuse@speaksharp.app`) are intentional and must **not** be deleted by hygiene tooling. Confirm persistent `auth.users` Δ = 0 around any live run.
- Record the run (ID, result) in `RELEASE_STATUS.md`; the dated artifact is indexed by `EVIDENCE_INDEX.md`. This proof does not become "current status" — it is point-in-time evidence.

---

## 6. Manual hardware validation — run procedure

The manual hardware-validation **protocol** (the full per-browser/device checklist) is defined in `QUALITY.md`. This section covers the operator **run** of it and where results go.

- CI does **not** validate real microphone hardware; run this on real devices, real browser permissions, and a real authenticated user before a wave.
- Cover the surfaces enumerated in the `QUALITY.md` protocol: **Desktop Chrome**, **Desktop Safari**, **Firefox**, **iPhone Safari**, **Bluetooth / external mic**, and **stress / degraded conditions**.
- **Hardware evidence logs.** Native Browser (standard) STT launch proof must come from real Chrome microphone behavior; GitHub Chromium fake-audio counts only as readiness / no-crash / save diagnostics because Web Speech transcript production is browser/vendor dependent. Capture the exact browser/version, the spoken sentence, and the stop/save/history/analytics results.
- If any check fails: capture a screen recording, export `TranscriptionService` debug logs from the console, and note the specific hardware (e.g. device model, headset). File via **Report Issue**.
- Dated hardware run logs are historical evidence → record them under `EVIDENCE_INDEX.md`, never as current posture.

---

## 7. Private v4 rollout posture (internal — never in `TESTER_GUIDE.md`)

**v2 is the primary Private engine — the proven default users get. v4 is OFF for the release path.** All v4 flags default OFF; the hard-kill `VITE_PRIVATE_STT_V4_DISABLED` is available (`frontend/src/services/transcription/privateV4Flags.ts`). v4 shares the same telemetry spine, saved-session metadata, Report-Issue context, and e2e coverage as v2, but it is **not currently active or promoted**. Any move toward v4 primary needs real-world data. The engine arms, model variants, and finalize-latency contract are owned by `STT.md`; this section is the rollout/administration posture.

- **The free 5-minute Private sample is the v2/v4 measurement window.** v2 is the default for all beta traffic; v4 rollout is OFF (0%). Any targeted v4 exposure (allowlist / small cohort) is a **future, separately authorized rollout** — not currently ready or active — to collect real-world v4 data deliberately, narrowly, and reversibly once approved.
- **Assignment + attribution.** Every `private_sample_*` event carries `engine_variant` (`private_v2`/`private_v4`) and `assignment_source` (`default | posthog_flag | allowlist | deterministic_override`), plus `posthog_flag_key` / `posthog_flag_value`. The saved session row's `engine_version` durably records the arm so it is reconstructable even if PostHog is missing — never rely on analytics alone.
- **PostHog flags (owner-configured).** `private_stt_v4_enabled` is the actual control plane as configured: per-user targeting via a `distinct_id` (= Supabase user.id) condition, 0% broad rollout; first-wave exposure is done by adding test/owner `distinct_id`s to the flag condition. A separate `private_stt_v4_allowlist` flag was referenced as *planned* but was **not** present as a distinct PostHog flag during the 2026-06 investigation — use `private_stt_v4_enabled` distinct_id targeting until/unless a dedicated allowlist flag is actually created. Kill switch / rollback = clear the targeted `distinct_id`s / set rollout to 0% → new users get v2 immediately; existing saved sessions keep their recorded arm.
- **Selective exposure controls for a first external wave:** named allowlist **+ Chrome desktop only**; internal/dogfood accounts first; avoid mobile / low-memory devices until v4 proves stable.

### Go criteria — enable v4 for the first real users only when ALL are true

1. Deterministic override proves the v2 path.
2. Deterministic override proves the v4 path.
3. v4 completes setup → record → first text → stop → save → history/detail in a free-user sample.
4. Variant is visible in PostHog events (`engine_variant` + `assignment_source`).
5. Variant is persisted on the saved session (`engine_version`).
6. Report Issue includes variant/session/release context.
7. No transcript/audio/raw model output enters PostHog/Sentry.
8. Kill switch back to v2 is verified.
9. `TESTER_GUIDE.md` stays simple and does **not** mention A/B testing.

### Promotion path (v2 → v4): a deliberate promotion, not a permanent hold

- **Phase 0 — internal proof:** force v2 + v4 on owner/test accounts; confirm setup, transcript, save/history/detail, Report Issue, telemetry + saved metadata. *(done via deterministic override.)*
- **Phase 1 — selected external v4:** named allowlist, Chrome desktop first, 1–3 trusted testers, normal use; compare v4 reports to the v2 baseline.
- **Phase 2 — small % rollout:** 10–20% via `private_stt_v4_enabled`; watch setup-success, time-to-first-text, save success, error/Report-Issue volume vs v2.
- **Phase 3 — 50/50:** only after early v4 pain is bounded.
- **Phase 4 — review v4 for primary:** a deliberate review, not an automatic endpoint. **v2 stays primary** until the data shows v4 is clearly better (or the tradeoff is strategically worth it). If v4 doesn't earn it, v2 stays primary and v4 is cut — decided on real data.

**Promotion criteria (evidence, not perfection — qualitative + telemetry for a small beta):** setup-success rate acceptable; time-to-first-text not materially worse than v2 on target devices; save/history/detail reliable; Report-Issue volume not materially worse than v2; transcript quality directionally better (or the tradeoff strategically worth it); no privacy/logging regression; rollback to v2 stays one flag change. **If v4 can't earn this, cut it — but decide on real data.**

---

## 8. Broad public launch vs controlled tester release

The **broad public-launch** gate plan (public signup, production Stripe checkout/webhook lifecycle, trial lifecycle, Cloud/AI/PDF Pro promises, mobile baseline, observability/support) is a **separate track** from this controlled tester release and must not be mixed with the tester burn-down. Its current decision is **NO-GO** for broad launch; the controlled tester decision is tracked in `RELEASE_STATUS.md`.

- **Open broad-launch gates** (anything still unproven — e.g. live Stripe key cutover, physical-mobile-device pass) are open items → `ROADMAP.md`.
- **Dated per-gate proof** (the historical PL-001…PL-011 evidence, including the test-mode checkout→entitlement journey accepted as functional proof, and the real-mic Cloud proof) is point-in-time evidence → indexed by `EVIDENCE_INDEX.md`, never treated as current status.
- Historical artifact paths may contain old `basic` filename slugs; treat those as artifact names only. The current public baseline is **Free**; paid Basic is a future placeholder (see `ENTITLEMENTS_AND_BILLING.md`).

---

*Internal operations record. Current release status lives only in `RELEASE_STATUS.md`; dated evidence is indexed by `EVIDENCE_INDEX.md`.*
