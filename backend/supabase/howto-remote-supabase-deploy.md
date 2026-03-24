# Remote Supabase Deployment Guide

This document outlines the **Correct Way to Use GitHub Secrets from CLI** for deploying migrations and edge functions to the production Supabase project.

## 🚀 The Protocol

Instead of attempting to retrieve secrets (which are write-only in GitHub) or storing them locally, you should trigger the official CI/CD workflows that already have authorized access.

### 1. Trigger Deployment
Run the following command from your terminal:
```bash
gh workflow run deploy-supabase-migrations.yml -f confirm=DEPLOY
```

> [!IMPORTANT]
> **CRITICAL: GITHUB-FIRST RULE**
> **Any new migration files MUST be committed and pushed to the GitHub repository BEFORE running any deployment commands below.** The GitHub Action runner pulls code directly from the repository; if your local migrations are not yet pushed to the remote `main` branch, the deployment workflow will FAIL to see them.

### 2. Monitor Progress
You can watch the execution in real-time:
```bash
gh run watch
```

Alternatively, to view the details of a specific run (including logs for each step):
```bash
gh run view <run-id> --log
```
*Tip: You can find the `<run-id>` in the output of `gh workflow run` or by listing recent runs with `gh run list --workflow=deploy-supabase-migrations.yml`.*

This executes the migration inside GitHub’s runner, where the `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, and `SUPABASE_DB_PASSWORD` exist securely.

## 🛡️ Why This Is The Recommended Approach

This pattern is the "Gold Standard" for SpeakSharp because:

| Benefit | Explanation |
| :--- | :--- |
| **Secrets Isolation** | Secrets never leave GitHub's secure environment. |
| **Reproducible Deploys** | Ensures the same process is used locally and in CI. |
| **Audit Trail** | GitHub logs every run, providing a history of who deployed what. |
| **No Credential Sharing** | Developer machines and transient agents never store DB passwords. |

It is effectively **"remote execution with secrets"**, ensuring maximum security without sacrificing velocity.

## 📋 Verification
After the workflow completes, you can verify the status by running:
```bash
supabase migration list
```
Applied migrations will show a timestamp in the **Remote** column.
