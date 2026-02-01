# Running Canary Tests

## Overview
Canary tests run against **real staging infrastructure** with live Supabase.

## Running Locally (Requires Credentials)
```bash
# Start dev server first
pnpm dev

# In another terminal, run with CANARY_PASSWORD
CANARY_PASSWORD=your_password pnpm test:canary
```

## Running via GitHub Actions (Recommended)
The canary tests use secrets stored in GitHub. Run remotely:

```bash
# Trigger the canary workflow
gh workflow run "Production Canary Smoke Test"

# Watch the run
gh run list --workflow=canary.yml --limit 1

# Get the run ID
gh run list --workflow=canary.yml --limit 1 --json databaseId

# View failed logs
gh run view <RUN_ID> --log-failed
```

## GitHub Secrets Used
- `CANARY_PASSWORD` - Password for `canary-user@speaksharp.app`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`

## Files
- Config: `playwright.canary.config.ts`
- Tests: `tests/e2e/canary/*.canary.spec.ts`
- Workflow: `.github/workflows/canary.yml`
- Constants: `tests/constants.ts` → `CANARY_USER`
