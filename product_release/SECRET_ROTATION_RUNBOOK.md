# Secret Rotation Runbook

> Canonical variable catalog (names × storage homes × consumers) lives in `ENV_INVENTORY.md`.
> This runbook covers **rotating the Secret rows** there.

This runbook closes the product-ops side of `BLOAT-TRACKED-ENV-SECRETS`.
The repo-side cleanup is not enough: any real value that was ever committed must
be treated as compromised unless product-ops proves it was fake.

## What Must Be Rotated Or Proved Fake

- Supabase legacy `SERVICE_ROLE_KEY`
- Supabase anon/publishable key if the project JWT secret is regenerated
- Stripe secret key
- Stripe webhook secret
- AssemblyAI API key
- Any committed test account passwords that map to real accounts

## Automation Reality

There is no clean one-button rotation across providers.

| Provider | Can be automated? | Notes |
|---|---|---|
| Stripe secret key | Partly | Owner can roll via Dashboard or API/CLI with overlap/grace. Requires Stripe owner credentials. |
| Stripe webhook secret | Partly | Owner can rotate endpoint secret in Dashboard/API, then update GitHub/Supabase/Vercel secrets. |
| AssemblyAI API key | Mostly manual | Dashboard self-serve; no clean project-agnostic rotation API assumed here. |
| Supabase legacy service-role/anon JWT keys | Disruptive/manual | Legacy keys rotate by regenerating the project JWT secret, which also invalidates anon. Dashboard/owner action; plan deploy window. New-style keys may be Management-API rotatable, but the leaked service-role shape was legacy. |
| Test passwords | Automatable after Supabase rotation | Reset through Supabase Admin API, but that itself requires a valid service-role/admin credential. |

## Recommended Product-Ops Sequence

1. Preserve the list of old key fingerprints, not full secrets.
2. Rotate Supabase first if the committed service-role value was real.
   - Regenerate project JWT secret.
   - Update all GitHub/Vercel/Supabase secrets that use the anon/service-role key.
   - Redeploy/re-run auth, canary, live DAST, and Edge-function checks.
3. Rotate Stripe.
   - Create new live secret key.
   - Rotate webhook endpoint secret.
   - Update GitHub/Vercel/Supabase secrets.
   - Run one controlled checkout/webhook entitlement proof only when payments are intended to be live.
4. Rotate AssemblyAI.
   - Generate replacement API key in dashboard.
   - Update GitHub/Supabase secrets.
   - Run Cloud STT token/provider smoke.
5. Reset any real test accounts/passwords found in committed env files.
6. Decide history handling.
   - If values were fake/non-production: record proof and no purge.
   - If any value was real: consider GitHub secret-scanning incident record and history purge.

## Verification After Rotation

Run after secrets are updated:

```bash
pnpm rc:sast:secrets
pnpm test:edge
pnpm run rc:dast:live
```

Also verify:

- `git ls-files` does not include `.env.test` or `frontend/.env.test`.
- GitHub secret updated timestamps are newer than the cleanup commit.
- Vercel production runtime reports real Supabase auth and no mock/test mode.
- Payment surfaces remain hidden unless the Stripe publishable key is `pk_live_...`.
- Cloud STT token smoke succeeds only with the rotated AssemblyAI key.

## Ownership

- Product-ops owns provider credential rotation.
- Dev/test own repo-side scans, app verification, and proof artifacts.
- Agents must not paste provider secret values into coordination files, logs, or commits.
