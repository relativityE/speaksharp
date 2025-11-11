#!/bin/bash
# Canonical Test Audit Script (v7)
# Single Source of Truth for all quality checks.
# Design Principles:
# 1. Staged Execution: Fail fast. Run cheapest checks first.
# 2. Parallel by Default: Maximize performance to stay under 7-min CI limit.
# 3. Mode-Based: Support a fast 'local' mode and a comprehensive 'ci' mode.
# 4. Robust Error Handling: Explicitly check exit codes to prevent silent failures.
set -euo pipefail
trap 'echo "❌ An error occurred. Aborting test audit." >&2' ERR

# --- Configuration ---
E2E_TEST_DIR="tests/e2e"
E2E_SHARD_THRESHOLD=3

# --- Argument Parsing ---
MODE="local"
E2E_MODE="all"
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --mode) MODE="$2"; shift ;;
        --e2e) E2E_MODE="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

echo "🚀 Starting Test Audit (Mode: $MODE, E2E: $E2E_MODE)..."

# --- STAGE 1: Preflight ---
echo "✅ [Stage 1/4] Running Preflight Checks..."
./scripts/preflight.sh
echo "✅ [Stage 1/4] Preflight Checks Passed."

# --- STAGE 2: Code Quality (Parallel) ---
echo "✅ [Stage 2/4] Running Code Quality Checks in Parallel..."
pnpm exec concurrently "pnpm lint" "pnpm typecheck" "pnpm test" || {
  echo "❌ Code Quality Checks failed" >&2
  exit 1
}
echo "✅ [Stage 2/4] Code Quality Checks Passed."

# --- STAGE 3: Build ---
echo "✅ [Stage 3/4] Building Application for E2E Tests..."
pnpm build:test || {
  echo "❌ Build failed" >&2
  exit 1
}
echo "✅ [Stage 3/4] Build Succeeded."

# --- STAGE 4: End-to-End (E2E) Tests ---
echo "✅ [Stage 4/4] Running E2E Tests..."
readarray -t E2E_TEST_FILES < <(find "$E2E_TEST_DIR" -name '*.spec.ts' -print | sort)
E2E_TEST_COUNT=${#E2E_TEST_FILES[@]}

if [ "$E2E_TEST_COUNT" -eq 0 ]; then
  echo "⚠️ Warning: No E2E test files found. Skipping."
else
  echo "📋 Found ${E2E_TEST_COUNT} E2E test files."

  if [ "$E2E_MODE" = "health-check" ]; then
    echo "💨 Running E2E Health Check (@health-check)..."
    pnpm exec playwright test --grep "@health-check" || {
      echo "❌ E2E Health Check failed" >&2
      exit 1
    }
  else
    if [ "$E2E_TEST_COUNT" -gt "$E2E_SHARD_THRESHOLD" ]; then
      echo "🏎️ Running E2E tests in parallel (sharded)..."
      pnpm exec playwright test "${E2E_TEST_FILES[@]}" || {
        echo "❌ E2E full suite failed" >&2
        exit 1
      }
    else
      echo "Running small E2E suite in a single process..."
      pnpm exec playwright test "${E2E_TEST_FILES[@]}" || {
        echo "❌ E2E small suite failed" >&2
        exit 1
      }
    fi
  fi
  echo "✅ [Stage 4/4] E2E Tests Passed."
fi

# --- STAGE 5: Software Quality Metrics (SQM) ---
echo "✅ [Stage 5/5] Handling Software Quality Metrics..."
if [ -f "./run-metrics.sh" ]; then
    ./run-metrics.sh
    if [ "$MODE" = "ci" ]; then
        echo "CI mode detected. Updating PRD.md with SQM report..."
        pnpm exec node scripts/update-prd-metrics.mjs
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
