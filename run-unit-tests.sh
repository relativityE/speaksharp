#!/bin/bash
set -euo pipefail
export HUSKY=0

TEST_RESULTS_DIR="test-results"
COVERAGE_DIR="coverage"

echo "--- Running Unit Tests ---"

mkdir -p "$TEST_RESULTS_DIR" "$COVERAGE_DIR"

# Initialize a default metrics file in case the test runner fails catastrophically
jq -n '{"unit_tests": {"duration": 0, "total": 0, "passed": 0, "failed": 1, "skipped": 0, "success_rate": 0, "coverage": {"lines": 0, "branches": 0}}}' > "$TEST_RESULTS_DIR/unit-metrics.json"

start_time=$(date +%s)

if NODE_OPTIONS=--max-old-space-size=4096 pnpm vitest run --reporter=json --outputFile="$TEST_RESULTS_DIR/unit-results.json" --reporter=default; then
    echo "Unit test command completed successfully."

    duration=$(( $(date +%s) - start_time ))
    result_file="$TEST_RESULTS_DIR/unit-results.json"
    coverage_file="$COVERAGE_DIR/coverage-summary.json"

    if [ ! -f "$result_file" ]; then
        echo "Error: Unit test result file not found even after successful run."
        exit 1
    fi

    total=$(jq -r '.numTotalTests // 0' "$result_file")
    passed=$(jq -r '.numPassedTests // 0' "$result_file")
    failed=$(jq -r '.numFailedTests // 0' "$result_file")
    skipped=$(jq -r '.numPendingTests // 0' "$result_file")
    lines=$(jq -r '.total.lines.pct // 0' "$coverage_file" 2>/dev/null || echo "0")
    branches=$(jq -r '.total.branches.pct // 0' "$coverage_file" 2>/dev/null || echo "0")

    jq -n \
      --argjson duration "$duration" \
      --argjson total "$total" \
      --argjson passed "$passed" \
      --argjson failed "$failed" \
      --argjson skipped "$skipped" \
      --argjson lines "$lines" \
      --argjson branches "$branches" \
      '{
        "unit_tests": {
          "duration": $duration,
          "total": $total,
          "passed": $passed,
          "failed": $failed,
          "skipped": $skipped,
          "success_rate": (if $total > 0 then ($passed / $total * 100) else 0 end),
          "coverage": {"lines": $lines, "branches": $branches}
        }
      }' > "$TEST_RESULTS_DIR/unit-metrics.json"

    echo "Unit test metrics extracted."
    # Exit with success only if tests actually passed
    if [ "$failed" -eq 0 ]; then
        exit 0
    else
        echo "Some unit tests failed."
        exit 1
    fi
else
    echo "Unit test command failed to run."
    # The default metrics file created at the start will be used
    exit 1
fi
