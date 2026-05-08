**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18 
**Last Updated:** 2026-05-08

# Recovery Strategy

This document defines the emergency procedures for the SpeakSharp launch window. We adopt a **Forward-Fix Operational Philosophy** rather than enterprise-grade reversible migration discipline.

## Recovery Doctrine: Forward-Corrective Restoration
SpeakSharp prioritizes service restoration and data integrity over "rollback purity." Because the system relies on stateful Supabase migrations and Stripe webhooks, traditional reversibility is often impractical. 

### Core Priorities:
1. **Recoverability**: Ensure the system can be brought back to a known-good state.
2. **Service Restoration**: Rapidly returning the user to a working state.
3. **Data Integrity**: Protecting the authoritative database state above all else (Silent corruption is worse than crashing).
4. **Deploy Reversibility**: Revert frontend/edge code where practical.
5. **Forward Corrective Migration**: Applying compensating fixes to resolve stale or corrupt states.

---

## 🚨 Recovery Playbook

### 1. Billing & Quota Failure
- **Restoration**: If the quota service fails closed, use the `generate-promo` tool to grant 24-hour manual Pro access to affected users.
- **Integrity**: Audit `stripe_webhook_events` to identify unprocessed events; re-trigger processing via manual RPC call.

### 2. Data Integrity Corruption
- **Scenario**: A bug in usage tracking is double-counting minutes.
- **Restoration**: Implement a forward-fix migration to recalculate `usage_seconds` from the `sessions` table history.
- **Integrity**: Mark affected profiles with a `needs_audit` flag.

### 3. Deploy Reversibility
- **Frontend**: Use Vercel "Rollback" to a previous stable build.
- **Edge Functions**: Deploy a "Safe Mode" version of the function that returns static, safe responses (e.g., fail-closed usage check).
- **Database**: Reversion is DISCOURAGED. Use additive-forward migrations to fix schema issues.

### 4. Degraded Mode Behavior
- **STT Failure**: If Cloud STT (AssemblyAI) fails, disable Cloud start and present Private/Native as explicit alternatives. If Private STT fails during the launch baseline, retry the deterministic CPU/Transformers.js path or present Native/Cloud only as explicit user-selectable alternatives. WebGPU/WhisperTurbo is an accelerated validation path, not a required first-use step. Never silently switch a Private session to Cloud.
- **DB Latency**: Increase `TranscriptionService` retry timeouts to 30s before flagging failure.

---

## 📋 Emergency Contact & Escalation
- **Level 1**: Production Admin (Environment configuration & Manual RPCs).
- **Level 2**: Lead Developer (Forward-fix code deployments).
- **Level 3**: Security/Billing Lead (Stripe refunds & Quota overrides).
