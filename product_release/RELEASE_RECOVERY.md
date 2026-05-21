**Owner:** [unassigned]
**Last Reviewed:** 2026-05-15
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-15

# 🛠️ Release Recovery Strategy

<!-- PRODUCT_RELEASE_SYNC_START -->

## Current Evidence Snapshot (2026-05-15)

| Item | Current Status |
|---|---|
| Controlled desktop tester release | GO WITH LIMITATIONS; see `RELEASE_DECISION.md` and `TESTER_RELEASE_MATRIX.md`. |
| Broad public launch | NO-GO until remaining public-launch gates are proven; see `PUBLIC_LAUNCH_LEDGER.md`. |
| Latest release evidence commit | `1066ba6d` (`Use Node 24 artifact actions`). |
| CI/Test Audit | PASS: GitHub run `25944598514` on `main`. |
| Production canary | PASS: GitHub run `25944598537` on `main`. |
| Edge Function deploy | PASS: GitHub run `25944598524` on `main`. |
| Lighthouse release scores | Performance 98, Accessibility 94, Best Practices 100, SEO 100. |
| Artifact action runtime | Node 20 artifact warning resolved by upgrading `actions/upload-artifact` to `v6` and `actions/download-artifact` to `v7`. |
| Documentation rule | This snapshot supersedes older run IDs or stale status tables lower in this file until those sections are next deeply reconciled. |

<!-- PRODUCT_RELEASE_SYNC_END -->

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
