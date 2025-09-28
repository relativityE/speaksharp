#!/bin/bash
set -euo pipefail
export HUSKY=0

TEST_RESULTS_DIR="test-results"
METRICS_FILE="$TEST_RESULTS_DIR/metrics.json"

echo "--- Combining Metrics and Generating Summary ---"

# Unit Test Metrics
unit_metrics_file="unit-metrics.json"
unit_passed=$(jq '.numPassedTests' "$unit_metrics_file")
unit_failed=$(jq '.numFailedTests' "$unit_metrics_file")
unit_skipped=$(jq '.numPendingTests' "$unit_metrics_file")
unit_total=$(jq '.numTotalTests' "$unit_metrics_file")

# Coverage Metrics
coverage_file="$TEST_RESULTS_DIR/coverage/coverage-summary.json"
coverage_lines=$(jq '.total.lines.pct' "$coverage_file")

# E2E Test Metrics
e2e_results_file="$TEST_RESULTS_DIR/e2e-results/results.json"
if [ -f "$e2e_results_file" ]; then
    e2e_passed=$(jq '[.suites[].specs[] | select(.ok == true)] | length' "$e2e_results_file")
    e2e_failed=$(jq '[.suites[].specs[] | select(.ok == false)] | length' "$e2e_results_file")
    e2e_skipped=$(jq '[.suites[].specs[] | select(.ok != true and .ok != false)] | length' "$e2e_results_file")
else
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
    "unit_tests": {
      "passed": $unit_passed,
      "failed": $unit_failed,
      "skipped": $unit_skipped,
      "total": $unit_total,
      "coverage": {
        "lines": $coverage_lines
      }
    },
    "e2e_tests": {
      "passed": $e2e_passed,
      "failed": $e2e_failed,
      "skipped": $e2e_skipped
    },
    "bundle": {
      "size": $bundle_size
    }
  }' > "$METRICS_FILE"

echo "Final metrics file created at $METRICS_FILE"

# Print a human-readable summary to the console
echo "--- TEST SUMMARY ---"
jq -r '
    "Unit Tests: \(.unit_tests.passed // 0)/\(.unit_tests.total // 0) passed, \(.unit_tests.failed // 0) failed, \(.unit_tests.skipped // 0) skipped" +
    "\nE2E Tests: \(.e2e_tests.passed // 0) passed, \(.e2e_tests.failed // 0) failed, \(.e2e_tests.skipped // 0) skipped" +
    "\nCode Coverage: \(.unit_tests.coverage.lines // 0)% (lines)" +
    "\nBundle Size: \(.bundle.size // "unknown")"
' "$METRICS_FILE"
echo "--------------------"