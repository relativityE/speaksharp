#!/bin/bash
# Canonical Test Audit Script (v4)
# Single Source of Truth for all quality checks.
# Design Principles:
# 1. Staged Execution: Fail fast. Run cheapest checks first.
# 2. Parallel by Default: Maximize performance to stay under 7-min CI limit.
# 3. Mode-Based: Support a fast 'local' mode and a comprehensive 'ci' mode.
# 4. In-Memory Sharding: Avoids unreliable file I/O for E2E test distribution.
set -ex
trap 'echo "❌ An error occurred. Aborting test audit." >&2' ERR

# --- Configuration ---
# All test files must be in this directory.
E2E_TEST_DIR="tests/e2e"

# Theshold for sharding. If more tests than this, run in parallel.
# Tuned to avoid overhead on small test suites.
E2E_SHARD_THRESHOLD=3

# --- Argument Parsing ---
MODE="local" # Default mode
E2E_MODE="all" # Default E2E mode
if [[ "$1" == "--mode" && -n "$2" ]]; then
  MODE="$2"
  shift 2
fi
if [[ "$1" == "--e2e" && -n "$2" ]]; then
  E2E_MODE="$2"
  shift 2
fi

echo "🚀 Starting Test Audit (Mode: $MODE, E2E: $E2E_MODE)..."

# --- STAGE 1: Preflight ---
# Lightweight sanity checks.
echo "✅ [Stage 1/4] Running Preflight Checks..."
./scripts/preflight.sh
echo "✅ [Stage 1/4] Preflight Checks Passed."

# --- STAGE 2: Code Quality (Parallel) ---
# Linting, Type Checking, and Unit Tests. These are fast and can run together.
echo "✅ [Stage 2/4] Running Code Quality Checks in Parallel..."
# We use pnpm exec to ensure local binaries are found.
pnpm exec concurrently "pnpm lint" "pnpm typecheck" "pnpm test"
echo "✅ [Stage 2/4] Code Quality Checks Passed."

# --- STAGE 3: Build ---
# A production-like build is required for E2E tests.
echo "✅ [Stage 3/4] Building Application for E2E Tests..."
# The 'build:test' script is specifically for this purpose.
pnpm build:test
echo "✅ [Stage 3/4] Build Succeeded."

# --- STAGE 4: End-to-End (E2E) Tests ---
echo "✅ [Stage 4/4] Running E2E Tests..."
# Discover test files and store them in a bash array (in-memory).
# This is robust against filesystem flakiness.
readarray -t E2E_TEST_FILES < <(find "$E2E_TEST_DIR" -name '*.spec.ts' -print | sort)
E2E_TEST_COUNT=${#E2E_TEST_FILES[@]}

if [ "$E2E_TEST_COUNT" -eq 0 ]; then
  echo "⚠️ Warning: No E2E test files found in $E2E_TEST_DIR with pattern *.spec.ts. Skipping."
else
  echo "📋 Found ${E2E_TEST_COUNT} E2E test files:"
  printf '   - %s\n' "${E2E_TEST_FILES[@]}"

  # Health-check mode runs tests tagged with @health-check.
  if [ "$E2E_MODE" = "health-check" ]; then
    echo "💨 Running E2E Health Check (@health-check)..."
    pnpm exec playwright test --reporter=list --grep "@health-check" || {
      echo "❌ E2E Health Check failed" >&2
      exit 1
    }
  else
    # 'all' mode runs the full suite, sharded if necessary.
    echo "Found ${E2E_TEST_COUNT} E2E tests. Threshold for sharding is $E2E_SHARD_THRESHOLD."
    if [ "$E2E_TEST_COUNT" -gt "$E2E_SHARD_THRESHOLD" ]; then
      echo "🏎️ Running E2E tests in parallel (sharded)..."
      pnpm exec playwright test --reporter=list "${E2E_TEST_FILES[@]}" || {
        echo "❌ E2E full suite failed" >&2
        exit 1
      }
    else
      echo "Running small E2E suite in a single process..."
      pnpm exec playwright test --reporter=list "${E2E_TEST_FILES[@]}" || {
        echo "❌ E2E small suite failed" >&2
        exit 1
      }
    fi
  fi
  echo "✅ [Stage 4/4] E2E Tests Passed."
fi

# --- STAGE 5: Software Quality Metrics (SQM) ---
echo "✅ [Stage 5/5] Handling Software Quality Metrics..."
# This stage was restored based on code review feedback.
# It runs metrics generation and conditionally reports them.
if [ -f "./run-metrics.sh" ]; then
    ./run-metrics.sh

    if [ "$MODE" = "ci" ]; then
        echo "CI mode detected. Updating PRD.md with SQM report..."
        pnpm exec node scripts/update-prd-metrics.mjs
        echo "✅ SQM metrics updated in docs/PRD.md"
    else
        echo "Local mode detected. Printing SQM report to console..."
        pnpm exec node scripts/print-metrics.mjs
    fi
else
    echo "⚠️ Warning: Metric generation scripts not found. Skipping SQM."
fi
echo "✅ [Stage 5/5] SQM Handling Complete."


# --- Summary ---
echo "🎉🎉🎉"
echo "✅ SpeakSharp Test Audit SUCCEEDED (Mode: $MODE)!"
echo "🎉🎉🎉"
