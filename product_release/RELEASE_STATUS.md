# Release Status

**Last updated:** 2026-07-17 · Owner: Prod Owner (relativityE).
**Scope:** Single source of truth (SSOT) for current release posture. If this file conflicts with older files in `product_release/archive/`, this file wins. Stable contracts and procedures live in the operational and RC-gate docs; current ship status lives here only.

> **Controlled small-batch release candidate `v0.9.0-rc4` is cut and authorized by the Prod Owner** (annotated tag at `df909805`, peels to `df909805947d4ecc245692cff491515a1b6c6345`). Scope is the **first controlled batch of 3–5 testers only** — no paid checkout, no broad release, no v4 activation. Any expansion beyond this batch, and any paid launch, requires a separate explicit Prod Owner decision.

## Current main & production posture

| Item | Value |
|---|---|
| Production `main` | `df909805947d4ecc245692cff491515a1b6c6345` (sanitized lineage — see [Attribution history sanitation](#attribution-history-sanitation--sha-crosswalk)) |
| Release tag | **`v0.9.0-rc4`** (annotated, tag-object `f0687ec0aeed2f3e3a77360f964345d228ee2091`) → peels to `df909805`. |
| Deployment | Auto-deploy on push to `main`. Exact-head gates on `df909805` all green: **CI - Test Audit** ✅ (run 29599262192) · **RC Gates** ✅ all 5 incl. full live DAST (run 29599349765) · **OSV SCA — Gate 4** ✅ (run 29599261257) · **Production Canary** ✅ (run 29599261419) · **Ops Health** ✅ (run 29599351078) · **Billing Freeze** ✅ (run 29599352794) · **DB grant check** ✅ (run 29599354335) · **Vercel Production** SHA-equal (`VITE_VERCEL_GIT_COMMIT_SHA = df909805`) · **checkout = 0** · **v4 = 0** (PostHog 7d, live control `session_saved > 0`). |
| Branch protection | `enforce_admins=true`, `allow_force_pushes=false`, `allow_deletions=false`, **11 required GitHub Actions contexts (including `sca-osv`)**, 0 rulesets. |
| Payments | Prod runtime `stripeKeyClass="test"`; live checkout not open. Paid launch is a separate Ops key-swap cutover, not a pending Dev/QA test. |

## Shipped since the last SSOT update

### #982 — post-save reconciliation (MERGED, on `main` at `0a8246ae`)
`feat(session): post-save reconciliation — one status bar, completion toast, finalized-filler contract`. Shipped user-visible state:
- **One consolidated status bar** (`StatusNotificationBar`) replacing the prior `post-save-review-actions` block — consolidated left copy, **Private CTA as a secondary action (retained)**, Analytics link rightmost; gated on the terminal finalized state; mobile 2-row layout.
- **Completion toast** — "Next: Analytics", rendered as an **absolute element straddling the card boundary** (not an in-flow block between cards, and no fixed/blur overlay), shown once per finalized session, ≥5s, `aria-live="polite"`, collapse-on-dismiss.
- **Finalized-filler contract** — filler disclosure reads the live finalized snapshot; the completion/finalized signal is published only at the terminal join (persist → reconcile → formatter terminal), guarded by session.
- **Final transcript** wired into the consolidated surface; `post-save-review-actions` removed atomically.

### #979 — RPC grant lockdown (MERGED, on `main` at `fc994387`)
`fix(security): revoke public EXECUTE on get_user_id_by_email + read-only grant-check tool (Wave-1 P1)`.
- **Migration** `backend/supabase/migrations/20260714000000_harden_get_user_id_by_email_grant.sql`: `REVOKE EXECUTE ON public.get_user_id_by_email(text) FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE ... TO service_role`.
- **Proof tool** `.github/workflows/db-grant-check.yml` — read-only `has_function_privilege()` audit (SELECT-only) reporting EXECUTE grants for PUBLIC/anon/authenticated/service_role; default target `public.get_user_id_by_email(text)`. Inputs: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`.

### #983 — attribution policy (MERGED, on `main` at `84f720d2`)
`chore(claude): disable Claude attribution (owner-only commit policy)`. Owner-only commit attribution going forward: `relativityE <relativityE@users.noreply.github.com>`; no Claude/Anthropic co-author trailers, generated-by footers, or session links in commits, PRs, or docs. Enforced by `.claude/settings.json` (`attribution: {commit:"", pr:"", sessionUrl:false}`). Legitimate technical references to Claude (product/model/API) are retained.

## Private STT finalization — accepted RC limitation

A full **five-minute single Private (v2 / whisper-base.en) recording finalizes in ≈90 seconds** of post-stop processing. This is the **accepted RC limitation** for controlled beta, surfaced to the user as honest visible "Finalizing…" progress and to testers as a "~90s finalization" expectation (tester copy #977, on `main` at `c4788f80`).

- The earlier **`<30s` post-stop finalization requirement is obsolete and withdrawn** (superseded 2026-07-14). Do not treat `<30s` (or the internal 90s safety-switch cap) as a gate.
- The internal 90-second per-recording safety switch is a flag-only guard at both saved-path sites (`PrivateWhisper` + `TranscriptionService`) with zero saved-text mutation; it is not user-facing beta behavior.
- Faster finalization (streaming / segmentation / multithread) remains a post-limitation improvement lane, not an RC blocker.

## STT availability by tier

| Engine | Availability | Notes |
|---|---|---|
| Native (Browser / Web Speech) | All tiers incl. free trial (default) | Chrome desktop recommended; punctuation restore on by default (`VITE_NATIVE_PUNCTUATION_RESTORE`). Weakest path; nudge Private after a Browser session. |
| Private (v2 / whisper-base.en) | All tiers (local, download on first use) | Default Private engine. v4 WebGPU is OFF for the release path (`VITE_PRIVATE_STT_V4_DISABLED` hard-kill available; primary control is PostHog flags, default off). |
| **Cloud (AssemblyAI)** | **Paid Pro only** | **Available to paid Pro entitlement (real `stripe_subscription_id`). NOT available in the no-billing trial.** Current strongest STT path. |

## Merged since the last SSOT update (all on `main`)

| PR | Title | Status |
|---|---|---|
| [#981](https://github.com/relativityE/speaksharp/pull/981) | Wave-1 Pro-availability expectation-setting (`PricingPage` copy + tester/BACKLOG notes clarifying Cloud is paid-Pro) | **MERGED** |
| [#986](https://github.com/relativityE/speaksharp/pull/986) | `docs(release)`: synchronize product_release with sanitized main | **MERGED** |
| [#988](https://github.com/relativityE/speaksharp/pull/988) | `ci(sca)`: permanent OSV-based Gate 4 (replaces the retired pnpm-audit endpoint) | **MERGED** |
| [#989](https://github.com/relativityE/speaksharp/pull/989) | `test(live)`: pin Node-compatible `pdfjs-dist` for the live PDF-parse assertion | **MERGED** |
| [#990](https://github.com/relativityE/speaksharp/pull/990) | `fix(ops-health)`: bounded, deadline-enforced GitHub API resilience + correct failure classification | **MERGED** |

## Attribution history sanitation — SHA crosswalk

On 2026-07-15 the Git history was sanitized to remove Claude/Anthropic attribution (one-for-one, message-only; trees/authorship/dates/parents/topology and the `fibonacci@fibonnaci.local` identity byte-preserved). Every commit after the boundary `e8a4839e` received a new SHA.

| Ref | Old (pre-sanitation) | New (sanitized) |
|---|---|---|
| `main` | `b27f83284c3b` | `84f720d22422` (tree unchanged `94f62bc3`) |
| `#981` | `1cb11397e7b7` | `64b8f63a8379` (net-diff patch-id unchanged) |
| `v0.9.0-rc0` | `b50f57f5b111` | `a42ee05df7f7` |
| `v0.9.0-rc1` | `55f9f6ed0ea1` | `6409567ab0d4` |
| `v0.9.0-rc2` | `db633bf0c7cf` | `b235a43d1781` |
| `v0.9.0-rc3` | `771607ab86d4` | `383f5bb6e363` |

- **RC tags `v0.9.0-rc0…rc3` and `v0.8.5-rc1…rc5` were force-updated to the sanitized commits** (annotated leased on tag-object SHA; trees/taggers preserved). The 13 pre-boundary tags are unchanged.
- **Historical PostHog `release_sha` values retain the OLD SHAs** — they are immutable telemetry and are NOT rewritten. Correlate a historical `release_sha` to current history via this crosswalk and the full 969-row commit map (`product_release/attribution-sanitation-crosswalk.md`, PR #985).
- The complete mapping (9 version + 12 archive tags, 211 signature-loss disclosure, tool/backup provenance) lives in `product_release/attribution-sanitation-crosswalk.md`.

## Release-track posture

| Track | Status | Why |
|---|---|---|
| Controlled private beta / early-access (non-payment) | **GO — first controlled batch (3–5 testers), `v0.9.0-rc4`** | Exact-head prod gates green on `df909805`; #982 finalization UX shipped; Private ~90s finalization accepted. Prod Owner authorized the first controlled small batch only; any expansion is a separate decision, and any confirmed P0/P1 stops expansion. |
| Paid public launch (live checkout) | NO-GO until Ops key-swap cutover | Billing journey proven in Stripe test mode. Going live = set `sk_live`/`pk_live`/live `whsec`/live price IDs, register the live webhook, verify `stripeKeyClass==="live"`. |
| Broad public launch | NO-GO | Broader than controlled tester scope; separately gated. |

## Open items / unresolved decisions

- **Send controlled-beta invites?** GO for the **first controlled batch (3–5 testers)** on `v0.9.0-rc4`; expansion beyond that batch is held pending 24h monitoring and Prod Owner decision.
- **SCA gate — resolved (#988 merged).** Gate 4 is now the permanent **OSV-based** scanner (`sca-osv`, a required status context); the retired pnpm-audit HTTP-410 endpoint is no longer used. GHSA-5xrq (`vitest@3.2.4`) remains the single ignored advisory. See `SCA_EXCEPTIONS.md`.
- **Vitest 3→4 upgrade** to retire the GHSA-5xrq suppression (see `SCA_EXCEPTIONS.md`).
- **Faster Private finalization** (below ~90s) — improvement lane, not a blocker.

## Tester Scope

Send testers the plain-language `SOFT_RELEASE_TESTER_INSTRUCTIONS.md`; operators run the validation per `INTERNAL_TEST_PROTOCOL.md`. The tester path is:

1. Fresh account starts with free Browser transcription.
2. Private sample model download/setup if prompted.
3. Private sample recording, transcript, stop/save, history/detail, analytics.
4. Custom word added through UI and spoken during recording.
5. PDF export from saved session.
6. Optional Browser transcription in Chrome with browser-dependent wording.

## Evidence Freshness Contract

Each release gate is green only when the definition of green is backed by a named artifact that a reviewer can inspect without relying on operator memory. The active artifact is always the latest complete passing run. If a newer run fails any required criterion, the parent gate returns to red until a later complete run passes every criterion. Every artifact update must record `Last updated by: [initials] [date] [artifact path]`.

## Named STT Gate Artifacts

| Gate | Required Current Artifact |
|---|---|
| G6 Fresh Trial Private STT Transcript/Save/History Path | `/private/tmp/speaksharp-private-human-[timestamp].json`; must include `SESSION_LIFECYCLE_WARMUP`, model setup/download state, chunk RMS/duration rows, first partial timestamp/text, console events, save result, and history/detail proof. |
| Native Browser Chrome human-mic proof | `/private/tmp/speaksharp-native-[timestamp].json`; must include event order from `onspeechstart -> first onresult`, selected transcript on stop, save/history/detail proof, analytics proof, and no unintended 4-word sequence appearing more than once. |
| Cloud Pro proof | `/private/tmp/cloud-artifact-[timestamp].log`; must show AssemblyAI token HTTP 200, transcript/save/history/detail proof, AI suggestions, PDF export, and Pro entitlement context. |
| Custom word analytics proof | Browser/session artifact showing words such as `like = 1` or `basically = 1` after adding the custom word through the UI, then saving and opening detail/analytics. |
| PDF export proof | Saved-session PDF artifact whose transcript, duration, WPM, filler/custom word counts, and session metadata match the saved detail view within ±15%. |
| Session Status UX | Screenshot/video or browser trace showing one clear status/progress surface (`StatusNotificationBar`), Private setup/download/ready states, and no duplicate or internal FSM/debug status obstructing the user flow. |

## Update rule

Only this file receives changing release status, latest run IDs, blocker state, or go/no-go decisions. Other Markdown files should be stable contracts, procedures, tester copy, or archived evidence. Every artifact update records `Last updated by: [initials] [date] [artifact path]`.
