#!/bin/bash
set -euo pipefail
export HUSKY=0

TEST_RESULTS_DIR="test-results"
METRICS_FILE="$TEST_RESULTS_DIR/metrics.json"
mkdir -p "$TEST_RESULTS_DIR"

echo "--- Combining Metrics and Generating Summary ---"

# Unit Test Metrics
unit_metrics_file="unit-metrics.json"
if [ ! -f "$unit_metrics_file" ]; then
    echo "❌ ERROR: Unit metrics file not found at $unit_metrics_file" >&2
    exit 1
fi
unit_passed=$(jq '.numPassedTests' "$unit_metrics_file")
unit_failed=$(jq '.numFailedTests' "$unit_metrics_file")
unit_skipped=$(jq '.numPendingTests' "$unit_metrics_file")
unit_total=$(jq '.numTotalTests' "$unit_metrics_file")

# Coverage Metrics
coverage_file="$TEST_RESULTS_DIR/coverage/coverage-summary.json"
if [ ! -f "$coverage_file" ]; then
    echo "⚠️ WARNING: Coverage summary not found at $coverage_file. Setting coverage to 0." >&2
    coverage_lines=0
else
    coverage_lines=$(jq '.total.lines.pct' "$coverage_file")
fi

# E2E Test Metrics
e2e_results_file="$TEST_RESULTS_DIR/e2e-results/results.json"
if [ -f "$e2e_results_file" ]; then
    e2e_passed=$(jq '.stats.expected' "$e2e_results_file")
    e2e_failed=$(jq '.stats.unexpected' "$e2e_results_file")
    e2e_skipped=$(jq '.stats.skipped' "$e2e_results_file")
else
    echo "⚠️ E2E results file not found at $e2e_results_file. Assuming 0 tests."
    e2e_passed=0
    e2e_failed=0
    e2e_skipped=0
fi

# Bundle Size Metrics
bundle_size=$(du -sh dist | awk '{print $1}')

# Create the final combined metrics file
jq -n \
  --argjson unit_passed "$unit_passed" \
  --argjson unit_failed "$unit_failed" \
  --argjson unit_skipped "$unit_skipped" \
  --argjson unit_total "$unit_total" \
  --argjson coverage_lines "$coverage_lines" \
  --argjson e2e_passed "$e2e_passed" \
  --argjson e2e_failed "$e2e_failed" \
  --argjson e2e_skipped "$e2e_skipped" \
  --arg bundle_size "$bundle_size" \
  '{
    "unit_tests": { "passed": $unit_passed, "failed": $unit_failed, "skipped": $unit_skipped, "total": $unit_total, "coverage": { "lines": $coverage_lines }},
    "e2e_tests": { "passed": $e2e_passed, "failed": $e2e_failed, "skipped": $e2e_skipped },
    "bundle": { "size": $bundle_size }
  }' > "$METRICS_FILE"

echo "✅ Final metrics file created at $METRICS_FILE"
echo "--- TEST SUMMARY ---"
jq -r '
    "Unit Tests: \(.unit_tests.passed // 0)/\(.unit_tests.total // 0) passed | Coverage: \(.unit_tests.coverage.lines // 0)%",
    "E2E Tests: \(.e2e_tests.passed // 0) passed, \(.e2e_tests.failed // 0) failed, \(.e2e_tests.skipped // 0) skipped",
    "Bundle Size: \(.bundle.size // "unknown")"
' "$METRICS_FILE"
echo "--------------------"
