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
  sample is short and saves automatically when it ends.

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
