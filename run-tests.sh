#!/bin/bash
# run-tests.sh - Production-grade test orchestration script

set -euxo pipefail

# Configuration
TEST_RESULTS_DIR="test-results"
METRICS_FILE="$TEST_RESULTS_DIR/metrics.json"
COVERAGE_DIR="coverage"
LOG_FILE="$TEST_RESULTS_DIR/test-execution.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    echo -e "${YELLOW}Hint: If you suspect this is an environment instability issue, consider running ./vm-recovery.sh to reset the environment.${NC}" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

# Initialize test environment
initialize() {
    # Create directories first, so logging can work
    mkdir -p "$TEST_RESULTS_DIR" "$COVERAGE_DIR"
    touch "$LOG_FILE"

    log "Initializing test environment..."

    # Clear previous results
    rm -f "$METRICS_FILE"

    # Verify dependencies
    if ! command -v jq &> /dev/null; then
        error "jq is required for metrics processing"
        exit 1
    fi

    # Verify node modules
    if [ ! -d "node_modules" ]; then
        log "Installing dependencies..."
        pnpm install
    fi

    success "Environment initialized"
}

# Run unit tests with coverage
run_unit_tests() {
    log "Running unit tests with coverage..."

    local start_time=$(date +%s)

    # Run vitest with coverage and JSON output
    if pnpm vitest run --coverage --reporter=json --outputFile="$TEST_RESULTS_DIR/unit-results.json" --reporter=default; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))

        success "Unit tests completed in ${duration}s"

        # Extract unit test metrics
        extract_unit_metrics "$duration"
        return 0
    else
        error "Unit tests failed"
        return 1
    fi
}

# Extract unit test metrics
extract_unit_metrics() {
    local duration=$1

    if [ -f "$TEST_RESULTS_DIR/unit-results.json" ]; then
        local total_tests=$(jq -r '.numTotalTests // 0' "$TEST_RESULTS_DIR/unit-results.json")
        local passed_tests=$(jq -r '.numPassedTests // 0' "$TEST_RESULTS_DIR/unit-results.json")
        local failed_tests=$(jq -r '.numFailedTests // 0' "$TEST_RESULTS_DIR/unit-results.json")
        local skipped_tests=$(jq -r '.numPendingTests // 0' "$TEST_RESULTS_DIR/unit-results.json")

        # Coverage metrics (if available)
        local coverage_file="$COVERAGE_DIR/coverage-summary.json"
        local line_coverage="0"
        local branch_coverage="0"

        if [ -f "$coverage_file" ]; then
            line_coverage=$(jq -r '.total.lines.pct // 0' "$coverage_file")
            branch_coverage=$(jq -r '.total.branches.pct // 0' "$coverage_file")
        fi

        # Create unit test metrics
        jq -n \
            --arg duration "$duration" \
            --arg total "$total_tests" \
            --arg passed "$passed_tests" \
            --arg failed "$failed_tests" \
            --arg skipped "$skipped_tests" \
            --arg line_cov "$line_coverage" \
            --arg branch_cov "$branch_coverage" \
            '{
                "unit_tests": {
                    "duration": ($duration | tonumber),
                    "total": ($total | tonumber),
                    "passed": ($passed | tonumber),
                    "failed": ($failed | tonumber),
                    "skipped": ($skipped | tonumber),
                    "success_rate": (($passed | tonumber) / ($total | tonumber) * 100),
                    "coverage": {
                        "lines": ($line_cov | tonumber),
                        "branches": ($branch_cov | tonumber)
                    }
                }
            }' > "$TEST_RESULTS_DIR/unit-metrics.json"
    fi
}

# Run E2E tests
run_e2e_tests() {
    log "Starting E2E test environment..."

    local start_time=$(date +%s)

    # The dev server is now started automatically by Playwright's webServer config.
    # No need to start it manually here.

    # Run Playwright tests
    log "Running E2E tests..."

    # The --headless flag is now controlled by playwright.config.ts,
    # so it's not needed here. We can add --headed for local debugging.
    local playwright_cmd="pnpm playwright test"
    if [ "${HEADED:-false}" = "true" ]; then
        log "HEADED mode enabled. Running with UI."
        playwright_cmd="pnpm playwright test --headed"
    fi

    local e2e_result=0
    if $playwright_cmd; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        success "E2E tests completed in ${duration}s"

        # Extract E2E metrics
        extract_e2e_metrics "$duration"
    else
        error "E2E tests failed"
        local results_file="$TEST_RESULTS_DIR/e2e-results/results.json"
        if [ -f "$results_file" ]; then
            if jq -e '.errors | length > 0' "$results_file" > /dev/null; then
                error "Fatal errors found in Playwright report:"
                jq -r '.errors[].message' "$results_file" | while IFS= read -r line; do
                    error "  - $line"
                done
            fi
        fi
        e2e_result=1
    fi

    # No need to cleanup dev server, Playwright handles it.

    return $e2e_result
}

# Extract E2E test metrics
extract_e2e_metrics() {
    local duration=$1

    # Parse Playwright results (format varies by version)
    local results_file="$TEST_RESULTS_DIR/e2e-results/results.json"

    if [ -f "$results_file" ]; then
        local total_tests=$(jq -r '.suites[].specs | length' "$results_file" 2>/dev/null || echo "0")
        local passed_tests=$(jq -r '[.suites[].specs[].tests[] | select(.results[0].status == "passed")] | length' "$results_file" 2>/dev/null || echo "0")
        local failed_tests=$(jq -r '[.suites[].specs[].tests[] | select(.results[0].status == "failed")] | length' "$results_file" 2>/dev/null || echo "0")
        local skipped_tests=$(jq -r '[.suites[].specs[].tests[] | select(.results[0].status == "skipped")] | length' "$results_file" 2>/dev/null || echo "0")

        jq -n \
            --arg duration "$duration" \
            --arg total "$total_tests" \
            --arg passed "$passed_tests" \
            --arg failed "$failed_tests" \
            --arg skipped "$skipped_tests" \
            '{
                "e2e_tests": {
                    "duration": ($duration | tonumber),
                    "total": ($total | tonumber),
                    "passed": ($passed | tonumber),
                    "failed": ($failed | tonumber),
                    "skipped": ($skipped | tonumber),
                    "success_rate": (($passed | tonumber) / (($total | tonumber) + 0.001) * 100)
                }
            }' > "$TEST_RESULTS_DIR/e2e-metrics.json"
    else
        warning "E2E results file not found"
        jq -n '{"e2e_tests": {"duration": 0, "total": 0, "passed": 0, "failed": 0, "skipped": 0, "success_rate": 0}}' > "$TEST_RESULTS_DIR/e2e-metrics.json"
    fi
}

# Bundle analysis
analyze_bundle() {
    log "Analyzing bundle size..."

    if command -v npx &> /dev/null; then
        # Build for production
        pnpm build > "$TEST_RESULTS_DIR/build.log" 2>&1

        # Analyze bundle (if build succeeded)
        if [ $? -eq 0 ] && [ -d "dist" ]; then
            local bundle_size=$(du -sh dist | cut -f1)

            jq -n \
                --arg size "$bundle_size" \
                '{
                    "bundle": {
                        "size": $size,
                        "timestamp": (now | strftime("%Y-%m-%d %H:%M:%S"))
                    }
                }' > "$TEST_RESULTS_DIR/bundle-metrics.json"

            success "Bundle analysis completed: $bundle_size"
        else
            warning "Build failed, skipping bundle analysis"
            echo '{"bundle": {"size": "unknown", "timestamp": ""}}' > "$TEST_RESULTS_DIR/bundle-metrics.json"
        fi
    else
        warning "npm/npx not available for bundle analysis"
        echo '{"bundle": {"size": "unknown", "timestamp": ""}}' > "$TEST_RESULTS_DIR/bundle-metrics.json"
    fi
}

# Combine all metrics
combine_metrics() {
    log "Combining metrics..."

    local combined_metrics="{}"

    # Merge all metric files
    for metric_file in "$TEST_RESULTS_DIR"/*-metrics.json; do
        if [ -f "$metric_file" ]; then
            combined_metrics=$(echo "$combined_metrics" | jq -s '.[0] * .[1]' - "$metric_file")
        fi
    done

    # Add timestamp and summary
    combined_metrics=$(echo "$combined_metrics" | jq --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '. + {
        "timestamp": $timestamp,
        "summary": {
            "total_duration": ((.unit_tests.duration // 0) + (.e2e_tests.duration // 0)),
            "overall_success_rate": (((.unit_tests.passed // 0) + (.e2e_tests.passed // 0)) * 100 / ((.unit_tests.total // 0) + (.e2e_tests.total // 0) + 0.001))
        }
    }')

    echo "$combined_metrics" > "$METRICS_FILE"
    success "Metrics saved to $METRICS_FILE"
}

# Update documentation
update_documentation() {
    log "Updating PRD.md with metrics..."

    if [ -f "$METRICS_FILE" ] && [ -f "docs/PRD.md" ]; then
        # Extract key metrics
        local unit_tests_passed=$(jq -r '.unit_tests.passed // 0' "$METRICS_FILE")
        local unit_tests_total=$(jq -r '.unit_tests.total // 0' "$METRICS_FILE")
        local e2e_tests_passed=$(jq -r '.e2e_tests.passed // 0' "$METRICS_FILE")
        local e2e_tests_total=$(jq -r '.e2e_tests.total // 0' "$METRICS_FILE")
        local line_coverage=$(jq -r '.unit_tests.coverage.lines // 0' "$METRICS_FILE")
        local bundle_size=$(jq -r '.bundle.size // "unknown"' "$METRICS_FILE")

        # Create metrics section
        local metrics_section="## Software Quality Metrics (Last Updated: $(date))

| Metric | Value |
|--------|-------|
| Unit Tests | $unit_tests_passed/$unit_tests_total passed |
| E2E Tests | $e2e_tests_passed/$e2e_total passed |
| Code Coverage | ${line_coverage}% |
| Bundle Size | $bundle_size |

*Metrics updated automatically by \`run-tests.sh\`*"

        # Update or append to PRD.md
        if grep -q "Software Quality Metrics" docs/PRD.md; then
            # Replace existing section
            sed -i '/## Software Quality Metrics/,/^\*Metrics updated automatically/c\'"$metrics_section" docs/PRD.md
        else
            # Append new section
            echo -e "\n$metrics_section" >> docs/PRD.md
        fi

        success "PRD.md updated with current metrics"
    else
        warning "Could not update documentation (missing files)"
    fi
}

# Print summary
print_summary() {
    log "Test execution summary:"

    if [ -f "$METRICS_FILE" ]; then
        echo
        jq -r '
            "=== TEST RESULTS SUMMARY ===" +
            "\nUnit Tests: " + (.unit_tests.passed // 0 | tostring) + "/" + (.unit_tests.total // 0 | tostring) + " passed" +
            "\nE2E Tests: " + (.e2e_tests.passed // 0 | tostring) + "/" + (.e2e_tests.total // 0 | tostring) + " passed" +
            "\nCode Coverage: " + (.unit_tests.coverage.lines // 0 | tostring) + "%" +
            "\nTotal Duration: " + (.summary.total_duration // 0 | tostring) + "s" +
            "\nOverall Success Rate: " + (.summary.overall_success_rate // 0 | round | tostring) + "%" +
            "\n=========================="
        ' "$METRICS_FILE"
    fi
}

# Main execution
main() {
    # Initialize environment first to ensure log file directory exists
    initialize

    local start_time=$(date +%s)
    local exit_code=0

    log "Starting comprehensive test execution..."

    log "Running linter..."
    if ! pnpm lint:fix; then
        error "Linting failed"
        exit 1
    fi
    success "Linting complete"

    log "Running type check..."
    if ! pnpm type-check; then
        error "Type check failed"
        exit 1
    fi
    success "Type check complete"

    # Run unit tests
    if ! run_unit_tests; then
        exit_code=1
    fi

    # Run E2E tests
    if ! run_e2e_tests; then
        exit_code=1
    fi

    # Bundle analysis (non-blocking)
    analyze_bundle

    # Combine metrics
    combine_metrics

    # Update documentation
    update_documentation

    # Print summary
    print_summary

    local end_time=$(date +%s)
    local total_duration=$((end_time - start_time))

    if [ $exit_code -eq 0 ]; then
        success "All tests completed successfully in ${total_duration}s"
    else
        error "Some tests failed (total time: ${total_duration}s)"
    fi

    exit $exit_code
}

# Handle script termination
trap 'exit 130' INT TERM

# Run main function
main "$@"
