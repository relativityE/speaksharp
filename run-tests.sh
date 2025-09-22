#!/bin/bash
# run-tests.sh - Run linting, type checks, unit & E2E tests, bundle analysis, collect metrics

set -euxo pipefail

# Configuration
TEST_RESULTS_DIR="test-results"
METRICS_FILE="$TEST_RESULTS_DIR/metrics.json"
COVERAGE_DIR="coverage"
LOG_FILE="$TEST_RESULTS_DIR/test-execution.log"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log()      { echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"; }
error()    { echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"; }
success()  { echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"; }
warning()  { echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"; }

# Initialize test environment
initialize() {
    mkdir -p "$TEST_RESULTS_DIR" "$COVERAGE_DIR"
    touch "$LOG_FILE"
    log "Initializing test environment..."
    rm -f "$METRICS_FILE"

    command -v jq >/dev/null 2>&1 || { error "jq required"; exit 1; }

    if [ ! -d "node_modules" ]; then
        log "Installing dependencies..."
        pnpm install
    fi

    success "Environment initialized"
}

# Run unit tests
run_unit_tests() {
    log "Running unit tests..."
    local start_time=$(date +%s)
    if pnpm vitest run --coverage --reporter=json --outputFile="$TEST_RESULTS_DIR/unit-results.json" --reporter=default; then
        local duration=$(( $(date +%s) - start_time ))
        success "Unit tests completed in ${duration}s"
        extract_unit_metrics "$duration"
        return 0
    else
        error "Unit tests failed"
        return 1
    fi
}

extract_unit_metrics() {
    local duration=$1
    local result_file="$TEST_RESULTS_DIR/unit-results.json"
    [ ! -f "$result_file" ] && return

    local total=$(jq -r '.numTotalTests // 0' "$result_file")
    local passed=$(jq -r '.numPassedTests // 0' "$result_file")
    local failed=$(jq -r '.numFailedTests // 0' "$result_file")
    local skipped=$(jq -r '.numPendingTests // 0' "$result_file")
    local coverage_file="$COVERAGE_DIR/coverage-summary.json"
    local lines=$(jq -r '.total.lines.pct // 0' "$coverage_file" 2>/dev/null || echo "0")
    local branches=$(jq -r '.total.branches.pct // 0' "$coverage_file" 2>/dev/null || echo "0")

    jq -n \
        --arg duration "$duration" \
        --arg total "$total" --arg passed "$passed" --arg failed "$failed" --arg skipped "$skipped" \
        --arg lines "$lines" --arg branches "$branches" \
        '{
            "unit_tests": {
                "duration": ($duration|tonumber),
                "total": ($total|tonumber),
                "passed": ($passed|tonumber),
                "failed": ($failed|tonumber),
                "skipped": ($skipped|tonumber),
                "success_rate": (($passed|tonumber)/($total|tonumber)*100),
                "coverage": {"lines": ($lines|tonumber),"branches": ($branches|tonumber)}
            }
        }' > "$TEST_RESULTS_DIR/unit-metrics.json"
}

# Run E2E tests
run_e2e_tests() {
    log "Running E2E tests..."
    local start_time=$(date +%s)
    local cmd="pnpm playwright test"
    [ "${HEADED:-false}" = "true" ] && cmd="$cmd --headed"

    if $cmd; then
        local duration=$(( $(date +%s) - start_time ))
        success "E2E tests completed in ${duration}s"
        extract_e2e_metrics "$duration"
        return 0
    else
        error "E2E tests failed"
        extract_e2e_metrics 0
        return 1
    fi
}

extract_e2e_metrics() {
    local duration=$1
    local results_file="$TEST_RESULTS_DIR/e2e-results/results.json"

    if [ -f "$results_file" ]; then
        local total=$(jq -r '[.suites[].specs[].tests[]] | length' "$results_file" 2>/dev/null || echo "0")
        local passed=$(jq -r '[.suites[].specs[].tests[] | select(.results[0].status=="passed")] | length' "$results_file" 2>/dev/null || echo "0")
        local failed=$(jq -r '[.suites[].specs[].tests[] | select(.results[0].status=="failed")] | length' "$results_file" 2>/dev/null || echo "0")
        local skipped=$(jq -r '[.suites[].specs[].tests[] | select(.results[0].status=="skipped")] | length' "$results_file" 2>/dev/null || echo "0")
    else
        total=0; passed=0; failed=0; skipped=0
    fi

    jq -n \
        --arg duration "$duration" \
        --arg total "$total" --arg passed "$passed" --arg failed "$failed" --arg skipped "$skipped" \
        '{
            "e2e_tests": {
                "duration": ($duration|tonumber),
                "total": ($total|tonumber),
                "passed": ($passed|tonumber),
                "failed": ($failed|tonumber),
                "skipped": ($skipped|tonumber),
                "success_rate": (($passed|tonumber)/(($total|tonumber)+0.001)*100)
            }
        }' > "$TEST_RESULTS_DIR/e2e-metrics.json"
}

# Bundle analysis
analyze_bundle() {
    log "Analyzing bundle..."
    pnpm build > "$TEST_RESULTS_DIR/build.log" 2>&1 || { warning "Build failed"; echo '{"bundle":{"size":"unknown"}}' > "$TEST_RESULTS_DIR/bundle-metrics.json"; return; }
    local size=$(du -sh dist | cut -f1)
    jq -n --arg size "$size" '{bundle:{size:$size,timestamp:(now|strftime("%Y-%m-%d %H:%M:%S"))}}' > "$TEST_RESULTS_DIR/bundle-metrics.json"
    success "Bundle size: $size"
}

# Combine metrics
combine_metrics() {
    log "Combining metrics..."
    local combined="{}"
    for f in "$TEST_RESULTS_DIR"/*-metrics.json; do
        [ -f "$f" ] && combined=$(echo "$combined" | jq -s '.[0] * .[1]' - "$f")
    done
    combined=$(echo "$combined" | jq --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '. + {timestamp:$timestamp, summary:{total_duration:((.unit_tests.duration//0)+(.e2e_tests.duration//0)), overall_success_rate:((.unit_tests.passed//0 + .e2e_tests.passed//0)*100 / ((.unit_tests.total//0 + .e2e_tests.total//0)+0.001))}}')
    echo "$combined" > "$METRICS_FILE"
    success "Metrics saved to $METRICS_FILE"
}

# Print summary
print_summary() {
    log "Test summary:"
    [ -f "$METRICS_FILE" ] || return
    jq -r '
        "=== TEST RESULTS SUMMARY ===" +
        "\nUnit Tests: " + (.unit_tests.passed // 0|tostring) + "/" + (.unit_tests.total //0|tostring) + " passed" +
        "\nE2E Tests: " + (.e2e_tests.passed // 0|tostring) + "/" + (.e2e_tests.total //0|tostring) + " passed" +
        "\nCode Coverage: " + (.unit_tests.coverage.lines //0|tostring) + "%" +
        "\nTotal Duration: " + (.summary.total_duration //0|tostring) + "s" +
        "\nOverall Success Rate: " + (.summary.overall_success_rate //0|round|tostring) + "%" +
        "\n=========================="
    ' "$METRICS_FILE"
}

# Main execution
main() {
    initialize
    local exit_code=0

    log "Starting tests..."
    pnpm lint:fix || { error "Lint failed"; exit 1; }
    pnpm type-check || { error "Type check failed"; exit 1; }

    run_unit_tests || exit_code=1
    run_e2e_tests || exit_code=1
    analyze_bundle
    combine_metrics
    print_summary

    [ $exit_code -eq 0 ] && success "All tests completed successfully" || error "Some tests failed"
    exit $exit_code
}

trap 'exit 130' INT TERM
main "$@"
