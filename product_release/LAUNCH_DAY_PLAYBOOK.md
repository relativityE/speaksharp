# Launch-Day Playbook — support, incident triage, rollback (#1147)

Parent epic: #1142. Writer: Dev. Independent rehearsal: Test Agent. Refs #1087, #1123, #1133.

**Purpose.** A launch operator can identify the affected release, contain failures, support a speaker, and
recover service **without inspecting speech content**. Every alert links here. This document authorizes **no**
production rollback or config mutation on its own — each destructive step names the owner who must approve it.

**Privacy floor (non-negotiable).** No transcript text or audio is ever captured for debugging by default.
All triage uses **content-free identifiers only**: route, release SHA, pseudonymous `distinct_id`
(`usr_v1_<HMAC(user_id)>` / `tst_v1_…`), session id, timestamps, error codes. Never paste a raw email,
user id, transcript, or audio into a ticket, chat, or dashboard query.

---

## 1. Release authority (fill in at cutover)

| Field | Authority / source |
|---|---|
| Canonical production host | `https://speaksharp-public.vercel.app` (approved Vercel host) |
| Deployed SHA (truth) | `window.__APP_RELEASE__` in the live app **and** the Vercel deployment's commit; they must match |
| Environment | Vercel production project; Supabase production project |
| Health authority | `rc-gates.yml` **on `main`** (cloud RC gates) — NOT local `pnpm rc:gates` (local Gate-3 live-DAST fails closed by design) |
| Release status endpoint | `RELEASE_STATUS` surfaced via the app; the exact-SHA gate is `window.__APP_RELEASE__` |
| Analytics | PostHog project `207400` (US) |
| Failure telemetry | Sentry (frontend + Edge) |
| Edge/runtime | Supabase Edge Functions + Postgres (RLS) |

> If `window.__APP_RELEASE__` ≠ the intended SHA, treat the deploy as **unverified** and do not begin launch
> comms until reconciled (stale-chunk/SPA cache is a known class — see 6.1).

## 2. Roles and decision points

| Role | Owns | Decides |
|---|---|---|
| Launch owner | Go/Hold cadence, external comms | Start/stop the launch window |
| Support owner | Report Issue triage, speaker responses | Individual user remediation |
| Engineering owner | Diagnosis, rollback execution | Which rollback lever to pull (with PO auth for destructive) |
| Product Owner (PO) | Merge/migration/deploy authorization | **Any** production mutation: migration apply, deploy, config flip, retention scrub, billing enable |

**PO-gated actions (never taken by this playbook alone):** apply a migration, deploy/revert production,
enable Cloud, enable billing/live charges, run the #1117 retention scrub, change `private_stt_version`.

## 3. Severity and response targets

| Sev | Definition | Ack | Mitigation target |
|---|---|---|---|
| **S1** | Broad outage or data-integrity/privacy risk (auth down, save loss, transcript/PII exposure, wrong-account data) | 5 min | 30 min (rollback if needed) |
| **S2** | Core journey degraded for many (recording/finalize/Progress broken; Private model load failing widely) | 15 min | 2 h |
| **S3** | Narrow/degraded-mode issue with a workaround (one browser, Guided waitlist, export formatting) | 1 business day | next release |
| **S4** | Cosmetic / low impact | triage | backlog |

Any **privacy/retention** suspicion is **S1** until disproven.

## 4. Report Issue triage (sanitized linkage)

The in-app **Report Issue** action is the user-initiated context channel. Each report carries **sanitized**
route + release SHA + session linkage — no raw URL/query, no content (see #1038/P2 metadata sanitation).

1. Read the sanitized route + release SHA + pseudonymous session id.
2. Correlate in Sentry/PostHog/Edge/DB by those **content-free** identifiers only (section 5).
3. Classify against the decision trees (section 6). Assign severity (section 3).
4. Respond to the speaker with status + workaround; never request or store their transcript.

## 5. Content-free lookup steps

- **PostHog** (behavior): filter by `distinct_id` (`usr_v1_…`/`tst_v1_…`), `release`/SHA, event name. North-star
  is `linked_repeat_outcome_resolved` (#1145). Never query on email/raw id (person-on-events stores props as
  ingested).
- **Sentry** (failures): filter by release SHA + route + error code/fingerprint. Scrub any PII before sharing.
- **Edge**: function logs by request id/timestamp + status; no body content.
- **DB** (read-only, least privilege): join `sessions` by `id` + `user_id` (pseudonymize before sharing);
  inspect `status`, `transcript_state` (`available|expired|not_captured`), `attribution_status`, `device_type`,
  `engine`, timestamps. **Never** SELECT `transcript`/content into a shared surface.

## 6. Known-failure decision trees

Each: **symptom → content-free check → contain → escalate/rollback.**

### 6.1 Frontend load / stale chunk
Symptom: blank screen / `preloadError` / old UI after deploy. Check `window.__APP_RELEASE__` vs intended SHA.
Contain: hard reload / SPA 404-fallback recovery (stable asset names ship a recovery path). If widespread →
**6.10 frontend revert**.

### 6.2 Auth
Symptom: sign-in/up fails or loops. Check Supabase auth status + Sentry auth errors by route/SHA (anti-
enumeration copy is intentional — same neutral response on error). Contain: confirm provider health; no user
data compiled. S1 if broad.

### 6.3 Permissions / entitlement
Symptom: Pro user denied, or Free user over-served. Check `subscription_status` + effective entitlement
(remember DB `pro` ≠ effective paid Pro without a real `stripe_subscription_id`). Contain: verify entitlement
selector; do not hand-edit billing.

### 6.4 Private model load
Symptom: Private setup wall / model download stalls. Check `__SPEECH_RUNTIME_DEBUG__().serviceMode` +
`__STT_IDENTITY__()` (privateModelKey). Contain: Browser remains the explicit secondary path; Private failure
shows **honest recovery** and must **not** silently switch engines (#1120 S1).

### 6.5 Browser (native) availability
Symptom: Browser STT unavailable (non-Chrome). Check reported browser + capability. Contain: surface the
labelled unavailable state ("Browser", never "Native"); recommend Private.

### 6.6 Recording
Symptom: mic won't start / no transcript. Check runtime state + heartbeat. Contain: account-wide recording
mutex prevents concurrent captures; guide user to retry; no audio captured for debugging.

### 6.7 Finalize / save
Symptom: session not saved / partial metrics. Check `sessions.status`, `transcript_state`,
`attribution_status`. **S1 if save loss.** Contain: confirm phase-2c write path; a `not_captured` row is honest,
not a bug by itself.

### 6.8 Progress / linked repeat
Symptom: no Progress after a repeat. Check `linked_repeat_outcome_resolved` emission + persisted accepted
action linked to a distinct comparable repeat. Contain: retries/rerenders cannot manufacture it — verify the
server terminal outcome.

### 6.9 Guided
Symptom: Guided errors. Contain: **Guided has an independent kill switch** — disable Guided without touching
recording/Private. Waitlist path stays available.

### 6.10 Export (PDF)
Symptom: PDF wrong/missing. Check transcript provenance — an `expired`/`not_captured` session withholds
transcript + recomputed narratives by design. Contain: degrade to available data; no fabrication.

### 6.11 Retention
Symptom: transcript unexpectedly present/absent. **S1 (privacy).** Retention (#1117) keeps only the two most
recent transcript-bearing sessions per user; older → `transcript = NULL` + state `expired`. The irreversible
scrub is **PO-gated**; never run ad hoc.

### 6.12 Payment (hard-off)
Symptom: any live charge attempt. **Billing is hard-off for launch.** Live Stripe is READ-ONLY; Pro QA uses a
comped DB entitlement (`sub_test_*`). Enabling billing is a **written-PO-approval** gate; rollback cannot
silently enable it.

## 7. Rollback / containment levers

| Lever | Action | Owner / gate |
|---|---|---|
| Frontend revert | Redeploy previous known-good SHA on Vercel; verify `window.__APP_RELEASE__` | Eng owner + **PO** |
| Edge rollback | Redeploy prior Edge function version | Eng owner + **PO** |
| Migration | Additive/backward-compatible by policy; reversal only via the migration's documented rollback (drop trigger/function/column) | **PO** (apply + reverse) |
| Feature/config disable | Flip the specific flag OFF (kill switch) — see 8 | Eng owner |
| Tester communication | Post status + workaround to the tester channel; no content | Support owner |

Every rollback command + owner must be **verified in a safe (non-prod) environment** before launch (exit
criterion). Record the executed SHA and outcome.

## 8. Launch invariants + independent kill switches

- **Cloud STT: default-disabled + customer-invisible** during launch (#1120 S1). Rollback of any change
  **must not** silently enable Cloud. Re-enabling Cloud is a separate PO gate.
- **Guided**: independent kill switch (disable without affecting recording/Private).
- **Billing**: independent hard-off kill switch (no live charges); separate written-PO approval to enable.
- **Private v4**: `private_stt_version` default `v2`; switching to `v4` is a separate PO gate (#1139).
- **No transcript/audio capture for debugging** by default — content-free telemetry only.

## 9. Stop-the-launch thresholds (HOLD immediately)

Trigger a launch **HOLD** (and consider rollback) on any of:
- Any **S1**: auth outage, save/data loss, or **any** transcript/PII exposure or wrong-account data.
- Deployed `window.__APP_RELEASE__` ≠ intended SHA and cannot be reconciled quickly.
- Cloud found selectable/reachable, or any live billing charge observed.
- Retention behaving outside the two-most-recent invariant.
- `rc-gates.yml` on `main` red for a substantive (non-infra) reason at the launch SHA.

## 10. Rehearsals (Test Agent executes; non-destructive/tabletop)

1. Bad frontend release → 6.1 / 7 revert.
2. Recording/save regression → 6.6 / 6.7.
3. Migration mismatch → 6/7 migration reversal.
4. PostHog/Sentry outage → degrade triage to Edge/DB content-free lookups.
5. Report Issue spike → section 4 at volume.
6. Guided failure → 6.9 kill switch.
7. Privacy/retention incident → 6.11 S1 path.

## 11. Exit criteria

- [ ] Playbook versioned in `product_release/` and linked from every alert.
- [ ] Rollback commands + owners **verified in a safe environment**.
- [ ] At least one tabletop rehearsal completed (Test Agent).
- [ ] PO received the launch **GO/HOLD checklist** (section 12).

## 12. PO GO / HOLD checklist

GO requires ALL:
- [ ] `window.__APP_RELEASE__` == intended SHA; `rc-gates.yml` on `main` green (or red only for confirmed infra).
- [ ] Cloud default-disabled + invisible; billing hard-off; Guided kill switch verified.
- [ ] Retention invariant verified (two most recent per user); no PII in telemetry.
- [ ] Rollback levers rehearsed; owners on call; severity/response targets acknowledged.
- [ ] North-star `linked_repeat_outcome_resolved` emitting for the smoke cohort (#1145).

Any unchecked item → **HOLD**.
