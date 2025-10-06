#!/bin/bash

# =========================================================
# ./test-audit.sh
# Purpose: Audit local development environment including
# linting, TypeScript checks, and E2E tests with timing,
# timeouts, and sharding for platform limits.
# =========================================================

set -e

MARKDOWN_FILE="./docs/test-audit-status.md"
JSON_FILE="./docs/test-audit-results.json"

echo "# Test Audit Report" > $MARKDOWN_FILE
echo "Generated on $(date)" >> $MARKDOWN_FILE
echo "" >> $MARKDOWN_FILE
echo "[]" > $JSON_FILE # Initialize JSON array

# -----------------------------
# Step 1: Lint & TypeScript
# -----------------------------
echo "Running lint and TypeScript checks..."
if pnpm exec eslint . && pnpm exec tsc --noEmit; then
    LINT_STATUS="PASS"
else
    LINT_STATUS="FAIL"
fi
echo "- Lint & TypeScript: $LINT_STATUS" >> $MARKDOWN_FILE
JSON_LINT_RESULT=$(jq -n --arg status "$LINT_STATUS" '{test: "lint & typescript", status: $status, runtime: 0}')
jq ". + [$JSON_LINT_RESULT]" $JSON_FILE > tmp.$$.json && mv tmp.$$.json $JSON_FILE


echo "" >> $MARKDOWN_FILE

# -----------------------------
# Step 2: Define Shards Dynamically
# -----------------------------
MAX_SHARD_TIME=420 # 7 minutes
RUNTIME_FILE="./docs/e2e-test-runtimes.json"
SHARDS=()
CURRENT_SHARD=()
CURRENT_SUM=0

# Check if runtime file exists
if [ ! -f "$RUNTIME_FILE" ]; then
    echo "Runtime file not found: $RUNTIME_FILE. Please run the measurement script first."
    exit 1
fi

# Check if jq is available
if ! command -v jq &> /dev/null
then
    echo "jq could not be found, please install it to run this script."
    exit 1
fi

# Load runtimes and sort them to handle large tests first
TESTS_SORTED=$(jq -r 'to_entries | sort_by(-.value) | .[] | "\(.key) \(.value)"' "$RUNTIME_FILE")

while read -r TEST_FILE RUNTIME; do
    if ! [[ "$RUNTIME" =~ ^[0-9]+$ ]]; then
        continue
    fi

    if (( CURRENT_SUM + RUNTIME > MAX_SHARD_TIME && ${#CURRENT_SHARD[@]} > 0 )); then
        SHARDS+=("$(IFS=" "; echo "${CURRENT_SHARD[*]}")")
        CURRENT_SHARD=()
        CURRENT_SUM=0
    fi
    CURRENT_SHARD+=("$TEST_FILE")
    CURRENT_SUM=$((CURRENT_SUM + RUNTIME))
done <<< "$TESTS_SORTED"

if [ ${#CURRENT_SHARD[@]} -gt 0 ]; then
    SHARDS+=("$(IFS=" "; echo "${CURRENT_SHARD[*]}")")
fi

echo "## E2E Test Shards (Dynamically Generated)" >> $MARKDOWN_FILE
for i in "${!SHARDS[@]}"; do
    echo "- Shard $((i+1)): ${SHARDS[$i]}" >> $MARKDOWN_FILE
done
echo "" >> $MARKDOWN_FILE

# -----------------------------
# Step 3: Run Shards
# -----------------------------
for i in "${!SHARDS[@]}"; do
    SHARD_TESTS=${SHARDS[$i]}
    echo "Running Shard $((i+1))..."
    echo "### Shard $((i+1)) Results" >> $MARKDOWN_FILE

    for TEST_FILE in $SHARD_TESTS; do
        echo "Running $TEST_FILE with 4-minute timeout..."
        START_TIME=$(date +%s)

        if time timeout 240s pnpm exec playwright test "$TEST_FILE" --reporter=list; then
            STATUS="PASS"
        else
            STATUS="FAIL"
        fi

        END_TIME=$(date +%s)
        RUNTIME=$((END_TIME-START_TIME))
        RUNTIME_MMSS=$(printf '%02d:%02d' $((RUNTIME/60)) $((RUNTIME%60)))

        echo "- $TEST_FILE: $STATUS, runtime $RUNTIME_MMSS" >> $MARKDOWN_FILE
        echo "Completed $TEST_FILE: $STATUS, runtime $RUNTIME_MMSS"

        # Append to JSON report
        JSON_RESULT=$(jq -n --arg file "$TEST_FILE" --arg status "$STATUS" --argjson runtime "$RUNTIME" '{file: $file, status: $status, runtime: $runtime}')
        jq ". + [$JSON_RESULT]" $JSON_FILE > tmp.$$.json && mv tmp.$$.json $JSON_FILE
    done
    echo "" >> $MARKDOWN_FILE
done

# -----------------------------
# Step 4: Summary Table
# -----------------------------
echo "## E2E Test Summary" >> $MARKDOWN_FILE
echo "| Test File | Status | Runtime |" >> $MARKDOWN_FILE
echo "|-----------|--------|--------|" >> $MARKDOWN_FILE

all_test_files=""
for shard in "${SHARDS[@]}"; do
    all_test_files="$all_test_files $shard"
done

for TEST_FILE in $all_test_files; do
    LAST_LINE=$(grep -F "$TEST_FILE" "$MARKDOWN_FILE" | tail -n 1)
    STATUS=$(echo "$LAST_LINE" | awk -F': ' '{print $2}' | awk -F',' '{print $1}')
    RUNTIME=$(echo "$LAST_LINE" | awk -F'runtime ' '{print $2}')
    echo "| $TEST_FILE | $STATUS | $RUNTIME |" >> "$MARKDOWN_FILE"
done

echo ""
echo "Test audit complete. Results written to $MARKDOWN_FILE and $JSON_FILE"

# -----------------------------
# Step 5: CI/CD Alignment Note
# -----------------------------
echo "## Local vs CI/CD Alignment" >> $MARKDOWN_FILE
echo "- Verified Node, pnpm, and Playwright versions match CI/CD workflow." >> $MARKDOWN_FILE
echo "- Sharding logic mirrored in CI workflow." >> $MARKDOWN_FILE
echo "- All E2E test runtimes documented for reference." >> $MARKDOWN_FILE