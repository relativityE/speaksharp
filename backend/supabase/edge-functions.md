# Supabase Edge Functions

## Overview
This directory contains server-side logic deployed to Supabase Edge Functions (Deno).

## Edge Functions Overview

This project includes multiple Edge Functions to handle server-side logic:

- `assemblyai-token`: Securely issue tokens for AssemblyAI.
- `check-usage-limit`: Enforce subscription limits.
- `create-user`: Provision users (detailed below as a primary example).
- `format-transcript`: Restore punctuation/casing for Native/Cloud saved transcripts with word-preservation and Private hard-rejection. Enforces a per-user daily cost guard via `consume_formatter_quota` (degrade-open). Env: `FORMATTER_MODEL` (default `gemini-3.5-flash`), `FORMATTER_TIMEOUT_MS` (default `28000`), `FORMATTER_DAILY_LIMIT` (default `200`), `GEMINI_API_KEY`.
- `get-ai-suggestions`: Retrieve AI-generated feedback.
- `stripe-checkout`: Initiate Stripe checkout sessions.
- `stripe-webhook`: Handle Stripe webhooks.

### Database RPCs (Core Runtime Logic)

While most logic resides in Edge Functions, the **Deterministic Speech Runtime** relies on atomic Database RPCs for session integrity:

- `create_session_and_update_usage`: Atomic lock + usage increment + session creation.
- `heartbeat_session`: Incremental usage sync and session expiry extension.
- `complete_session`: Finalizes session with `completed` or `failed` status and reasons. Writes `transcript = COALESCE(p_final_transcript, transcript)`.
- `consume_formatter_quota`: Atomic per-user daily cost guard for `format-transcript` (`formatter_usage_daily` table, SECURITY DEFINER). Returns `{ allowed, remaining, limit, used }`; the Edge Function degrades open if it errors.

### Example: `create-user` (Synchronized Auth)

This function provisions users in both Supabase Auth and the `user_profiles` table. It uses a **2-Stage Key** pattern to clear the Supabase API Gateway (Kong) while maintaining function security.

### Usage

**Endpoint:** `POST /functions/v1/create-user`

**Headers:**
1.  **`apikey`**: Project Anonymous Key (`SUPABASE_ANON_KEY`). Required for Gateway routing.
2.  **`Authorization`**: `Bearer <AGENT_SECRET>`. Required for function-level access.

**Payload:**

```json
{
  "email": "user@example.com",           // Alias: "username"
  "password": "secure-password",        // If omitted, requires user to exist
  "subscription_status": "pro"           // Alias: "type" ('basic' or 'pro')
}
```

### Behavior

1.  **Auth Creation**: If a password is provided, creates a user in `auth.users` via Admin API. If the user exists, identifies their existing ID.
2.  **Profile Upsert**: Creates or updates a record in `public.user_profiles` with a mapped tier and the automatic trial timestamps:
    -   `pro`: Sets `subscription_status` to 'pro' and `usage_limit` to -1.
    -   `basic`: Sets `subscription_status` to 'basic' and `usage_limit` to 3600 (1 hour).
3.  **Security**: Uses constant-time `safeCompare` for `AGENT_SECRET` and defensively clears secrets from memory after validation.
4.  **Idempotency**: Safe to run repeatedly; ensures the user and profile match the requested state.

### Deployment

The function is deployed via GitHub Actions:
- **Workflow:** `.github/workflows/deploy-supabase-migrations.yml` (and `.github/workflows/deploy-create-user.yml` for manual testing)

### Local Development

To run locally:
```bash
supabase functions serve create-user --env-file .env
```
