**Owner:** relativityE
**Last Reviewed:** 2026-07-15
**Version:** v0.9.0-rc-series (sanitized lineage; see `RELEASE_STATUS.md`)
**Last Updated:** 2026-07-15

# 🛠️ Release Recovery Strategy

> Recovery playbook, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

This document defines the emergency procedures for the SpeakSharp launch window.

## Recovery Doctrine: Forward-Fix First
SpeakSharp utilizes a **Forward-Fix** doctrine. Because the system relies on stateful Supabase migrations and Stripe webhooks, a full "Rollback" often causes more data corruption than it solves.

- **Prefer**: Fix-in-place and redeploy.
- **Avoid**: Reverting database migrations once real users have signed up.

## 🚨 Emergency Triage Levels

| Symptom | Severity | Action |
|---|---|---|
| Stripe Webhook 500s | **P0** | Pause new checkouts in Stripe. Investigate Edge Function logs. |
| Quota Fail-Open (Revenue Leak) | **P0** | Deploy "Emergency Closed" limit function (hardcode `can_start: false`). |
| Database Connection Exhaustion | **P0** | Scale Supabase instance or terminate idle connections via Dashboard. |
| Private STT Model 404s | **P1** | Disable or retry the CPU/Transformers.js Private setup, explain the outage, and present Cloud/Native as explicit user-selectable alternatives. Do not silently switch a Private session to Cloud. |
| Transcript Data Loss | **P1** | The in-session safeguard is the **localStorage recovery draft** (`frontend/src/services/sessionRecoveryDraft.ts`, key `speaksharp_unsaved_session_draft`): a throttled heartbeat (`App.tsx` `flushRecoveryDraft`, ~every 2s) plus a `beforeunload` flush, consumed on resume in `SessionPage.tsx`. If it regresses, verify the heartbeat interval and `beforeunload` handler are wired; there is no separate "aggressive persistence" mode. |

## 1. Emergency Rollback Criteria
Only rollback the frontend if:
1. The new deployment prevents users from signing in entirely.
2. The UI is completely broken (blank screen) on more than 2 major browsers.
3. A critical security vulnerability is discovered that cannot be patched within 30 minutes.

**Rollback Command (Vercel):**
```bash
vercel rollback [PREVIOUS_DEPLOYMENT_ID]
```

## 2. Supabase Emergency Patching
To fix a broken Edge Function without a full CI run:
```bash
supabase functions deploy [FUNCTION_NAME] --project-ref [PROJECT_ID]
```

## 3. Data Integrity Recovery
If a bug causes incorrect billing status:
1. **Identify affected users** via the real profile table **`user_profiles`** (singular; created in `20250811062708_initial_schema.sql`). There is no `users_profiles` table.
2. **Reconcile billing state from Stripe** via the real mechanism — the **`stripe-webhook` edge function** (`backend/supabase/functions/stripe-webhook/index.ts`) calling the idempotent RPC **`process_stripe_webhook_event`** (`20260310000000_stripe_webhook_rpc.sql`), de-duplicated by the `processed_webhook_events` table. Re-deliver the affected event(s) from the Stripe dashboard so the webhook re-processes them; there is no standalone "Sync from Stripe" script. (`scripts/stripe-price-audit.mjs` audits prices only — it does not reconcile user state.)
3. **Notify users** via Sentry/PostHog + in-app toasts. There is **no `system_notifications` table** — the schema has no notifications table of any name.

## 4. Communication Protocol
1. **Minute 0**: Detect failure via Sentry/PostHog.
2. **Minute 5**: Update Internal Status (`/admin/ops-status`; workflow `ops-health.yml`).
3. **Minute 15**: If unpatched, post "Investigating" to public status page.
4. **Minute 60**: If still broken, declare Launch Postponed. Note the Beta-50 billing freeze — no live Stripe charges/refunds in testing; any refund action requires written owner approval.

## 5. Deployment & schema facts (recovery-relevant)
- **Frontend rollback:** `vercel rollback [PREVIOUS_DEPLOYMENT_ID]` (manual; no automated frontend-rollback workflow).
- **Backend migrations:** forward-only via `deploy-supabase-migrations.yml` (runs `supabase migration repair … --status applied`, then `supabase db push --dry-run`, then apply; pinned Supabase CLI v2.101.0). **No down-migrations exist** — consistent with Forward-Fix.
- **Canary:** `canary.yml` (push to main + daily cron) provisions a single reused canary user and runs `pnpm test:deploy:prod` against the public site (fail-closed, `CANARY_MAX=1`).
- **Real schema tables** (from migrations): `user_profiles`, `sessions`, `user_goals`, `custom_vocabulary`, `processed_webhook_events`, `tier_configs`, `trial_entitlements`, `usage_checkpoints`, `ai_suggestion_usage_daily`, `formatter_usage_daily`, `active_recording_lease`, `user_issue_reports`. (No `users_profiles`, no `system_notifications`.)
