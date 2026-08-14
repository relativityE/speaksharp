# Secrets / Variables attack-surface audit (#1294)

**Names only. No values appear here or are handled by Dev.** Point-in-time live inventory cross-referenced
against every active GitHub-workflow consumer on the #1294 branch (post-purge). No setting is deleted by
this PR; deletion happens only after merge, with zero remaining consumers on green `main`, and an explicit
Product Owner authorization of the exact deletion list.

## Scope & method

- **Consumer surface scanned:** every `secrets.*` / `vars.*` reference under `.github/**` on this branch.
- **Configured inventory (names only):** `gh secret list` / `gh variable list` at repository scope, plus the
  three GitHub Environments (`Preview`, `Production`, `production-db`).
- **Environment scopes:** all three environments have **no** environment-scoped Secrets or Variables.
- **Organization scope:** `orgs/relativityE/actions/secrets` returns HTTP 404 — no repo-accessible org-level
  Secrets/Variables are enumerable from this repo. (If the org later exposes any, re-run this audit.)
- **Caveat — runtime vs workflow consumers:** a Secret with **zero workflow consumers is NOT necessarily
  unused.** Deployed Supabase Edge functions and the Vercel runtime read several secrets at runtime (never
  via `secrets.*` in a workflow). Those are called out below and MUST NOT be deleted on a "no workflow
  consumer" basis.

## A. Confirmed retirement set — zero consumers, delete after #1294 merges

These have **zero** `secrets.*`/`vars.*` consumers on this branch (verified) and no runtime consumer:

| Name | Kind | Consumers | Disposition |
|---|---|---|---|
| `CANARY_PASSWORD` | Secret | none | DELETE post-merge |
| `BASIC_TEST_EMAIL` | Secret | none | DELETE post-merge |
| `BASIC_TEST_PASSWORD` | Secret | none | DELETE post-merge |
| `STRIPE_BASIC_PRICE_ID` | Secret | none | DELETE post-merge |
| `STRIPE_LIVE_BASIC_PRICE_ID` | Secret | none | DELETE post-merge |

No other case-insensitive `*BASIC*` Secret or Variable exists in the repository inventory.

## B. Stale duplicate Secrets (moved to same-named Variables)

All 8 names exist as **both** a Secret and a Variable. The active consumers reference the **Variable**
form, so the Secret copy is redundant. Delete the **Secret** copy, retain the **Variable**.

| Name | `secrets.*` consumers (block deletion) | `vars.*` consumers | Secret deletable? |
|---|---|---|---|
| `EDGE_FN_URL` | none | ci, rc-gates, review-evidence | ✅ yes |
| `POSTHOG_API_HOST` | none | observability-api-smoke, ops-health, posthog-gate-b, service-level-evidence | ✅ yes |
| `POSTHOG_INGEST_HOST` | none | (same 4) | ✅ yes |
| `POSTHOG_PROJECT_API_KEY` | none | (same 4) | ✅ yes |
| `SENTRY_DSN` | none | observability-api-smoke, ops-health, sentry-diagnose, service-level-evidence | ✅ yes |
| `SUPABASE_URL` | none | 25 workflows (widely used as `vars.SUPABASE_URL`) | ✅ yes |
| `VERCEL_PROJECT_ID` | none | ops-health, service-level-evidence | ✅ yes |
| `SUPABASE_PROJECT_ID` | **db-grant-check, no-unaffiliated-domain** | apply-exact-allowlisted-migration, apply-webhook-db-prerequisite, canary, deploy-supabase-migrations, migrations-preflight, ops-health, service-level-evidence | ⛔ **blocked** |

**`SUPABASE_PROJECT_ID` is NOT yet deletable:** two workflows still read `secrets.SUPABASE_PROJECT_ID`
(`db-grant-check.yml`, `no-unaffiliated-domain.yml`). Seven other workflows already use
`vars.SUPABASE_PROJECT_ID`, so the Variable is proven. **Prerequisite:** flip those two `secrets.*` refs to
`vars.*` (after confirming the Variable value equals the Secret), then the Secret copy is deletable. This PR
does **not** flip them, to preserve RC/security-workflow behavior pending value confirmation + authorization.

## C. `VITE_DEV_PREMIUM_ACCESS`

Not present in repository Secrets or Variables, and not consumed by shipping `frontend/src` or any workflow.
Nothing to delete at repository scope. If it exists in an environment/org scope not enumerable here, delete
it — shipping source does not consume it.

## D. Genuine secrets with zero WORKFLOW consumers but a RUNTIME consumer — DO NOT delete on that basis

These read at runtime by deployed Edge functions / Vercel, not via `secrets.*` in a workflow. "No workflow
consumer" is expected and does not imply unused:

| Name | Runtime consumer (not a workflow) |
|---|---|
| `STRIPE_SECRET_KEY` | `stripe-checkout` / `stripe-webhook` / `stripe-billing-portal` Edge functions |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` Edge function (signature verification) |
| `STRIPE_PRO_PRICE_ID` | `stripe-checkout` Edge function + client price validation |
| `ASSEMBLYAI_API_KEY` | `assemblyai-token` Edge function |
| `SUPABASE_DB_PASSWORD` | Supabase CLI / DB connection (deploy/migration runtime) |

## E. High-risk credentials requiring review

Not confirmed stale; each materially expands exposure. Retain, but review scope/rotation:

| Name | Workflow consumers | Note |
|---|---|---|
| `GH_PAT` | **setup-test-users only** | writes the `SOAK_TEST_PASSWORD` Secret (see below) — highest privilege |
| `SUPABASE_SERVICE_ROLE_KEY` | 15 workflows | full DB bypass; broad blast radius |
| `SUPABASE_ACCESS_TOKEN` | 9 workflows | project management / migration apply |
| `SUPABASE_DB_PASSWORD` | (runtime) | direct DB |
| `STRIPE_LIVE_SECRET_KEY` / `STRIPE_LIVE_WEBHOOK_SECRET` | billing-freeze, ops-health, service-level, rc-gates, live-release-matrix, unaffiliated-identity-audit | live money surface |
| `VERCEL_ACCESS_TOKEN` / `VERCEL_AUTOMATION_BYPASS_SECRET` | ops-health, service-level, rc-gates | deploy/bypass |

### `GH_PAT` — the standout finding

`GH_PAT`'s **only** consumer is `setup-test-users.yml`, in the "Generate and set SOAK_TEST_PASSWORD" step,
which runs **only** on a manual dispatch with `action=setup` + `password_action=generate_new_credentials`.
It calls `gh secret set SOAK_TEST_PASSWORD` — i.e. a workflow with **repository secrets-write** capability.
That is the most dangerous single capability in the inventory: a compromise of that job (or a dependency)
could overwrite any repository Secret.

- **If retained:** `GH_PAT` MUST be a *fine-grained* PAT scoped to **this repository only**, with the
  minimum permission (`secrets: write`, plus `actions` only if required) — never a classic PAT with `repo`
  scope. This is a GitHub-settings property Dev cannot read via API; the owner must confirm it.
- **Safer alternative (recommended):** remove the in-workflow auto-rotation and rotate `SOAK_TEST_PASSWORD`
  manually (GitHub UI / owner-run fine-grained token), eliminating standing secrets-write from CI entirely.

This PR does not change the `GH_PAT` capability; the decision (prove least-privilege vs. remove the
auto-rotate step) is flagged for the owner.

## Deletion order (all gated on separate PO authorization)

1. Merge #1294; confirm `main` shows zero consumers for the Section A + B(deletable) names (green CI).
2. Owner authorizes the exact deletion list.
3. Delete Section A (retirement set) Secrets.
4. Delete the 7 deletable Section B Secret copies (Variables retained).
5. Flip the two `secrets.SUPABASE_PROJECT_ID` refs → `vars.*` (value-verified), then delete that Secret copy.
6. Delete `VITE_DEV_PREMIUM_ACCESS` if found in any scope.
7. Decide `GH_PAT`: confirm fine-grained least-privilege, or remove the auto-rotate capability.
8. Re-inventory names/scopes and prove: four canonical canary secrets present; zero `CANARY_PASSWORD`; zero
   case-insensitive `*BASIC*`; each deleted stale-dup Variable still present.
