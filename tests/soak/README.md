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

## 🚀 Usage Guide

### 1. Prerequisites
- **Test Users**: Ensure users `soak-test0@test.com` through `soak-test9@test.com` exist in Supabase.
- **Environment**:
    - **CI**: Secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected via GitHub Actions into `.env.development`.
    - **Local**: You must have a local `.env.development` file containing:
      ```bash
      VITE_SUPABASE_URL=...
      # Required for provisioning (Service Role)
      SUPABASE_SERVICE_ROLE_KEY=... 
      # Optional (defaults to password123)
      SOAK_TEST_PASSWORD=...
      ```

### 2. User Provisioning
If users don't exist or passwords are out of sync:

**Step A: Verify Current State**
```bash
pnpm test:soak:verify
```

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
