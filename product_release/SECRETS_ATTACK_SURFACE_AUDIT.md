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
- **Organization scope: UNKNOWN — not enumerable, NOT proof of absence.** `orgs/relativityE/actions/secrets`
  returns HTTP 404 with this repo's token, which means org-level Actions Secrets/Variables **cannot be listed
  from here** — it does not prove that none are exposed to this repository. Any org-scoped setting MUST be
  inventoried with an org-scoped token before any deletion decision.
- **Vercel / Supabase runtime scopes** are SEPARATE from GitHub Actions: several genuine secrets are provisioned
  directly into the Vercel build env or Supabase Edge/DB runtime and are never referenced as `secrets.*` in a
  workflow. Those are dispositioned per their own scope below, not by GitHub-workflow consumption.
- **Caveat — runtime vs workflow consumers:** a Secret with **zero workflow consumers is NOT necessarily
  unused.** Deployed Supabase Edge functions and the Vercel runtime read several secrets at runtime (never
  via `secrets.*` in a workflow). Those are called out below and MUST NOT be deleted on a "no workflow
  consumer" basis.

## A. Confirmed retirement set — zero consumers, delete after #1294 merges

These have **zero** `secrets.*`/`vars.*` consumers on this branch (verified) and no runtime consumer:

| Name | Kind | Consumers | Disposition |
|---|---|---|---|
| Retired ambiguous single canary password (name via `node scripts/retired-secret-names.mjs`) | Secret | none | ✅ **DELETED (#1294)** — confirmed absent from `gh secret list` 2026-08-19; zero real consumers |
| Basic test-credential Secrets (2: email + password) — exact names via `node scripts/retired-secret-names.mjs` | Secret | none | DELETE post-merge |

> **#1258 A1/A3:** the Basic test-credential identifier literal must not appear anywhere in the tree, so this
> audit names those two Secrets indirectly. Print the exact deletion inventory with
> `node scripts/retired-secret-names.mjs` (names only — never values, fingerprints, or presence probes), and
> verify LIVE status with `node scripts/retired-secret-names.mjs --check`.
>
> **Verified live 2026-08-19** (`gh secret list` / `gh variable list`): the retired canary password is **confirmed
> deleted**, but **all four** Basic names are **STILL PRESENT** — the 2 test-credential Secrets (last updated
> 2026-05-16), `STRIPE_BASIC_PRICE_ID` (2026-05-27) and `STRIPE_LIVE_BASIC_PRICE_ID` (2026-06-20). The
> "DELETE post-merge" disposition below is therefore still OUTSTANDING, not done. Deletion requires separate,
> explicit authorization; do not infer it from this document.
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
| `SUPABASE_PROJECT_ID` | none (**flipped in #1294**) | apply-exact-allowlisted-migration, apply-webhook-db-prerequisite, canary, db-grant-check, deploy-supabase-migrations, migrations-preflight, no-unaffiliated-domain, ops-health, service-level-evidence | ✅ yes (after Variable-resolution proof) |

**`SUPABASE_PROJECT_ID` cutover completed in source (#1294):** the two remaining `secrets.SUPABASE_PROJECT_ID`
consumers (`db-grant-check.yml`, `no-unaffiliated-domain.yml`) are flipped to `vars.SUPABASE_PROJECT_ID`, so
all nine consumers now read the Variable and zero read the Secret. Per the PO cutover sequence, the duplicate
Secret is deletable only **after** merge + a Variable-resolution proof (run `db-grant-check` and
`no-unaffiliated-domain` on integrated `main`, terminal-green, proving the Variable path) + explicit deletion
authorization.

**Test-account email cutover completed in source (#1294):** all four test-account emails —
`CANARY_TRIAL_EMAIL`, `CANARY_PAID_EMAIL`, `FREE_TEST_EMAIL`, `PRO_TEST_EMAIL` — are identifiers, not
credentials, and are cut over from Secrets to repository **Variables**. Every active consumer reads
`vars.*_EMAIL`; **zero** read `secrets.*_EMAIL`: `canary.yml`, `setup-test-users.yml`, `rc-gates.yml`,
`live-release-matrix.yml`, `benchmarks.yml`, `billing-freeze-check.yml`, `v4-app-path-proof.yml`,
`v4-benchmark-gpu.yml`, `v4-auto-fallback-proof.yml`. The matching **passwords** (`CANARY_TRIAL_PASSWORD`,
`CANARY_PAID_PASSWORD`, `FREE_TEST_PASSWORD`, `PRO_TEST_PASSWORD`) remain **Secrets**. The
`canary-identity-config` guard fails closed unless both canary email Variables are valid/distinct/
non-prohibited **and** both canary password Secrets are present (value never logged); the flawless-launch
guard statically fails on any active `secrets.*_EMAIL` for these four names or the retired canary password.
Operator state (verified): the four email **Secrets are deleted**, the four email **Variables are
configured**, and all four password Secrets are present. Admin, canary, RC gates, benchmarks, and
live-release workflows must not be dispatched on a `main` that still reads the deleted email Secrets —
dispatch only after this cutover merges.

**✅ Completed deletions (operator, 2026-08-15) — verified names-only via `gh secret list`:**
1. the retired ambiguous single canary password;
2. `CANARY_TRIAL_EMAIL` **Secret** copy (identifier now a Variable);
3. `CANARY_PAID_EMAIL` **Secret** copy (identifier now a Variable);
4. `FREE_TEST_EMAIL` **Secret** copy (identifier now a Variable);
5. `PRO_TEST_EMAIL` **Secret** copy (identifier now a Variable).

Retained: the four email **Variables** (`CANARY_TRIAL_EMAIL`, `CANARY_PAID_EMAIL`, `FREE_TEST_EMAIL`,
`PRO_TEST_EMAIL`) and the four password **Secrets** (`CANARY_TRIAL_PASSWORD`, `CANARY_PAID_PASSWORD`,
`FREE_TEST_PASSWORD`, `PRO_TEST_PASSWORD`).

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
| `SUPABASE_DB_PASSWORD` | Supabase CLI / DB connection (deploy/migration runtime) |

**`ASSEMBLYAI_API_KEY` — REVIEW, do NOT assume "consumed by assemblyai-token".** The deployed
`assemblyai-token` Edge function no longer reads the key or calls AssemblyAI, so the **Supabase runtime**
copy of this key appears **stale** (candidate to REVIEW/remove at the Supabase scope). Any **GitHub**-scoped
AssemblyAI key (e.g. for a benchmark workflow) is a **separate** setting at a different scope. Disposition the
Supabase runtime copy and any GitHub key **independently**; a single consumer claim does not cover both.

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

## Per-name disposition (KEEP / MIGRATE / DELETE / REVIEW)

| Name(s) | Scope | Disposition | Prerequisite |
|---|---|---|---|
| The retired set printed by `node scripts/retired-secret-names.mjs` (the canary password — already deleted — plus the 2 Basic test-credential Secrets and the 2 Basic Stripe price Secrets, all 4 still present) | GitHub | **DELETE** (retired) | merged `main` zero-consumer proof + deletion authorization |
| `EDGE_FN_URL`, `POSTHOG_API_HOST`, `POSTHOG_INGEST_HOST`, `POSTHOG_PROJECT_API_KEY`, `SENTRY_DSN`, `SUPABASE_URL`, `VERCEL_PROJECT_ID`, `SUPABASE_PROJECT_ID` | GitHub | **MIGRATE→DELETE dup Secret** (retain Variable) | PO 8-step cutover: Variable-resolution proof on `main`, then authorized deletion |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, `STRIPE_LIVE_*`, `VERCEL_*_TOKEN`, `GEMINI_API_KEY`, `AGENT_SECRET`, `PROMO_GEN_ADMIN_SECRET`, `OBSERVABILITY_SMOKE_SECRET`, `SENTRY_AUTH_TOKEN`, `POSTHOG_PERSONAL_API_KEY` | GitHub / runtime | **KEEP** | current consumer + least-privilege scope/trigger |
| `ASSEMBLYAI_API_KEY` (Supabase runtime copy) | Supabase | **REVIEW** (appears stale — `assemblyai-token` no longer calls AssemblyAI) | confirm no runtime consumer; disposition separately from any GitHub key |
| `GH_PAT` | GitHub | **REVIEW** | confirm fine-grained repo-only least-privilege, or remove the auto-rotate step |
| `VITE_DEV_PREMIUM_ACCESS` | any | **DELETE if present** | not configured at repo scope; unconsumed by shipping source |
| org-scoped settings | Organization | **UNKNOWN** | inventory with an org-scoped token before any decision |

## Exclusion-manifest (`AUDIT_EXCLUDED_EMAILS_JSON`) cutover — retire the `@speaksharp.app` identities

`AUDIT_EXCLUDED_EMAILS_JSON` is the reviewed exclusion manifest for `tester-evidence-audit` +
`tester-cohort-audit`. Both now use **one strict shared parser** (`scripts/lib/auditManifest.mjs`) that
fails closed — before any Supabase client construction or artifact — on an absent/malformed/loosely-shaped/
incomplete/duplicate manifest **or any `speaksharp.app` (apex or subdomain) identity**. The current manifest
still names five retired `@speaksharp.app` identities (4 `synthetic` + the former single `canary`); it now
**fails the audits closed** until reconciled. **Source is complete; the manifest content + version metadata
changes below are OPERATIONAL and separately PO-authorized after ACCEPT + merge.** Never hardcode the
controlled canary addresses in source or logs (reference them only by the Secret NAMES).

Final manifest structure (all five keys always present; addresses referenced by Secret NAME, never hardcoded):
`owner_admin` = the single genuine owner/admin identity (verify it is not a test account, else reclassify/retire);
`synthetic` = `[]`; `checkout` = `[]`; `canary` = exactly `CANARY_TRIAL_EMAIL` + `CANARY_PAID_EMAIL`;
`qa` = the new controlled `FREE_TEST_EMAIL`. The `FREE_TEST_EMAIL` Free account is created via **Admin - Test
Users `create_purpose=free_test`** (secret-backed; password never a dispatch input) AFTER the non-activation
migrations establish the 30-day trial, and is verified as a genuine active immutable 30-day trial, distinct
from both canary identities and never a `@speaksharp.app`/`free-user@test.com`/`basic-user@test.com` address.

Operational sequence (post-accept, PO-authorized, names-only evidence — no addresses/credentials printed):
1. Sanitized read-only exact-identity inventory of the 5 retired `@speaksharp.app` identities + the two
   controlled canaries (`CANARY_TRIAL_EMAIL`, `CANARY_PAID_EMAIL`): report presence/absence + dependent-row counts.
2. Disposition packet for every surviving retired-domain Auth/profile/session/evidence row (no deletion yet).
3. After authorization, disable/delete the retired-domain identities + disposition dependent synthetic data.
4. Replace the manifest `canary` category with **exactly** the `CANARY_TRIAL_EMAIL` + `CANARY_PAID_EMAIL`
   values; remove the 4 old `synthetic` entries only after their production rows are proven absent. All five
   keys stay present even when an array is empty.
5. Verify `owner_admin` is a genuine owner/admin identity; reclassify or retire if it is a test account.
6. Increment `AUDIT_EXCLUSION_LIST_VERSION` and set `AUDIT_EXCLUSION_LIST_REVIEWED_AT` to the actual UTC review time.
7. Run both audits on exact integrated `main`: require terminal success, zero prohibited-domain identities,
   correct exclusion counts, sanitized artifacts; record run IDs/URLs + names-only secret/variable readback.

## Deletion order (all gated on separate PO authorization; one auditable post-merge cutover)

1. Merge #1294; re-scan **current `main`** (not the worktree) and prove zero `secrets.*` consumers for the DELETE + MIGRATE names.
2. **Variable-resolution proof (mandatory intermediate stage)** for each MIGRATE name: verify the same-named Variable is present + nonblank at the executing scope, run the maintained workflows that consume it on the exact integrated `main` SHA (including `db-grant-check` + `no-unaffiliated-domain` for `SUPABASE_PROJECT_ID`), require terminal-green, and prove the jobs consumed the `vars.*` path with no Secret fallback.
3. Prepare the exact deletion packet (each name, its retained Variable, scope, zero-consumer proof, Variable-backed run IDs).
4. Obtain separate PO authorization for that exact list.
5. Delete the retirement-set Secrets (Section A) and the duplicate Secret copies (Section B); retain the Variables.
6. Post-deletion readback + regression: re-inventory names/scopes, prove each deleted Secret absent and each retained Variable present, then rerun the affected workflow proof terminal green.
7. Delete `VITE_DEV_PREMIUM_ACCESS` if found in any scope; decide `GH_PAT` (least-privilege vs. remove auto-rotate); REVIEW the Supabase `ASSEMBLYAI_API_KEY` copy.
8. Re-inventory names/scopes and prove: four canonical canary secrets present; zero retired canary password; zero
   case-insensitive `*BASIC*`; each deleted stale-dup Variable still present.
