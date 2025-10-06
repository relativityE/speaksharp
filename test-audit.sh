#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# ./test-audit.sh
# ------------------------------------------------------------------------------
# This script is the canonical local audit entry point.
# It mirrors CI/CD test execution, measures test runtimes, dynamically shards E2E tests,
# and documents results for visibility and reproducibility.
#
# Principles:
#  - Trust but Verify: Code and runtime data are the ultimate truth.
#  - Single Source of Truth: Only essential scripts and test markdowns are committed.
#  - No Bloat: Never commit regeneratable artifacts (screens, traces, etc.).
# ==============================================================================

ROOT_DIR="$(pwd)"
TEST_SUPPORT_DIR="$ROOT_DIR/test-support"
RUNTIME_FILE="$ROOT_DIR/docs/e2e-test-runtimes.json"
STATUS_MD="$TEST_SUPPORT_DIR/test-audit-status.md"
SHARD_MANIFEST="$TEST_SUPPORT_DIR/shards/shard-manifest.json"
CREATE_SHARDS_SCRIPT="$TEST_SUPPORT_DIR/utils/create-shards.js"

# ------------------------------------------------------------------------------
# 0. Environment Verification & Clean
# ------------------------------------------------------------------------------
echo "[INFO] 🔍 Verifying environment and cleaning workspace..."
command -v pnpm >/dev/null 2>&1 || { echo "[ERROR] pnpm not found. Please install it."; exit 1; }
command -v timeout >/dev/null 2>&1 || { echo "[ERROR] timeout not found. Please install coreutils."; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "[ERROR] jq not found. Please install jq."; exit 1; }

# Clean stale TypeScript build info to prevent caching issues
rm -f tsconfig.tsbuildinfo
rm -f tsconfig.node.tsbuildinfo

mkdir -p "$TEST_SUPPORT_DIR" "$ROOT_DIR/docs" "$TEST_SUPPORT_DIR/shards"

# ------------------------------------------------------------------------------
# 1. Static Analysis: TypeScript + Linting
# ------------------------------------------------------------------------------
echo "[INFO] 🧩 Running TypeScript & ESLint checks..."
pnpm exec tsc --noEmit || { echo "[ERROR] TypeScript errors detected."; exit 1; }
pnpm exec eslint . --ext .ts,.tsx || { echo "[ERROR] ESLint errors detected."; exit 1; }
echo "[INFO] ✅ TypeScript & ESLint checks passed."

# ------------------------------------------------------------------------------
# 2. Establish E2E Test Baseline
# ------------------------------------------------------------------------------
echo "[INFO] 🧪 Establishing baseline: measuring individual E2E test runtimes..."
E2E_DIR="$ROOT_DIR/tests/e2e"
> "$RUNTIME_FILE"

echo "{" >> "$RUNTIME_FILE"
first_entry=true

for test_file in $(find "$E2E_DIR" -type f -name "*.spec.ts" | sort); do
  echo "[INFO] Running baseline timing for $test_file ..."

  # Run test with timeout (4 mins) and measure time
  START_TIME=$(date +%s)
  if timeout 240s pnpm exec playwright test "$test_file" --reporter=list >/dev/null 2>&1; then
    END_TIME=$(date +%s)
    RUNTIME=$((END_TIME - START_TIME))
    echo "[PASS] $test_file completed in ${RUNTIME}s"
  else
    END_TIME=$(date +%s)
    RUNTIME=$((END_TIME - START_TIME))
    echo "[FAIL] $test_file failed (timeout or error). Recorded runtime anyway: ${RUNTIME}s"
  fi

  # Append runtime result to JSON file
  if [ "$first_entry" = true ]; then
    first_entry=false
  else
    echo "," >> "$RUNTIME_FILE"
  fi
  echo "\"$test_file\": $RUNTIME" >> "$RUNTIME_FILE"
done

echo "}" >> "$RUNTIME_FILE"
echo "[INFO] ✅ Baseline runtimes recorded in $RUNTIME_FILE"

# ------------------------------------------------------------------------------
# 3. Generate Shards
# ------------------------------------------------------------------------------
echo "[INFO] ⚙️ Generating dynamic shards..."
node "$CREATE_SHARDS_SCRIPT"
echo "[INFO] ✅ Shard manifest created at $SHARD_MANIFEST"

# ------------------------------------------------------------------------------
# 4. Execute Shards Sequentially (max 7 mins per shard)
# ------------------------------------------------------------------------------
echo "[INFO] 🚀 Running Playwright E2E tests by shard..."
> "$STATUS_MD"
echo "# Test Audit Report" >> "$STATUS_MD"
echo "_Generated: $(date)_  " >> "$STATUS_MD"
echo "## Summary" >> "$STATUS_MD"

TOTAL_SHARDS=$(jq '.shards | length' "$SHARD_MANIFEST")

for (( i=0; i<$TOTAL_SHARDS; i++ )); do
  echo "" >> "$STATUS_MD"
  echo "### Shard $((i+1))" >> "$STATUS_MD"

  TEST_FILES=$(jq -r ".shards[$i][]" "$SHARD_MANIFEST")
  echo "Files:" >> "$STATUS_MD"
  echo "$TEST_FILES" | sed 's/^/- /' >> "$STATUS_MD"

  SHARD_START=$(date +%s)
  PASS_COUNT=0
  FAIL_COUNT=0

  for test_file in $TEST_FILES; do
    echo "[INFO] Executing $test_file ..."
    if timeout 420s pnpm exec playwright test "$test_file" --reporter=list; then
      echo "[PASS] $test_file"
      PASS_COUNT=$((PASS_COUNT+1))
    else
      echo "[FAIL] $test_file"
      FAIL_COUNT=$((FAIL_COUNT+1))
    fi
  done

  SHARD_END=$(date +%s)
  SHARD_RUNTIME=$((SHARD_END - SHARD_START))

  echo "" >> "$STATUS_MD"
  echo "- Runtime: ${SHARD_RUNTIME}s" >> "$STATUS_MD"
  echo "- Passed: $PASS_COUNT  " >> "$STATUS_MD"
  echo "- Failed: $FAIL_COUNT  " >> "$STATUS_MD"
  echo "- Status: $( [ "$FAIL_COUNT" -eq 0 ] && echo "✅ PASS" || echo "❌ FAIL" )" >> "$STATUS_MD"
done

echo "[INFO] ✅ All shards complete. Results documented at $STATUS_MD"

# ------------------------------------------------------------------------------
# 5. Cleanup & Summary
# ------------------------------------------------------------------------------
echo "[INFO] 🧹 Cleaning up temporary Playwright artifacts..."
rm -rf test-results || true

echo "[INFO] 🏁 Audit complete!"