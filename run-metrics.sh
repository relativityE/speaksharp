#!/bin/bash
set -euo pipefail
export HUSKY=0

TEST_RESULTS_DIR="test-results"
METRICS_FILE="$TEST_RESULTS_DIR/metrics.json"

echo "--- Combining Metrics and Generating Summary ---"

# Create dummy files if they don't exist to prevent jq from failing
[ -f "$TEST_RESULTS_DIR/unit-metrics.json" ] || echo '{"unit_tests":{}}' > "$TEST_RESULTS_DIR/unit-metrics.json"
[ -f "$TEST_RESULTS_DIR/e2e-metrics.json" ] || echo '{"e2e_tests":{}}' > "$TEST_RESULTS_DIR/e2e-metrics.json"
[ -f "$TEST_RESULTS_DIR/bundle-metrics.json" ] || echo '{"bundle":{}}' > "$TEST_RESULTS_DIR/bundle-metrics.json"

# Combine the three metrics files
combined_json=$(jq -s '.[0] * .[1]' "$TEST_RESULTS_DIR/unit-metrics.json" "$TEST_RESULTS_DIR/e2e-metrics.json" | jq -s '.[0] * .[1]' - "$TEST_RESULTS_DIR/bundle-metrics.json")

# Calculate summary fields
total_duration=$(echo "$combined_json" | jq '(.unit_tests.duration // 0) + (.e2e_tests.duration // 0)')
combined_json=$(echo "$combined_json" | jq --argjson duration "$total_duration" --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '. + {timestamp: $timestamp, summary: {total_duration: $duration}}')

# Write the final combined metrics file
echo "$combined_json" > "$METRICS_FILE"
echo "Final metrics file created at $METRICS_FILE"

# Print a human-readable summary to the console
echo "--- TEST SUMMARY ---"
jq -r '
    "Unit Tests: \(.unit_tests.passed // 0)/\(.unit_tests.total // 0) passed (\(.unit_tests.duration // 0)s)" +
    "\nE2E Tests: \(.e2e_tests.passed // 0)/\(.e2e_tests.total // 0) passed (\(.e2e_tests.duration // 0)s)" +
    "\nCode Coverage: \(.unit_tests.coverage.lines // 0)% (lines)" +
    "\nBundle Size: \(.bundle.size // "unknown")" +
    "\nTotal Duration: \(.summary.total_duration // 0)s"
' "$METRICS_FILE"
echo "--------------------"
