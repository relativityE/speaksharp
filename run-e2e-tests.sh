#!/bin/bash
set -euo pipefail
export HUSKY=0

TEST_RESULTS_DIR="test-results"

echo "--- Running E2E Tests ---"

mkdir -p "$TEST_RESULTS_DIR"

# Initialize a default metrics file in case of catastrophic failure
jq -n '{"e2e_tests": {"duration": 0, "total": 0, "passed": 0, "failed": 1, "skipped": 0, "success_rate": 0}}' > "$TEST_RESULTS_DIR/e2e-metrics.json"

start_time=$(date +%s)

if pnpm playwright test; then
    echo "E2E test command completed successfully."

    duration=$(( $(date +%s) - start_time ))
    # This path assumes a json reporter is configured in playwright.config.ts
    results_file="test-results.json"

    if [ ! -f "$results_file" ]; then
        echo "Warning: E2E results file '$results_file' not found."
        # If no results file, assume success but with 0 tests. This can happen if no tests are found.
        jq -n --argjson duration "$duration" '{"e2e_tests": {"duration": $duration, "total": 0, "passed": 0, "failed": 0, "skipped": 0, "success_rate": 100}}' > "$TEST_RESULTS_DIR/e2e-metrics.json"
        exit 0
    fi

    total=$(jq -r '[.suites[].specs[].tests[]] | length' "$results_file")
    passed=$(jq -r '[.suites[].specs[].tests[] | select(.results[0].status=="passed")] | length' "$results_file")
    failed=$(jq -r '[.suites[].specs[].tests[] | select(.results[0].status=="failed")] | length' "$results_file")
    skipped=$(jq -r '[.suites[].specs[].tests[] | select(.results[0].status=="skipped")] | length' "$results_file")

    jq -n \
      --argjson duration "$duration" \
      --argjson total "$total" \
      --argjson passed "$passed" \
      --argjson failed "$failed" \
      --argjson skipped "$skipped" \
      '{
        "e2e_tests": {
          "duration": $duration,
          "total": $total,
          "passed": $passed,
          "failed": $failed,
          "skipped": $skipped,
          "success_rate": (if $total > 0 then ($passed / $total * 100) else 0 end)
        }
      }' > "$TEST_RESULTS_DIR/e2e-metrics.json"

    echo "E2E test metrics extracted."
    if [ "$failed" -eq 0 ]; then
        exit 0
    else
        echo "Some E2E tests failed."
        exit 1
    fi
else
    echo "E2E test command failed to run."
    # The default metrics file will be used.
    exit 1
fi
