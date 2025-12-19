#!/bin/bash
set -euo pipefail
export HUSKY=0

TEST_RESULTS_DIR="test-results"
METRICS_FILE="$TEST_RESULTS_DIR/metrics.json"
mkdir -p "$TEST_RESULTS_DIR"

# Unit Test Metrics
unit_metrics_file="unit-metrics.json"
if [ ! -f "$unit_metrics_file" ]; then
    echo "❌ ERROR: Unit metrics file not found at $unit_metrics_file" >&2
    exit 1
fi
unit_passed=$(jq '.numPassedTests' "$unit_metrics_file")
unit_failed=$(jq '.numFailedTests' "$unit_metrics_file")
unit_skipped=$(jq '.numPendingTests' "$unit_metrics_file")
unit_total=$(jq '.numTotalTests' "$unit_metrics_file")

# Coverage Metrics (full breakdown)
coverage_file="frontend/coverage/coverage-summary.json"
if [ ! -f "$coverage_file" ]; then
    echo "⚠️ WARNING: Coverage summary not found at $coverage_file. Setting coverage to 0." >&2
    coverage_statements=0
    coverage_branches=0
    coverage_functions=0
    coverage_lines=0
else
    coverage_statements=$(jq '.total.statements.pct' "$coverage_file")
    coverage_branches=$(jq '.total.branches.pct' "$coverage_file")
    coverage_functions=$(jq '.total.functions.pct' "$coverage_file")
    coverage_lines=$(jq '.total.lines.pct' "$coverage_file")
fi

# E2E Test Metrics
e2e_results_file="$TEST_RESULTS_DIR/playwright/results.json"
if [ -f "$e2e_results_file" ]; then
    e2e_passed=$(jq '.stats.expected' "$e2e_results_file")
    e2e_failed=$(jq '.stats.unexpected' "$e2e_results_file")
    e2e_skipped=$(jq '.stats.skipped' "$e2e_results_file")
else
    if [ "${CI:-false}" = "true" ]; then
        echo "❌ ERROR: Running in CI but E2E results are missing!" >&2
        exit 1
    fi
    e2e_passed=0
    e2e_failed=0
    e2e_skipped=0
fi

# Bundle Size Metrics
entry_file=$(grep -o '/assets/index-[^"]*\.js' frontend/dist/index.html | head -n 1 || true)
entry_file="${entry_file#/}"
full_path="frontend/dist/$entry_file"

if [ -f "$full_path" ]; then
    bundle_size=$(du -h "$full_path" | awk '{print $1}')
    chunk_size_kb=$(du -k "$full_path" | awk '{print $1}')
else
    bundle_size="unknown"
    chunk_size_kb=0
fi

# Codebase Size Metrics
SOURCE_DIRS=("frontend/src" "backend" "docs" "scripts" "tests")
source_size_kb=$(du -sk "${SOURCE_DIRS[@]}" 2>/dev/null | awk '{sum += $1} END {print sum}')
total_size_kb=$(du -sk . | awk '{print $1}')

source_size=$(du -shc "${SOURCE_DIRS[@]}" 2>/dev/null | tail -n 1 | awk '{print $1}')
total_size=$(du -sh . | awk '{print $1}')

# Bloat Percentage
if [ "$source_size_kb" -gt 0 ]; then
    bloat_pct=$(awk "BEGIN {printf \"%.2f\", ($chunk_size_kb / $source_size_kb) * 100}")
else
    bloat_pct=0
fi

# Lighthouse Scores (extract from lhci results if available)
# lhci stores results in .lighthouseci/ at project root
LHCI_DIR=".lighthouseci"
lighthouse_file="$LHCI_DIR/lhr-*.json"
if compgen -G "$lighthouse_file" > /dev/null 2>&1; then
    # Get the most recent lhr file (sorted by timestamp in filename)
    lhr_file=$(ls -t $LHCI_DIR/lhr-*.json 2>/dev/null | head -1)
    if [ -n "$lhr_file" ] && [ -f "$lhr_file" ]; then
        lighthouse_performance=$(jq '.categories.performance.score * 100 | floor' "$lhr_file" 2>/dev/null || echo "0")
        lighthouse_accessibility=$(jq '.categories.accessibility.score * 100 | floor' "$lhr_file" 2>/dev/null || echo "0")
        lighthouse_best_practices=$(jq '(.categories["best-practices"].score // 0) * 100 | floor' "$lhr_file" 2>/dev/null || echo "0")
        lighthouse_seo=$(jq '.categories.seo.score * 100 | floor' "$lhr_file" 2>/dev/null || echo "0")
    else
        lighthouse_performance=0
        lighthouse_accessibility=0
        lighthouse_best_practices=0
        lighthouse_seo=0
    fi
else
    lighthouse_performance=0
    lighthouse_accessibility=0
    lighthouse_best_practices=0
    lighthouse_seo=0
fi

# Create the final combined metrics file
jq -n \
  --argjson unit_passed "$unit_passed" \
  --argjson unit_failed "$unit_failed" \
  --argjson unit_skipped "$unit_skipped" \
  --argjson unit_total "$unit_total" \
  --argjson coverage_statements "$coverage_statements" \
  --argjson coverage_branches "$coverage_branches" \
  --argjson coverage_functions "$coverage_functions" \
  --argjson coverage_lines "$coverage_lines" \
  --argjson e2e_passed "$e2e_passed" \
  --argjson e2e_failed "$e2e_failed" \
  --argjson e2e_skipped "$e2e_skipped" \
  --arg bundle_size "$bundle_size" \
  --arg source_size "$source_size" \
  --arg total_size "$total_size" \
  --arg bloat_pct "$bloat_pct" \
  --argjson lh_performance "$lighthouse_performance" \
  --argjson lh_accessibility "$lighthouse_accessibility" \
  --argjson lh_best_practices "$lighthouse_best_practices" \
  --argjson lh_seo "$lighthouse_seo" \
  --argjson total_runtime "${TOTAL_RUNTIME_SECONDS:-0}" \
  '{
    "unit_tests": { "passed": $unit_passed, "failed": $unit_failed, "skipped": $unit_skipped, "total": $unit_total },
    "coverage": { 
        "statements": $coverage_statements,
        "branches": $coverage_branches,
        "functions": $coverage_functions,
        "lines": $coverage_lines
    },
    "e2e_tests": { "passed": $e2e_passed, "failed": $e2e_failed, "skipped": $e2e_skipped },
    "performance": { 
        "initial_chunk_size": $bundle_size,
        "source_size": $source_size,
        "total_size": $total_size,
        "bloat_percentage": $bloat_pct
    },
    "lighthouse": {
        "performance": $lh_performance,
        "accessibility": $lh_accessibility,
        "best_practices": $lh_best_practices,
        "seo": $lh_seo
    },
    "total_runtime_seconds": $total_runtime
  }' > "$METRICS_FILE"
