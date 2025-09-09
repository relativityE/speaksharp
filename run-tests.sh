#!/bin/bash

# A script to run all tests and generate a Software Quality Metrics report.
# This script relies on `jq` for parsing JSON. Please ensure it is installed.

# Exit immediately if a command exits with a non-zero status.
set -e

echo "==============================================="
echo "🔹 Comprehensive Test Suite Runner"
echo "==============================================="

# --- Configuration ---
TARGET_FILE="docs/ARCHITECTURE.md"
UNIT_JSON_REPORT="unit-results.json"
E2E_JSON_REPORT="e2e-results.json"
COVERAGE_JSON_SUMMARY="coverage/coverage-summary.json"

# --- Pre-flight Check ---
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed. Please install it to continue."
    echo "On macOS: brew install jq"
    echo "On Debian/Ubuntu: sudo apt-get install jq"
    exit 1
fi

# --- Test Execution ---
echo "Running all tests and generating reports..."

# Run unit tests and generate a JSON report for counts
echo "Running unit tests for pass/fail counts..."
pnpm test:unit --reporter=json --outputFile=${UNIT_JSON_REPORT} > /dev/null 2>&1

# Run coverage and generate a JSON summary for coverage percentage
echo "Running unit tests for coverage percentage..."
pnpm test:coverage > /dev/null 2>&1

# Run E2E tests (script in package.json already directs output to e2e-results.json)
echo "Running E2E tests..."
pnpm test:e2e > /dev/null 2>&1

echo "All tests completed."

# --- Metrics Parsing (Robust) ---
echo "Parsing test metrics from JSON reports..."

# Unit Test Metrics
UNIT_PASSED=$(jq '.numPassedTests' ${UNIT_JSON_REPORT})
UNIT_FAILED=$(jq '.numFailedTests' ${UNIT_JSON_REPORT})
UNIT_SKIPPED=$(jq '.numPendingTests' ${UNIT_JSON_REPORT})
UNIT_TOTAL=$(jq '.numTotalTests' ${UNIT_JSON_REPORT})

# E2E Test Metrics
E2E_PASSED=$(jq '.stats.passed' ${E2E_JSON_REPORT})
E2E_FAILED=$(jq '.stats.failed' ${E2E_JSON_REPORT})
E2E_SKIPPED=$(jq '.stats.skipped' ${E2E_JSON_REPORT})
E2E_TOTAL=$(jq '.stats.total' ${E2E_JSON_REPORT})

# Overall Metrics
TOTAL_TESTS=$((UNIT_TOTAL + E2E_TOTAL))
PASSING_TESTS=$((UNIT_PASSED + E2E_PASSED))
FAILING_TESTS=$((UNIT_FAILED + E2E_FAILED))
DISABLED_TESTS=$((UNIT_SKIPPED + E2E_SKIPPED))

# Coverage Metrics
COVERAGE_STMTS=$(jq '.total.statements.pct' ${COVERAGE_JSON_SUMMARY})
COVERAGE_BRANCHES=$(jq '.total.branches.pct' ${COVERAGE_JSON_SUMMARY})
COVERAGE_FUNCS=$(jq '.total.functions.pct' ${COVERAGE_JSON_SUMMARY})
COVERAGE_LINES=$(jq '.total.lines.pct' ${COVERAGE_JSON_SUMMARY})

# --- SQM File Generation ---
echo "Updating Software Quality Metrics in ${TARGET_FILE}..."

# Create a temporary file to build the new report
TMP_FILE=$(mktemp)

# Use a single, chained sed command to perform all replacements and write to the temp file
# This is more efficient and portable than multiple `sed -i` calls.
# Note: The backslash before the pipe `|` is important for sed to treat it literally.
sed -e "s/Last Updated: .*/Last Updated: $(date)/" \
    -e "s/\| Total tests             \| N\/A/\| Total tests             \| ${TOTAL_TESTS}/" \
    -e "s/\| Unit tests              \| N\/A/\| Unit tests              \| ${UNIT_TOTAL}/" \
    -e "s/\| E2E tests (Playwright)  \| N\/A/\| E2E tests (Playwright)  \| ${E2E_TOTAL}/" \
    -e "s/\| Passing tests           \| N\/A/\| Passing tests           \| ${PASSING_TESTS}/" \
    -e "s/\| Failing tests           | N\/A/\| Failing tests           | ${FAILING_TESTS}/" \
    -e "s/\| Disabled\/skipped tests  \| N\/A/\| Disabled\/skipped tests  \| ${DISABLED_TESTS}/" \
    -e "s/\| Unit tests passing      \| N\/A/\| Unit tests passing      \| ${UNIT_PASSED}/" \
    -e "s/\| E2E tests failing       \| N\/A/| E2E tests failing       | ${E2E_FAILED}/" \
    -e "s/\| Statements \| N\/A/\| Statements \| ${COVERAGE_STMTS}%/" \
    -e "s/\| Branches   \| N\/A/\| Branches   \| ${COVERAGE_BRANCHES}%/" \
    -e "s/| Functions  | N\/A/| Functions  | ${COVERAGE_FUNCS}%/" \
    -e "s/| Lines      | N\/A/| Lines      | ${COVERAGE_LINES}%/" \
    "${TARGET_FILE}" > "${TMP_FILE}"

# Overwrite the original file with the updated temp file
mv "$TMP_FILE" "$TARGET_FILE"

echo "✅ Metrics updated successfully!"

# --- Final Summary ---
print_summary() {
    printf "\n"
    printf "================================================\n"
    printf "✅ SpeakSharp Quality Gate: PASSED\n"
    printf "================================================\n"
    printf "📊 TEST RESULTS\n"
    printf "------------------------------------------------\n"
    printf "| Suite      | Passed | Failed | Skipped | Total |\n"
    printf "|------------|--------|--------|---------|-------|\n"
    printf "| Unit Tests | %-6s | %-6s | %-7s | %-5s |\n" "$UNIT_PASSED" "$UNIT_FAILED" "$UNIT_SKIPPED" "$UNIT_TOTAL"
    printf "| E2E Tests  | %-6s | %-6s | %-7s | %-5s |\n" "$E2E_PASSED" "$E2E_FAILED" "$E2E_SKIPPED" "$E2E_TOTAL"
    printf "------------------------------------------------\n"
    printf "📈 COVERAGE\n"
    printf "------------------------------------------------\n"
    printf "| Statements: %s%% | Branches: %s%% | Functions: %s%% | Lines: %s%% |\n" "$COVERAGE_STMTS" "$COVERAGE_BRANCHES" "$COVERAGE_FUNCS" "$COVERAGE_LINES"
    printf "================================================\n"
}

# --- Final Check ---
if [ "${UNIT_FAILED}" -gt 0 ] || [ "${E2E_FAILED}" -gt 0 ]; then
    # Modify the summary for failure
    print_summary | sed 's/✅ SpeakSharp Quality Gate: PASSED/❌ SpeakSharp Quality Gate: FAILED/'
    echo "\nError: One or more tests failed. Please review the output."
    exit 1
else
    print_summary
    echo "\nAll tests passed successfully!"
fi
  echo "Error: One or more tests failed. Please review the output."
  exit 1
fi

echo "All tests passed successfully!"
