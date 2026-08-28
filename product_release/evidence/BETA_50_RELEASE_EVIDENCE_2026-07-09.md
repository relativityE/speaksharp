# Beta-50 Release Evidence — v0.9.0-rc0

> **HISTORICAL EVIDENCE — point-in-time measurement, NOT current release truth.**
> This report records what was measured on its own date. It is **not** rewritten to look current, and it
> must not be: a measurement edited to match today's posture stops being evidence of anything.
> Current release posture: [`RELEASE_STATUS.md`](../RELEASE_STATUS.md). Current work sequencing:
> [`ACTIVE_COORDINATION.md`](../ACTIVE_COORDINATION.md).
> STT model selection is **not complete** — no Private model has been chosen; any model ranking below
> predates the #1304 certified harness and its frozen corpus.

**Date:** 2026-07-09
**Purpose:** controlled **50-user** beta sell-off (NOT 100). This packet is the single source for the GO / CONDITIONAL GO / NO-GO decision.
**Rule:** Beta-50 is NOT declared ready from CI, merge status, release branch, or tag alone. The deployed-app QA runs (Sections 4–9) are required.

**Provenance legend:** ✅ Dev-verified · 🧑‍🔬 QA/Owner must execute on the deployed app (auth + mic + real sessions — Dev cannot perform) · ⏳ pending.

**Artifact drop folder:** [`beta50_2026-07-09/`](beta50_2026-07-09/) — QA drops screenshots, exported PDF, console/network exports, HAR here.

---

## Release identity ✅

| Field | Value |
|---|---|
| RC tag | `v0.9.0-rc0` (annotated `b50f57f5`, peels `^{}` → squash `12321c0f`) |
| package.json | `0.9.0-rc0` (synced via #948; matches tag, no divergence) |
| Release branch | `release/v0.9.0-rc0` |
| Base tag | `v0.8.5-rc5` |
| Deployed `main` SHA | `84139eb3747544fe66b04497e1ae0c9bfe3743a4` |
| Deployed app URL | https://speaksharp-public.vercel.app (HTTP 200) · alt `https://speaksharp.vercel.app` |
| Deployed build stamp | asset hash `…-1783615824993` (≈ 2026-07-09) |
| Vercel deploy ID/URL | 🧑‍🔬 owner reads from Vercel dashboard (not exposed to Dev CLI) |
| Supabase environment | production (project ref: owner-held; secret policy — present/absent only) |

---

## 2. Pre-QA system health ✅ (Dev must return this filled BEFORE QA starts)

| System | Required evidence | Status |
|---|---|---|
| Main CI | green | ✅ `CI - Test Audit` success @ `84139eb3` |
| Release branch CI | green | ✅ success — [run 29034952226](https://github.com/relativityE/speaksharp/actions/runs/29034952226) (workflow_dispatch on `release/v0.9.0-rc0`) |
| Supabase deploy | green | ✅ `Deploy Supabase` success @ `84139eb3` |
| Production Canary | green | ✅ `Production Canary Smoke Test` success @ `84139eb3` |
| Vercel / deployed app | SHA / URL | ✅ reachable HTTP 200; build ≈ today; exact deploy ID 🧑‍🔬 owner |
| Lighthouse | perf/a11y/contrast passing | ✅ perf **99** · a11y **100** · `color-contrast` **PASS** (from #945/#946) |
| Sentry | dashboard reachable; no fresh P1 spike | ✅ capture deployed (#912–#915); ⏳ dashboard reachability + "no fresh P1" = owner-with-access confirms at QA start. Note: source-map upload inert until Sentry build vars set in Vercel. |
| PostHog | funnel/events visible | ✅ live — `session_started` 23, `session_saved` 23, `conversion_cta_viewed` 39, `private_sample_*`, `account_identified` in trailing 3d. Error events: `COMPONENT_CRASH` ×1, `GLOBAL_UNHANDLED_REJECTION` ×1 (both 2026-07-08, pre-RC — no fresh spike). |
| Supabase `user_issue_reports` | table queryable | ✅ proven — `issue-triage.yml` reads it and ran green (16:23). |
| Report Issue triage | digest/admin route available | ✅ `Issue Report Triage` workflow present + green run. |

**Pre-QA verdict:** all Dev-verifiable systems green. Two owner-confirm-at-start items: Sentry dashboard reachability, and exact Vercel deploy ID.

---

## 3. QA setup instructions (Chrome unless specified)

Before **each** run:
1. Open DevTools.
2. **Console** tab → enable **Preserve log** → clear console.
3. **Network** tab → enable **Preserve log** → clear network log.
4. Start screen recording if feasible.
5. **Never** share passwords, tokens, auth headers, or private audio files. Redact any credential before attaching.

After **each** run, provide into [`beta50_2026-07-09/`](beta50_2026-07-09/):
- console screenshot/export;
- failed-network-requests summary (or HAR with auth headers stripped);
- relevant screenshots;
- exported PDF (Run E);
- any visible error text;
- Sentry event ID if displayed.

---

## 4. QA Run A — Desktop Free / Browser cradle-to-grave 🧑‍🔬

**Path:** `Home → Sign up/in → Session → Browser mode → record 60–120s → stop/finalize → Score/Filler/Transcript → Analytics → PDF export → Report Issue → nav back/forth → sign out/in → reopen saved session`

**Recording script (read aloud, known fillers):**
> Um, today I want to explain the plan. So, um, the key thing is that we should focus here. Like, the goal is to make this clear.

**Confirm (tick each):** Home loads clean · CTA obvious · Session loads · Browser mode selectable/usable · recording starts · stops · finalization completes · transcript appears · Filler Words card appears · SpeakSharp Score appears · **visible score label says `Audience Impact`** · session saves · Analytics opens · saved session reopens · PDF exports · Report Issue submits · sign out/in works · browser back/forward does not corrupt session state.

**Screenshots (name → file):** Home · Session before recording · active recording · finalizing · completed transcript · Filler Words card · SpeakSharp Score (must show `Audience Impact`) · Analytics · saved session detail · exported PDF · Report Issue success · reopened saved session.

| Step | Desktop | Notes / console-net errors |
|---|---|---|
| _(QA fills)_ | | |

---

## 5. QA Run B — Mobile viewport 🧑‍🔬

Repeat the core journey at mobile width. Confirm: no blocked recording controls · no bottom-nav collision · **no horizontal scroll** · score/fillers/transcript readable · stop/finalize clear · Analytics reachable · Report Issue reachable · back/forward safe. Return mobile screenshots + console/network logs.

| Check | Mobile | Notes |
|---|---|---|
| _(QA fills)_ | | |

---

## 6. QA Run C — Report Issue proof 🧑‍🔬 (QA submits) + ✅ (Dev queries)

**Normal report** (no transcript/audio opt-in). Then Dev runs:
```sql
select id, created_at, user_id, session_id, category, severity, title, description,
       page_url, metadata, include_transcript, transcript_excerpt, include_audio, audio_attachment_note
from public.user_issue_reports
order by created_at desc
limit 5;
```
**Acceptance:** row exists · id + timestamp captured · category/severity/title/description present · page_url present · metadata includes route, userAgent, viewport, timezone, plan, sttMode, runtimeState, Sentry last-event-id (if available) · `include_transcript = false` · `transcript_excerpt is null` · `include_audio = false` · `audio_attachment_note is null`.

**Opt-in report** (transcript excerpt explicitly opted in): excerpt appears **only** in this row · no audio unless explicitly opted in · UI opt-in copy clear.

**Failure state** (offline / blocked network / invalid endpoint): clear user-facing failure message · **no silent drop**.

**Triage proof:** report appears in triage digest / admin view / support query path. (`issue-triage.yml` is the digest path.)

| Sub-gate | Result | Evidence |
|---|---|---|
| Normal row + fields | | |
| Opt-in isolation | | |
| Failure state | | |
| Triage visible | | |

---

## 7. QA Run D — Filler SSOT consistency 🧑‍🔬 + ✅

Use the Run A session (or a second known-filler session). The **live** count is canonical; every surface must match it.

| Surface | Count | Evidence |
|---|---:|---|
| Live Filler Words card | | screenshot |
| Saved session | | screenshot/backend |
| Analytics detail | | screenshot |
| PDF export | | PDF/screenshot |
| Score/clarity source | | debug/test/backend |

**Acceptance:** all user-facing surfaces agree · valid live count canonical · valid live **zero stays zero** · transcript recount does NOT override valid live data · **no user-facing filler-source toggle exists** (the flag was deleted in #944).

---

## 8. QA Run E — PDF proof 🧑‍🔬

Export one PDF; attach to [`beta50_2026-07-09/`](beta50_2026-07-09/). Verify: **SpeakSharp watermark present** · transcript present · score/metrics present · Filler Words section correct (matches Run D) · professional/shareable formatting · no broken layout · no private content beyond the user's own export.

---

## 9. Cohort-specific paths — **REQUIRED** 🧑‍🔬 (Beta-50 scope = **ALL THREE PATHS**, owner decision 2026-07-09)

Owner picked **Option D**: Free/Browser + Pro Cloud + Private are all in scope for the first 50. Both cohort paths below are **gating** (not optional). Requires **two test accounts**: a **Free** account and a **Pro** account whose Pro is a *real* `stripe_subscription_id` (DB `subscription_status='pro'` alone is NOT effective Pro — verify the sub id before treating the account as Pro).

**Pro Cloud** (required): Free user **cannot** access Cloud (gating enforced) · Pro can select Cloud · Cloud recording works · finalization works · session saves · Analytics opens · PDF exports. Screenshot each; note Cloud provider cue.

**Private setup/sample** (required): approved wording (e.g. `Set up Private`) · setup progress understandable · ready state clear · failure/fallback copy clear · Private session works after setup · runs-on-your-device cue present. Screenshot setup → ready → session.

---

## 10. Browser console/network gate (Dev summarizes per run)

| Run | Console errors | Warnings | Failed requests | Sentry IDs | Classification |
|---|---:|---:|---:|---|---|
| A | | | | | |
| B | | | | | |
| C | | | | | |

Classify each: **blocker** / **fix before 50** / **known backlog** / **acceptable warning** / **investigate after 50**. No unexplained fatal console error may be ignored.

---

## 11. Monitoring stack proof ✅

| Layer | Tool | Evidence |
|---|---|---|
| CI | GitHub Actions | ✅ main + release CI green |
| Deployment | Vercel | ✅ HTTP 200; SHA `84139eb3`; exact deploy ID 🧑‍🔬 owner |
| Backend deploy | Supabase workflow | ✅ `Deploy Supabase` green @ `84139eb3` |
| Runtime smoke | Production Canary | ✅ green @ `84139eb3` |
| Error monitoring | Sentry | ✅ deployed; ⏳ dashboard/no-P1 owner-confirm |
| Product analytics | PostHog | ✅ funnel/events visible (see §2) |
| User reports | Supabase `user_issue_reports` | ✅ queryable (triage workflow green); 🧑‍🔬 live row at QA |
| Triage | `issue-triage.yml` digest | ✅ present + green |
| Browser QA | Chrome DevTools | 🧑‍🔬 logs attached per run |
| Export | PDF | 🧑‍🔬 attached (Run E) |
| Accessibility | Lighthouse | ✅ perf 99 / a11y 100 / contrast PASS |

---

## 12. Branch hygiene ✅ (inventory reviewed; NO unilateral deletes)

`git branch -r --merged origin/main` → **0 stale merged branches** (squash-merge auto-deletes on merge). All remaining remote branches are protected or unmerged:

| Branch | Linked PR | Merged? | Needed for release/QA/rollback? | Action |
|---|---|---|---|---|
| `release/v0.9.0-rc0` | — | no (RC) | **Yes — release branch** | **PROTECT** |
| `feat/891-private-segmented-finalization` | #911 **OPEN** (draft, 24 ahead) | no | Yes — open PR | **KEEP** |
| `feat/891-webgpu-engagement` | none (1 ahead, 2026-07-05) | no | Backlog (#891 WebGPU) | **KEEP — owner approval to delete** (unmerged work) |
| `fix/891-engine-terminated-toast` | none (1 ahead, 2026-07-06) | no | Backlog P1 (ENGINE_ALREADY_TERMINATED) | **KEEP — owner approval** (unmerged P1 work) |
| `chore/score-label-listener-takeaway` | #890 **CLOSED** (2 ahead, 2026-06-28) | no | No — wrong-direction, superseded by #947 | **RECOMMEND DELETE — owner approval** (unmerged; PR closed & superseded) |

**Verdict:** hygiene complete; nothing Dev deletes unilaterally. One recommended cleanup (`chore/score-label-listener-takeaway`, superseded by Audience Impact #947) pending owner approval.

---

## 13. Stop-the-beta criteria (NO 50-user release if any is true)

Report Issue can't be submitted/retrieved · signup→record→save→Analytics fails · session save fails · transcript lost · filler count disagrees across live/saved/Analytics/PDF · PDF export fails · auth blocks normal use · Cloud/Private gating wrong for included cohort · Sentry P1 during QA · unexplained fatal console errors · mobile controls blocked · **monitoring owners unassigned** · branch/release hygiene incomplete.

---

## 14. Final sell-off table

| Gate | Status | Evidence | Blocker? | Owner |
|---|---|---|---|---|
| v0.9.0-rc0 package/tag sync | ✅ PASS | tag=pkg=`0.9.0-rc0`; empty tag-vs-main diff | no | Dev |
| Main CI green | ✅ PASS | `CI - Test Audit` @ `84139eb3` | no | Dev |
| Release branch CI green | ✅ PASS | run 29034952226 | no | Dev |
| Deploy green | ✅ PASS | `Deploy Supabase` @ `84139eb3` | no | Dev |
| Canary green | ✅ PASS | `Production Canary` @ `84139eb3` | no | Dev |
| Lighthouse clean | ✅ PASS | perf 99 / a11y 100 / contrast PASS | no | Dev |
| Desktop cradle-to-grave pass | ⏳ PENDING | Run A | **gating** | QA |
| Mobile cradle-to-grave pass | ⏳ PENDING | Run B | **gating** | QA |
| Report Issue row verified | ⏳ PENDING | Run C + SQL | **gating** | QA + Dev |
| Report Issue triage visible | ✅ path proven / ⏳ live row | `issue-triage.yml` green | no (path) | Dev |
| Filler SSOT consistency | ⏳ PENDING (code ✅) | Run D | **gating** | QA + Dev |
| PDF export proof | ⏳ PENDING (watermark test ✅) | Run E | **gating** | QA |
| Pro Cloud path (scope D) | ⏳ PENDING | §9 Cloud (needs Pro w/ real stripe sub) | **gating** | QA + Dev |
| Private setup/sample path (scope D) | ⏳ PENDING | §9 Private | **gating** | QA |
| Console/network logs reviewed | ⏳ PENDING | §10 | **gating** | QA + Dev |
| Sentry reviewed | ✅ deployed / ⏳ QA-window | §11 | no | Dev |
| PostHog funnel reviewed | ✅ PASS | §2 events | no | Dev |
| Branch hygiene complete | ✅ PASS | §12 | no | Dev |
| Monitoring owners assigned | ⏳ PENDING | names TBD | **gating** | Owner |
| Stop-the-beta acknowledged | ⏳ PENDING | §13 sign-off | **gating** | Owner |

---

## 15. Release recommendation

### NO-GO (HOLD) — pending QA evidence + owner sign-off

**No Dev-scope blocker found.** Every Dev-owned gate PASSES: RC identity/version sync, main + release CI, Supabase deploy, Production Canary, Lighthouse (perf 99 / a11y 100 / contrast PASS), PostHog funnel live, `user_issue_reports` queryable + triage green, branch hygiene clean.

The 50-user go is blocked **only** on gates Dev cannot execute:
1. **Deployed-app QA** — Runs A (desktop cradle-to-grave), B (mobile), C (Report Issue row + opt-in + failure + triage), D (filler SSOT parity), E (PDF export). Require real auth + mic + sessions.
2. **Owner sign-off** — assign monitoring owners (§11) and acknowledge stop-the-beta criteria (§13).

This flips to **GO** when Runs A–E pass with no blocker (§13 clean) and owners are assigned; to **CONDITIONAL GO** only for a minor issue that has a workaround, a named owner, and a deadline.

**Do not start 100-user planning or non-gating polish** (score-card tooltip, analytics copy, CI speedup, broad UI-primitive coverage). Only fix issues that surface in this pass or directly block a §14 gate.

---

### UPDATE 2026-07-10 — deployed-app QA (Runs A–E) captured → QA-evidence blocker satisfied

The **deployed-app QA** blocker (#1 above) now has evidence on production `899161b2`. See `beta50_private_2026-07-10/OPTION_D_QA_SELLOFF.md` + `PRIVATE_PATH_VALIDATION.md`.

| Run | Maps to | Result |
|---|---|---|
| A — desktop cradle-to-grave | Private + Cloud desktop record → transcript → filler → **save** (`sessions 204`); analytics reachable | ✅ PASS |
| B — mobile | Mobile action bar starts Private (no model-less crash) | ✅ PASS |
| C — Report Issue row + triage | "Browser QA 50" triage-verified (new slug + `user_id` + metadata + opt-outs null) | ✅ PASS |
| D — filler SSOT parity | Displayed card `(4)` == saved `filler_words.total.count:4` | ✅ PASS |
| E — PDF export | `/analytics` per-session `download-pdf-btn` present + reachable | ✅ PASS |

Also validated: the #957 Private first-run fix (`899161b2`) — no post-session lockout, cached-return second recording without reload, no model-less start (desktop + mobile). No console/network/Sentry blockers. **v2/`whisper-base.en` stays the Private default; v4 NOT in the release path.**

**Non-blocking caveats (logged follow-ups):** Web-Speech Browser filler undercount + no punctuation; `download-required` progress bar not live-reproducible on the served default model (deterministic live harness follow-up).

**Net:** the Runs A–E QA-evidence blocker is **satisfied**. Remaining to flip §15 to GO = **owner sign-off only** (assign monitoring owners §11 + acknowledge stop-the-beta §13). That decision stays with the release owner.
