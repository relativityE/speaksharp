# Supabase Edge Functions

## Overview
This directory contains server-side logic deployed to Supabase Edge Functions (Deno).

## Function: `create-user`

This function securely provisions a new user in Supabase Auth and creates a corresponding profile record. It is primarily used for E2E testing to ensure a clean state for test users, but can also be adapted for specific admin provisioning tasks.

### usage

**Endpoint:** `POST /functions/v1/create-user`

**Authorization:**
Requires `Authorization: Bearer <AGENT_SECRET>` header. The `AGENT_SECRET` serves as a high-privilege key (distinct from `SUPABASE_SERVICE_ROLE_KEY`) to prevent unauthorized public access.

**Payload:**

```json
{
  "email": "user@example.com",
  "password": "secure-password",
  "type": "pro"     // Optional: 'free' (default) or 'pro'
}
```

### Behavior

1. **Auth Creation:** Creates a user in `auth.users` using the Supabase Admin API.
2. **Profile Creation:** Creates a record in `public.user_profiles` with the specified subscription status.
   - If `type` is 'pro', `subscription_status` is set to 'pro' and `usage_limit` is set to -1 (unlimited).
   - If `type` is 'free', `subscription_status` is set to 'free' and `usage_limit` is set to 3600 (1 hour).
3. **Idempotency:** If the user already exists, the function returns the existing user ID (`200 OK`) rather than throwing an error, making it safe to run in CI setup scripts.

### Deployment

The function is deployed via GitHub Actions:
- **Workflow:** `.github/workflows/deploy-create-user.yml`
- **Secrets:** Requires `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` in GitHub Secrets.

### Local Development

To run locally:
```bash
supabase functions serve create-user --env-file .env
```
Ensure `AGENT_SECRET` is defined in your local `.env`.
