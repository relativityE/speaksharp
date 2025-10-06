#!/bin/bash

# =========================================================
# ./test-audit.sh
# Purpose: Audit local development environment including
# linting, TypeScript checks, and E2E tests with dynamic
# sharding based on measured runtimes.
# =========================================================

set -e

MARKDOWN_FILE="./docs/test-audit-status.md"
RUNTIME_FILE="./docs/e2e-test-runtimes.json"
MAX_SHARD_TIME=420 # 7 minutes in seconds

echo "# Test Audit Report" > $MARKDOWN_FILE
echo "Generated on $(date)" >> $MARKDOWN_FILE
echo "" >> $MARKDOWN_FILE

# -----------------------------
# Step 1: Static Analysis, Build, and Unit Tests
# -----------------------------
echo "🔍 Running Static Analysis..."
pnpm lint && pnpm typecheck

echo "🏗️ Building the application..."
pnpm build

echo "🧩 Running Unit Tests..."
pnpm test:unit:full

echo "- Static Analysis, Build, and Unit Tests: PASS" >> $MARKDOWN_FILE
echo "" >> $MARKDOWN_FILE

# -----------------------------
# Step 2: Measure Individual Test Runtimes
# -----------------------------
echo "## Measuring Individual E2E Test Runtimes" >> $MARKDOWN_FILE
echo "| Test File | Status | Runtime (s) |" >> $MARKDOWN_FILE
echo "|-----------|--------|-------------|" >> $MARKDOWN_FILE

echo "{}" > $RUNTIME_FILE

echo "Measuring individual E2E test runtimes..."
for TEST_FILE in tests/e2e/*.e2e.spec.ts; do
    # Check if the file exists to avoid errors with empty directories
    if [ ! -f "$TEST_FILE" ]; then
        continue
    fi
    echo "Running $TEST_FILE..."
    START_TIME=$(date +%s)

    # Run test with 4-minute timeout
    if timeout 240s pnpm exec playwright test "$TEST_FILE" --reporter=list; then
        STATUS="PASS"
    else
        STATUS="FAIL"
    fi

    END_TIME=$(date +%s)
    RUNTIME=$((END_TIME-START_TIME))

    # Log to markdown
    echo "| $(basename "$TEST_FILE") | $STATUS | $RUNTIME |" >> $MARKDOWN_FILE

    # Append runtime to JSON, requires jq
    if ! command -v jq &> /dev/null; then
        echo "jq could not be found, please install it to run this script." >&2
        exit 1
    fi
    jq --arg file "$TEST_FILE" --argjson time $RUNTIME '. + {($file): $time}' $RUNTIME_FILE > tmp.$$.json && mv tmp.$$.json $RUNTIME_FILE
    echo "Completed $(basename "$TEST_FILE"): $STATUS, runtime ${RUNTIME}s"
done
echo "" >> $MARKDOWN_FILE
echo "Runtimes recorded in $RUNTIME_FILE"
echo ""

# -----------------------------
# Step 3: Dynamically Create Shards
# -----------------------------
SHARDS=()
CURRENT_SHARD=()
CURRENT_SUM=0

# Load runtimes sorted by slowest to fastest to balance shards
TEST_ENTRIES=$(jq -r 'to_entries | sort_by(-.value) | .[] | "\(.key) \(.value)"' $RUNTIME_FILE)

while read -r entry; do
    TEST_FILE=$(echo "$entry" | awk '{print $1}')
    RUNTIME=$(echo "$entry" | awk '{print $2}')

    if (( CURRENT_SUM + RUNTIME > MAX_SHARD_TIME )) && [ ${#CURRENT_SHARD[@]} -gt 0 ]; then
        SHARDS+=("$(IFS=" "; echo "${CURRENT_SHARD[*]}")")
        CURRENT_SHARD=()
        CURRENT_SUM=0
    fi
    CURRENT_SHARD+=("$TEST_FILE")
    CURRENT_SUM=$((CURRENT_SUM + RUNTIME))
done <<< "$TEST_ENTRIES"

# Add the last shard if it's not empty
if [ ${#CURRENT_SHARD[@]} -gt 0 ]; then
    SHARDS+=("$(IFS=" "; echo "${CURRENT_SHARD[*]}")")
fi

echo "## E2E Test Shards (Dynamically Generated)" >> $MARKDOWN_FILE
echo "Shards generated with a max runtime of $MAX_SHARD_TIME seconds." >> $MARKDOWN_FILE
for i in "${!SHARDS[@]}"; do
    echo "- Shard $((i+1)): ${SHARDS[$i]}" >> $MARKDOWN_FILE
done
echo "" >> $MARKDOWN_FILE

# -----------------------------
# Step 4: Run Sharded E2E Tests
# -----------------------------
echo "## Sharded E2E Test Results" >> $MARKDOWN_FILE
OVERALL_STATUS="PASS"

for i in "${!SHARDS[@]}"; do
    SHARD_TESTS=${SHARDS[$i]}
    echo "Running Shard $((i+1)): $SHARD_TESTS"
    echo "### Shard $((i+1))" >> $MARKDOWN_FILE

    if pnpm exec playwright test $SHARD_TESTS --reporter=list; then
        echo "- **Result: PASS**" >> $MARKDOWN_FILE
    else
        echo "- **Result: FAIL**" >> $MARKDOWN_FILE
        OVERALL_STATUS="FAIL"
    fi
    echo "" >> $MARKDOWN_FILE
done

# -----------------------------
# Step 5: Summary
# -----------------------------
echo "## Summary" >> $MARKDOWN_FILE
echo "- Overall E2E Status: $OVERALL_STATUS" >> $MARKDOWN_FILE
echo "- Runtimes and shard details are documented above." >> $MARKDOWN_FILE

echo "Test audit complete. Results written to $MARKDOWN_FILE"

if [ "$OVERALL_STATUS" = "FAIL" ]; then
    echo "One or more E2E shards failed." >&2
    exit 1
fi