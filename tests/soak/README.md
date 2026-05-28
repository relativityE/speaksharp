# SpeakSharp Stress & Endurance Testing Architecture

## Overview
This directory contains the infrastructure for backend stress and browser endurance evidence. The directory name is historical; the active workflow is `.github/workflows/stress-endurance.yml`.

## Architecture

### The Problem: Browser Resource Limits
Traditional end-to-end (E2E) testing with Playwright involves spinning up a full browser instance (Chromium) for each user.
- **Resource Cost**: ~400MB RAM + ~1 CPU Core per user.
- **Bottleneck**: A developer laptop or CI runner caps out at ~5-10 concurrent users.
- **Result**: You end up testing the *machine's* ability to run Chrome, not the *backend's* ability to handle traffic.

### The Solution: Tiered Verification (Path B)
We split the testing into two distinct layers:

#### Tier 1: API Stress
- **Tool**: Native Node.js (`test:stress:backend`) using Supabase client calls.
- **Concurrency**: The provisioned soak registry (`soak-test0..4` Free plus `soak-test25..34` Pro by default).
- **Purpose**: Hits Supabase Auth, the `check-usage-limit` Edge Function, and the current `create_session_and_update_usage` RPC directly.
- **Resource Cost**: <5MB per user.
- **Verifies**: Auth availability, RLS-visible Edge behavior, current session-save RPC compatibility, database locking, and API latency.

#### Tier 2: Browser Endurance
- **Tool**: Playwright (`test:endurance:browser`).
- **Concurrency**: 2 isolated browser contexts by default.
- **Purpose**: Verifies that the Frontend React app can run an extended Browser/Native STT session without leaking state or memory.
- **Verifies**: Client-side hydration, authenticated routing, Native-mode selection, recording controls, sustained Native recording state, analytics navigation, and browser stability.

---

## 📂 File Manifest & Purpose

| File | Purpose |
|------|---------|
| **`backend-api-stress-test.ts`** | **The Core Load Test**. A lightweight Node.js script that orchestrates the provisioned soak users. It performs the current backend path (Auth -> check usage -> create session via current RPC) using unprivileged Supabase anon credentials. |
| **`soak-test.spec.ts`** | **The Stress/Endurance Coordinator**. A Playwright coordinator that runs backend stress first, then verifies the Native browser recording path in isolated browsers. |
| **`verify-users.ts`** | **Pre-flight Check**. A 10-second script/tool to verify that all provisioned soak users can authenticate with the configured password. |
| **`verify-soak-users.sh`** | **Shell Alternative**. A bash version of the verification script, useful for CI environments without a Node runtime setup. |
| **`metrics-collector.ts`** | **Shared Logic**. Collects performance metrics (latency, success rates) and generates the console summary report. |

---

## 🚀 Usage Guide & Security Mapping (Crucial Design)

Both phases of the stress/endurance checks use **Frontend Credentials** (the `SUPABASE_ANON_KEY`), and that is a deliberate and crucial security design.

Here is exactly how the credentials map:

### 1. The Headless API Stress Test (Node.js)
Even though it's a backend Node script hammering the database, it initializes its Supabase client using `SUPABASE_ANON_KEY`.

*   **Why?** If we used the `SUPABASE_SERVICE_ROLE_KEY` (the true backend admin key), Supabase would entirely bypass our Row Level Security (RLS) policies and rate limits. The test would succeed, but it would be a "fake" success because it wouldn't be subject to the real throttling that regular users face.
*   By using the `ANON_KEY`, the 30 headless simulated users look exactly like 30 real web browsers to Supabase's Edge network, ensuring we actually test the rate limits protecting the Free tier.

### 2. The Browser Endurance Check (Playwright)
This phase boots up actual Chromium browsers. In `stress-endurance.yml`, we inject `SOAK_TEST_PASSWORD`.

*   **Why?** Playwright automatically navigates to `speaksharp.app`, types in `soak-test0@test.com` and your `SOAK_TEST_PASSWORD` into the standard login form, and clicks "Sign In". It runs exactly as a real human user would, purely through the frontend React interface.

**In Summary:** The stress/endurance suite operates from the perspective of an external, untrusted web client. We never use admin privileges to bypass the tests.

---

### Database Provisioning & Accounts

There are exactly 36 existing stress/endurance test accounts in the remote Supabase database (`soak-test0@test.com` through `soak-test34@test.com`, plus one `soak-test-0@example.com`).

To avoid unnecessary account creation and churn during testing, we explicitly map the users as follows in `tests/constants.ts` and `scripts/setup-test-users.mjs`:
- **Free Users (5 total):** `soak-test0` through `soak-test4`
- **Pro Users (10 total):** `soak-test25` through `soak-test34`

If you change the counts in `constants.ts`, ensure you update `scripts/setup-test-users.mjs` to map to sequential, existing indices to avoid hitting Supabase anti-bot rate limits during account creation.

---

### Execution Constraints & CI

To protect developer machines and live databases from accidental load spikes, scheduled stress/endurance evidence should come from GitHub Actions. Local runs are useful for debugging only when explicitly configured with a short duration and live test credentials.

- It relies on GitHub Actions injecting `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SOAK_TEST_PASSWORD` secrets at runtime to conduct the tests.

**Step B: Provision Users**
If verification fails, run the setup script. Ensure your `.env.development` has the Service Role Key.
```bash
pnpm tsx scripts/setup-test-users.mjs
```

### 3. Run the Tests

**Run Tier 1: Backend Stress**
```bash
pnpm test:stress:backend
```

**Run Tier 2: Browser Endurance**
```bash
pnpm test:endurance:browser
```

---

## 📊 Success Metrics

### API Stress (Backend)
- **Auth P95**: < 2000ms
- **Request Failure Rate**: 0%
- **Throughput**: Sustained ~5 ops/sec per user

### Browser Endurance (Frontend)
- **Stability**: 100% Pass Rate
- **Hydration**: Elements appear < 15s
- **Memory**: Browser context < 200MB growth
