# Release Status

**Last updated:** 2026-07-15 · Owner: relativityE (release owner).
**Scope:** Single source of truth (SSOT) for current release posture. If this file conflicts with older files in `product_release/archive/`, this file wins. Stable contracts and procedures live in the operational and RC-gate docs; current ship status lives here only.

> **No release authorization is implied by this document.** It records posture and evidence only. No tester invitations have been sent, no `rc4` has been cut, and no paid launch is authorized. Any of those requires a separate, explicit release-owner decision.

## Current main & production posture

| Item | Value |
|---|---|
| Production `main` | `84f720d22422e930a9f58936bceb24c551e73c73` (sanitized lineage — see [Attribution history sanitation](#attribution-history-sanitation--sha-crosswalk)) |
| Deployment | Auto-deploy on push to `main`. Exact-head gates on `84f720d2` all green: **CI - Test Audit** ✅ · **Production Canary Smoke Test** ✅ · **Deploy Supabase** ✅ · **Vercel Production** ✅. |
| Branch protection | `enforce_admins=true`, `allow_force_pushes=false`, `allow_deletions=false`, 10 required GitHub Actions contexts, 0 rulesets. |
| Payments | Prod runtime `stripeKeyClass="test"`; live checkout not open. Paid launch is a separate Ops key-swap cutover, not a pending Dev/QA test. |

## Shipped since the last SSOT update

### #982 — post-save reconciliation (MERGED, on `main` at `0a8246ae`)
`feat(session): post-save reconciliation — one status bar, completion toast, finalized-filler contract`. Shipped user-visible state:
- **One consolidated status bar** (`StatusNotificationBar`) replacing the prior `post-save-review-actions` block — consolidated left copy, **Private CTA as a secondary action (retained)**, Analytics link rightmost; gated on the terminal finalized state; mobile 2-row layout.
- **Completion toast** — "Next: Analytics", in-flow between cards (no fixed/blur overlay), shown once per finalized session, ≥5s, `aria-live="polite"`, collapse-on-dismiss.
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

## #981 — Wave-1 Pro-availability clarification (OPEN, not live)

PR [#981](https://github.com/relativityE/speaksharp/pull/981) (`docs/wave1-pro-availability-clarification`, head `64b8f63a`) remains **open**. It adjusts `PricingPage` copy plus tester/BACKLOG notes clarifying that Cloud is a paid-Pro capability. **Its copy is not on `main` and is not live.** #981 must be rebased onto this corrected SSOT before any merge; its prior append-only `RELEASE_STATUS.md` edit must not be applied to this file unchanged.

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
| Controlled private beta / early-access (non-payment) | Owner decision — invites NOT sent | Exact-head prod gates green on `84f720d2`; #982 finalization UX shipped; Private ~90s finalization accepted. Sending invites is a separate owner decision; none has been made. |
| Paid public launch (live checkout) | NO-GO until Ops key-swap cutover | Billing journey proven in Stripe test mode. Going live = set `sk_live`/`pk_live`/live `whsec`/live price IDs, register the live webhook, verify `stripeKeyClass==="live"`. |
| Broad public launch | NO-GO | Broader than controlled tester scope; separately gated. |

## Open items / unresolved decisions

- **Send controlled-beta invites?** Held; owner decision, none made.
- **SCA — critical advisories resolved (proven 2026-07-15).** osv-scanner confirms exactly **one** critical (`vitest@3.2.4` GHSA-5xrq, the ignored one); pnpm's `2 critical (1 ignored)` is the same advisory via two importers. **Zero unignored distinct criticals.** But the `rc:gate:4:sca` command (`pnpm audit`, pinned 10.29.1) now hits the **retired npm endpoint (HTTP 410)** and errors — the gate must move to a working scanner (osv-scanner / bulk endpoint). See `SCA_EXCEPTIONS.md`.
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
