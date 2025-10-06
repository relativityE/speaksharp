#!/bin/bash

# Purpose: Measure individual E2E test runtimes and create baseline reports
# in both Markdown and JSON formats.

set -e

MARKDOWN_FILE="./docs/test-audit-status.md"
RUNTIME_FILE="./docs/e2e-test-runtimes.json"

# Initialize Markdown Report
echo "# Test Audit Baseline" > $MARKDOWN_FILE
echo "Generated on $(date)" >> $MARKDOWN_FILE
echo "" >> $MARKDOWN_FILE
echo "## Individual Test Results" >> $MARKDOWN_FILE

# Initialize JSON Runtime Data
echo "{}" > $RUNTIME_FILE

# Check for jq dependency
if ! command -v jq &> /dev/null; then
    echo "jq could not be found. Please install it to run this script."
    exit 1
fi

echo "Measuring individual E2E test runtimes..."
for TEST_FILE in tests/e2e/*.e2e.spec.ts; do
    echo "Running $TEST_FILE with 4-minute timeout..."
    START_TIME=$(date +%s)

    # Run test with timing and timeout, capturing status
    if time timeout 240s pnpm exec playwright test "$TEST_FILE" --reporter=list; then
        STATUS="PASS"
    else
        STATUS="FAIL"
    fi

    END_TIME=$(date +%s)
    RUNTIME=$((END_TIME - START_TIME))
    RUNTIME_MMSS=$(printf '%02d:%02d' $((RUNTIME/60)) $((RUNTIME%60)))

    # Append results to Markdown Report
    echo "- **$TEST_FILE**: $STATUS, runtime $RUNTIME_MMSS" >> $MARKDOWN_FILE

    # Append runtime to JSON data file
    jq --arg file "$TEST_FILE" --argjson time $RUNTIME '. + {($file): $time}' "$RUNTIME_FILE" > tmp.$$.json && mv tmp.$$.json "$RUNTIME_FILE"

    echo "Completed $TEST_FILE: $STATUS, runtime ${RUNTIME}s"
done

echo ""
echo "Runtimes recorded in $RUNTIME_FILE"
echo "Baseline report generated in $MARKDOWN_FILE"