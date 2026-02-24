# SpeakSharp Soak & Load Testing Architecture

## Overview
This directory contains the infrastructure for stress testing the SpeakSharp application. We use a **Tiered Testing Strategy** to isolate backend performance from browser overhead.

## Architecture

### The Problem: Browser Resource Limits
Traditional end-to-end (E2E) testing with Playwright involves spinning up a full browser instance (Chromium) for each user.
- **Resource Cost**: ~400MB RAM + ~1 CPU Core per user.
- **Bottleneck**: A developer laptop or CI runner caps out at ~5-10 concurrent users.
- **Result**: You end up testing the *machine's* ability to run Chrome, not the *backend's* ability to handle traffic.

### The Solution: Tiered Verification (Path B)
We split the testing into two distinct layers:

#### Tier 1: API Stress (The "Load" Test)
- **Tool**: Native Node.js (`test:soak:api`) using `fetch`.
- **Concurrency**: 10 - 100+ Users.
- **Purpose**: Hits Supabase Auth, Database, and API endpoints directly.
- **Resource Cost**: <5MB per user.
- **Verifies**: Backend throughput, database locking, API latency.

#### Tier 2: UI Smoke (The "Integration" Test)
- **Tool**: Playwright (`test:soak`).
- **Concurrency**: 3 Users.
- **Purpose**: Verifies that the Frontend React app correctly integrates with the backend.
- **Verifies**: Client-side hydration, WebSocket connections, UI rendering.

---

## 📂 File Manifest & Purpose

| File | Purpose |
|------|---------|
| **`api-load-test.ts`** | **The Core Load Test**. A lightweight Node.js script that orchestrates N concurrent users. It performs the full user journey (Auth -> Create Session -> Patch Transcript) using raw HTTP requests, bypassing the browser. |
| **`soak-test.spec.ts`** | **The UI Smoke Test**. A Playwright test suite limited to 3 users. It verifies that the "Golden Path" (Login -> Record -> Analyze) works in a real browser. |
| **`verify-users.ts`** | **Pre-flight Check**. A 10-second script/tool to verify that all 10 test users (`soak-test0`..`soak-test9`) can authenticate with the configured password. |
| **`verify-soak-users.sh`** | **Shell Alternative**. A bash version of the verification script, useful for CI environments without a Node runtime setup. |
| **`metrics-collector.ts`** | **Shared Logic**. Collects performance metrics (latency, success rates) and generates the console summary report. |

---

## 🚀 Usage Guide & Security Mapping (Crucial Design)

Both phases of the Soak Test are strictly using **Frontend Credentials** (the `SUPABASE_ANON_KEY`), and that is a deliberate and crucial security design!

Here is exactly how the credentials map:

### 1. The Headless API Stress Test (Node.js)
Even though it's a backend Node script hammering the database, it initializes its Supabase client using `SUPABASE_ANON_KEY`.

*   **Why?** If we used the `SUPABASE_SERVICE_ROLE_KEY` (the true backend admin key), Supabase would entirely bypass our Row Level Security (RLS) policies and rate limits. The test would succeed, but it would be a "fake" success because it wouldn't be subject to the real throttling that regular users face.
*   By using the `ANON_KEY`, the 30 headless simulated users look exactly like 30 real web browsers to Supabase's Edge network, ensuring we actually test the rate limits protecting your Free Tier.

### 2. The UI Memory Check (Playwright)
This phase boots up actual Chromium browsers. In `soak-test.yml`, we inject `SOAK_TEST_PASSWORD`.

*   **Why?** Playwright automatically navigates to `speaksharp.app`, types in `soak-test0@test.com` and your `SOAK_TEST_PASSWORD` into the standard login form, and clicks "Sign In". It runs exactly as a real human user would, purely through the frontend React interface.

**In Summary:** The entire soak test suite operates from the perspective of an external, untrusted web client. We never use admin privileges to bypass the tests!

---

### Database Provisioning & Accounts

There are exactly 36 existing soak test accounts in the remote Supabase database (`soak-test0@test.com` through `soak-test34@test.com`, plus one `soak-test-0@example.com`).

To avoid unnecessary account creation and churn during testing, we explicitly map the users as follows in `tests/constants.ts` and `scripts/setup-test-users.mjs`:
- **Free Users (5 total):** `soak-test0` through `soak-test4`
- **Pro Users (10 total):** `soak-test25` through `soak-test34`

If you change the counts in `constants.ts`, ensure you update `scripts/setup-test-users.mjs` to map to sequential, existing indices to avoid hitting Supabase anti-bot rate limits during account creation.

---

### Execution Constraints & CI

To protect developer machines and live databases from accidental load spikes, **the Soak Test can only run from the GitHub Cloud Server**.

- A hard environmental guard (`test.skip(!process.env.CI)`) is implemented in `soak-test.spec.ts`. If executed locally, the test suite will instantly abort.
- It relies entirely on GitHub Actions injecting `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SOAK_TEST_PASSWORD` secrets at runtime to conduct the tests.

**Step B: Provision Users**
If verification fails, run the setup script. Ensure your `.env.development` has the Service Role Key.
```bash
pnpm tsx scripts/setup-test-users.mjs
```

### 3. Run the Tests

**Run Tier 1: Backend Stress (10 Users/5 Min)**
```bash
pnpm test:soak:api
```

**Run Tier 2: Frontend Integration (3 Users/5 Min)**
```bash
pnpm test:soak
```

---

## 📊 Success Metrics

### API Stress (Backend)
- **Auth P95**: < 2000ms
- **Request Failure Rate**: 0%
- **Throughput**: Sustained ~5 ops/sec per user

### UI Smoke (Frontend)
- **Stability**: 100% Pass Rate
- **Hydration**: Elements appear < 15s
- **Memory**: Browser context < 200MB growth
