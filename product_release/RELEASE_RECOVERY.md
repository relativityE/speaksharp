**Owner:** [unassigned]
**Last Reviewed:** 2026-05-26
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-26

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
| Transcript Data Loss | **P1** | Switch `TranscriptionService` to "Aggressive Persistence" mode (save every 5s). |

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
1. Identify affected users via `users_profiles` audit.
2. Manually trigger a "Sync from Stripe" script to restore integrity.
3. Notify users of the disruption via the `system_notifications` table.

## 4. Communication Protocol
1. **Minute 0**: Detect failure via Sentry/PostHog.
2. **Minute 5**: Update Internal Status.
3. **Minute 15**: If unpatched, post "Investigating" to public status page.
4. **Minute 60**: If still broken, declare Launch Postponed and activate refund scripts if necessary.
