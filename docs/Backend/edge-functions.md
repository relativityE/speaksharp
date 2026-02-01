# Supabase Edge Functions

## Overview
This directory contains server-side logic deployed to Supabase Edge Functions (Deno).

## Edge Functions Overview

This project includes multiple Edge Functions to handle server-side logic:

- `apply-promo`: Handle promotional code logic.
- `assemblyai-token`: Securely issue tokens for AssemblyAI.
- `check-usage-limit`: Enforce subscription limits.
- `create-user`: Provision users (detailed below as a primary example).
- `get-ai-suggestions`: Retrieve AI-generated feedback.
- `stripe-checkout`: Initiate Stripe checkout sessions.
- `stripe-webhook`: Handle Stripe webhooks.

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
  "subscription_status": "pro"           // Alias: "type" ('free' or 'pro')
}
```

### Behavior

1.  **Auth Creation**: If a password is provided, creates a user in `auth.users` via Admin API. If the user exists, identifies their existing ID.
2.  **Profile Upsert**: Creates or updates a record in `public.user_profiles` with a mapped tier:
    -   `pro`: Sets `subscription_status` to 'pro' and `usage_limit` to -1.
    -   `free`: Sets `subscription_status` to 'free' and `usage_limit` to 3600 (1 hour).
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
