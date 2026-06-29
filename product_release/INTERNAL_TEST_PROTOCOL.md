# Internal Test Protocol — Soft Release (operators / dev / test agents)

**Last updated:** 2026-06-26
**Audience:** operators, dev, and test agents only. **Not for testers.**
The tester-facing guide is **`SOFT_RELEASE_TESTER_INSTRUCTIONS.md`** — keep all technical
detail (flags, model variants, telemetry, evidence, acceptance criteria) out of that file.

> **Current gate/run status is NOT recorded here.** Workflow posture, run IDs, and the
> signoff SHA live only in **`RELEASE_STATUS.md`** (SSOT). Do not copy changing run IDs here.

---

## Release posture

- **Controlled private beta / early-access — non-payment.** Payments are hidden
  (`stripeKeyClass="test"`). Not broad public launch; not paid public.
- Live paid checkout is a separate **Ops config cutover** (live Stripe key swap), not a code
  blocker for this beta. See `RELEASE_CLOSEOUT_LEDGER.md` §D and `ROADMAP.operational.md`.
- **Final pre-invite check:** re-run `gate=all` on the exact signoff SHA and confirm green
  (Final-SHA freshness — every merge to `main` resets the signoff clock). Record the run in
  `RELEASE_STATUS.md`.

---

## Pre-invite operator checklist

- Share only the production Vercel URL with human testers: `https://speaksharp-public.vercel.app`.
- **Never** share `127.0.0.1:5173` with human testers. That port is mocked E2E/test mode only.
- If a local rehearsal is required, use `pnpm dev` and `127.0.0.1:5174`; do **not** use `pnpm dev:test`.
- Do not generate or send tester codes. Free standard-mode access is automatic for new accounts.
- Confirm Vercel production does **not** set `VITE_TEST_MODE` or other E2E/test flags before sending invites.
- Confirm sample fields appear on new profiles: `private_sample_limit_seconds`,
  `private_sample_seconds_used`, and that no legacy timestamp grants paid access.
- Keep the tester path standard-mode-first with one intentional Private sample. Cloud STT is a
  paid Early Access feature and is **not** part of free-account sample testing.

---

## Entitlement / scope rules

- **Free-path tester scope** must prove: standard (Browser) transcription, the one Private
  sample, and that Cloud is unavailable without paid entitlement. Use a known Free account with
  the sample in both unused and used states when testing both sides.
- **Pro/admin/dev Cloud scope** (only if explicitly included): must prove Cloud recording,
  transcript, save/history/detail, analytics, and PDF export. Do **not** ask automatic-trial
  testers to validate Cloud.
- Effective paid Pro requires a real `stripe_subscription_id` — DB `subscription_status='pro'`
  alone is not effective paid Pro. Verify the subscription id, not the flag.

---

## Per-tester acceptance criteria (what a "successful session" means)

- **Save/history/detail:** after stopping, the session must persist to History and re-open to
  the saved analytics/session detail. A transcript without persisted history is **not** a
  successful session.
- **Custom words:** if a tester adds a custom word, they must say it during recording; verify
  the analytics count after save.
- **PDF export:** the exported file must contain session metadata, transcript, transcription
  mode, and the analytics summary (Free and Pro exports retain the large SpeakSharp watermark).
- **Private sample:** one-time on-device model setup; first words can take ~5s on CPU/WASM; the
  sample is short and saves automatically when it ends. **Saved-transcript fidelity (added
  2026-06-29, #891/#892) — check the persisted History transcript, not the live draft:**
  the opening clause is preserved (after a soft/quiet/delayed onset, not just a loud one);
  coverage threshold passes; no ≥5-word verbatim loop; History/detail matches; long leading
  silence produces no hallucinated prefix; and **stop-to-final latency is recorded** (measure at
  ~1–3 min and ~4–5 min — latency ≤5s is a separate open gate). For a **v4-targeted** session also
  confirm `engine_version=private_v4` and no visible/saved phrase loop.

---

## Browser-support wording

- Chrome is recommended. Browser (standard) transcription uses the browser's built-in speech
  recognition; availability and accuracy vary by browser.
- Do **not** claim Edge support unless an Edge-specific proof has passed start, transcript,
  save, history/detail, and analytics. Until then, use "Chrome recommended" wording.

---

## Automated first-time-tester proof (run before sending invites)

- Run `.github/workflows/live-release-matrix.yml` with the first-time tester / sample suite.
  It clears browser model storage, creates a fresh account, prepares Private STT, records,
  stops, and verifies save/history like a first-time tester.
- This suite owns its own cleanup (fresh account is deleted in `afterEach`). The reusable
  live-test accounts (`*-reuse@speaksharp.app`) are intentional and must **not** be deleted by
  hygiene tooling. Confirm persistent `auth.users` Δ = 0 around any live run.

---

## Private v4 rollout posture (internal — never in the tester guide)

**v2 is the primary Private engine — the proven default users get.** **v4 is a first-class,
gated candidate** that — *with enough real-world data* — could be reviewed for primary. v4 is
**not "off" and not a second-class experiment**: it is built into the *same* telemetry spine,
saved-session metadata, Report Issue context, and live e2e coverage as v2. But **v2 holds primary
until v4 demonstrably earns promotion**; gating v4 is not a demotion of v4, and promoting v4 is
not yet on the table without the data.

The free 5-minute Private sample is the v2/v4 measurement window. **v2 is the default for broad
beta traffic; broad/random v4 rollout is held (currently 0%) pending real-user evidence** — but
**targeted v4 exposure is ready immediately after launch** (allowlist / small cohort) so we begin
collecting real-world v4 data deliberately, narrowly, and reversibly. The goal is to give v4 a
fair, evidence-based path toward primary — while v2 stays primary until that evidence exists.

**Assignment + attribution.** Every `private_sample_*` event carries `engine_variant`
(`private_v2`/`private_v4`) and `assignment_source` (`default | posthog_flag | allowlist |
deterministic_override`), plus `posthog_flag_key`/`posthog_flag_value`. The saved session row's
`engine_version` (`private_v2:whisper-base.en` / `private_v4:base_q4`) durably records the arm so
it is reconstructable even if PostHog is missing — never rely on analytics alone.

**PostHog flags (owner-configured):**
- `private_stt_v4_enabled` (flag id 709644) — the **actual control plane as configured today**:
  per-user targeting via a `distinct_id` (= Supabase user.id) condition, **0% broad rollout**. First-
  wave exposure is done by adding test/owner `distinct_id`s to this flag's condition (verified
  2026-06-29: it gated by exact `distinct_id`, not a separate allowlist flag).
- `private_stt_v4_allowlist` — referenced as a *planned* named-user control; **was NOT present as a
  separate PostHog flag** during the 2026-06 investigation. Use `private_stt_v4_enabled` distinct_id
  targeting until/unless a dedicated allowlist flag is actually created.
- Kill switch / rollback = clear the targeted `distinct_id`s / set rollout to 0% → new users get v2
  immediately; existing saved sessions keep their recorded arm.

**Selective exposure controls (use for the first external wave):** named allowlist **+ Chrome
desktop only**; internal/dogfood accounts first; avoid mobile/low-memory devices until v4 proves
stable.

**Go criteria — enable v4 for the first real users only when ALL are true:**
1. Deterministic override proves the v2 path.
2. Deterministic override proves the v4 path.
3. v4 completes setup → record → first text → stop → save → history/detail in a free-user sample.
4. Variant is visible in PostHog events (`engine_variant` + `assignment_source`).
5. Variant is persisted on the saved session (`engine_version`).
6. Report Issue includes variant/session/release context.
7. No transcript/audio/raw model output enters PostHog/Sentry.
8. Kill switch back to v2 is verified.
9. Tester guide stays simple and does **not** mention A/B testing.

**Promotion path (v2 → v4): a deliberate promotion, not a permanent hold.**
- **Phase 0 — internal proof:** force v2 + v4 on owner/test accounts; confirm setup, transcript,
  save/history/detail, Report Issue, telemetry + saved metadata. *(done via deterministic override.)*
- **Phase 1 — selected external v4:** named allowlist (`private_stt_v4_allowlist`), Chrome desktop
  first, 1–3 trusted testers, normal use; compare v4 reports to the v2 baseline.
- **Phase 2 — small % rollout:** 10–20% via `private_stt_v4_enabled`; watch setup-success,
  time-to-first-text, save success, error/Report-Issue volume vs v2.
- **Phase 3 — 50/50:** only after early v4 pain is bounded.
- **Phase 4 — review v4 for primary:** a deliberate review, not an automatic endpoint. **v2 stays
  primary** until the data shows v4 is clearly better (or the tradeoff is strategically worth it).
  If v4 doesn't earn it, v2 stays primary and v4 is cut — decided on real data, not assumption.

**Promotion criteria (evidence, not perfection — qualitative + telemetry for a small beta):**
setup-success rate acceptable; time-to-first-text not materially worse than v2 on target devices;
save/history/detail reliable; Report Issue volume not materially worse than v2; transcript quality
directionally better (or the tradeoff is strategically worth it); no privacy/logging regression;
rollback to v2 stays one flag change. **If v4 can't earn this, cut it — but decide on real data.**
