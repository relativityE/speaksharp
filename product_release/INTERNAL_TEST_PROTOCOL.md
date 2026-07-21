# Internal Test Protocol — Soft Release (operators / dev / test agents)

**Last updated:** 2026-07-20
**Audience:** operators, dev, and test agents only. **Not for testers.**
The tester-facing guide is **`SOFT_RELEASE_TESTER_INSTRUCTIONS.md`** — keep all technical
detail (flags, model variants, telemetry, evidence, acceptance criteria) out of that file.

> **Current gate/run status is NOT recorded here.** Workflow posture, run IDs, and the
> signoff SHA live only in **`RELEASE_STATUS.md`** (SSOT). Do not copy changing run IDs here.

---

## Release posture

- **Controlled private beta / early-access — non-payment.** Checkout is closed by the payment
  switches, **NOT** by the Stripe key class: it stays closed unless BOTH `VITE_PAYMENTS_ENABLED=true`
  and `PAYMENTS_ENABLED=true` (either OFF keeps it closed). Not broad public launch; not paid public.
- **Opening paid checkout requires ALL of:** both switches ON, correctly aligned live Stripe
  keys/webhook/prices, and entitlement verification — **not merely a key swap.**
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
- Keep the tester path **Private-first**: Private is the **Recommended** main experience being
  evaluated (on-device model, one intentional sample); Browser is a brief **Quick preview**. Cloud
  STT is a paid Pro feature, **outside the Free beta path** (no new billing during the beta) — existing accounts with a valid paid-Pro entitlement retain access.

---

## Entitlement / scope rules

- **Free-path tester scope** must prove: standard (Browser) transcription, the one Private
  sample, and that Cloud is unavailable to Free testers (only existing paid-Pro accounts retain access). Use a known Free account with
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
  the opening clause is preserved — **INCLUDING the immediate-start case (hit Record → wait for the
  green "Ready — speak now" pill → speak immediately), not just delayed/soft/loud onsets** (this
  immediate-start re-gate is the ONE open pre-beta validation of the deployed mic-ready gate);
  coverage threshold passes; no ≥5-word verbatim loop; History/detail matches; long leading
  silence produces no hallucinated prefix; the finalize state shows the **dimmed draft + honest
  progress, never the wrong rolling text as final**; and **stop-to-final latency is recorded**
  (measure at ~1–3 min and ~4–5 min — **accepted RC limitation (owner, 2026-07-14): a full 5-min
  single Private v2 recording finalizes in ≈90s post-stop, shown as honest "Finalizing…" progress;
  the earlier `<30s` requirement is withdrawn**; faster paths = Moonshine v2 streaming / segmented
  finalization are post-limitation improvements, not a gate). For a **v4-targeted** session also
  confirm `engine_version=private_v4` and no visible/saved phrase loop.

---

## Session UI truth (what the deployed session screen actually shows)

- **Mode selector is Private-first.** The pre-record mode list is ordered Private (**Recommended**)
  → Browser (**Quick preview**) → Cloud (**Pro**); only Private carries the "Recommended" tag and
  only Browser carries the "Quick preview" tag (`LiveRecordingCard.tsx`, tags
  `stt-mode-tag-recommended` / `stt-mode-tag-quick-preview`). Cloud is presented as Pro and is out
  of scope for the beta.
- **Mode help is ONE surface.** Desktop (hover + fine pointer) may show a single disjoint
  description flyout next to the open dropdown; when no non-overlapping placement fits, the flyout
  is suppressed and the single **"About transcription modes"** help panel is the fallback. **Touch
  devices get the About panel — exactly one description surface, never stacked bubbles**
  (`ModeDescriptionFlyout.tsx`; `STT_FLYOUT_ID`). The About panel and the mode dropdown are mutually
  exclusive (only one open at a time).
- **Post-save is ONE consolidated status bar, one Analytics action.** After a saved session the
  single `StatusNotificationBar` carries the reconciliation copy (left), an optional quiet Private
  CTA (Native + eligible only), and **one** Analytics action (rightmost). The separate
  post-save-review-actions surface was removed and folded in, so a deployed state never contains two
  Analytics actions (`SessionPage.tsx`, `postSaveReady`).
- **No completion toast / "Next: Analytics" overlay.** There is no separate celebratory toast or
  overlay after save; the consolidated status bar owns the "Session saved / review in Analytics"
  message. Do not describe or test for a post-save toast.

## Data provenance / observability truth

- **Supabase is authoritative** for saved sessions and for submitted issue reports. Verify
  persistence and issue-report capture against Supabase, not analytics.
- **PostHog is observability only.** A **missing PostHog event does NOT imply data loss or a
  persistence failure** — confirm the Supabase row before concluding a session did not save.
- **Sentry** carries failures and sanitized alerts only; no transcript/audio/raw model output.
- **Report Issue is the feedback channel**, but it does **not** (yet) generate a real-time owner
  notification — that path is DRAFT (#1006) and **not deployed**. Do not tell testers or assume
  operationally that submitting an issue pings the owner in real time.
- **Provenance terminology — keep sources separate.** Distinguish **automated / seed / owner /
  tester** accounts and sessions explicitly. **Do NOT call active accounts "testers"** without
  correlating them to an authoritative invitation roster; use "active accounts" or "non-seed
  candidate sessions" until roster correlation is done.

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

**v2 is the primary Private engine — the proven default users get.** **v4 is OFF for the release
path** — all v4 flags default OFF (`VITE_PRIVATE_STT_V4_DISABLED` hard-kill available;
`frontend/src/services/transcription/privateV4Flags.ts`). v4's code shares the *same* telemetry
spine, saved-session metadata, Report Issue context, and e2e coverage as v2, but it is **not
currently active or promoted**. v2 holds primary; any move toward v4 primary needs real-world data.

The free 5-minute Private sample is the v2/v4 measurement window. **v2 is the default for all beta
traffic; v4 rollout is OFF (0%).** Any targeted v4 exposure (allowlist / small cohort) is a
**future, separately authorized rollout — not currently ready or active** — to collect real-world
v4 data deliberately, narrowly, and reversibly once approved. v2 stays primary until that evidence exists.

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
