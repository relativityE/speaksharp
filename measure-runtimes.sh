#!/bin/bash

# File to store runtimes
RUNTIME_FILE="./docs/e2e-test-runtimes.json"

echo "{}" > $RUNTIME_FILE

# Check if jq is available
if ! command -v jq &> /dev/null
then
    echo "jq could not be found, please install it to run this script."
    exit 1
fi

echo "Measuring individual E2E test runtimes..."
for TEST_FILE in tests/e2e/*.e2e.spec.ts; do
    echo "Running $TEST_FILE..."
    START=$(date +%s)
    if timeout 240s pnpm exec playwright test "$TEST_FILE" --reporter=list; then
        STATUS="PASS"
    else
        STATUS="FAIL"
    fi
    END=$(date +%s)
    RUNTIME=$((END-START))
    # Append runtime to JSON
    jq --arg file "$TEST_FILE" --argjson time $RUNTIME '. + {($file): $time}' $RUNTIME_FILE > tmp.$$.json && mv tmp.$$.json $RUNTIME_FILE
    echo "$TEST_FILE: $STATUS, runtime ${RUNTIME}s"
done
echo "Runtimes recorded in $RUNTIME_FILE"