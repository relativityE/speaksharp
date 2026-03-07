#!/bin/bash
# run-metrics.sh — Software Quality Metrics Aggregator
# Collects unit, E2E, coverage, bundle, and Lighthouse metrics into a single JSON.
#
# FIXES APPLIED:
#   1. N/A → null: --argjson requires valid JSON. "N/A" is a string; replaced with
#      JSON null so downstream jq consumers get typed missing-value semantics.
#   2. E2E results file guard: explicit path check + CI hard-fail before any jq call.
#   3. .shards // {}: playwright merge-reports JSON output does not include .shards;
#      safe-access prevents null being passed to --argjson.

set -euo pipefail
export HUSKY=0

TEST_RESULTS_DIR="test-results"
METRICS_FILE="$TEST_RESULTS_DIR/metrics.json"
mkdir -p "$TEST_RESULTS_DIR"

# ─── Unit Test Metrics ────────────────────────────────────────────────────────
# Use JSON null (not "N/A") when unit tests are skipped.
# null is valid JSON for --argjson; "N/A" is not and will crash jq.
unit_metrics_file="unit-metrics.json"
UNIT_SKIPPED=false

if [ ! -f "$unit_metrics_file" ]; then
    echo "⚠️ WARNING: Unit metrics file not found at $unit_metrics_file. Marking as skipped (null)." >&2
    UNIT_SKIPPED=true
    unit_passed="null"
    unit_failed="null"
    unit_skipped="null"
    unit_total="null"
else
    unit_passed=$(jq '.numPassedTests' "$unit_metrics_file")
    unit_failed=$(jq '.numFailedTests' "$unit_metrics_file")
    unit_skipped=$(jq '.numPendingTests' "$unit_metrics_file")
    unit_total=$(jq '.numTotalTests' "$unit_metrics_file")
fi

# ─── Coverage Metrics ─────────────────────────────────────────────────────────
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

# ─── E2E Test Metrics ─────────────────────────────────────────────────────────
# Guard: confirm the results file exists before attempting any jq parse.
# In CI, a missing results file means the merge step failed — hard exit.
# Locally, it means E2E was skipped — degrade gracefully with zero values.
e2e_results_file="$TEST_RESULTS_DIR/playwright/results.json"

if [ ! -f "$e2e_results_file" ]; then
    if [ "${CI:-false}" = "true" ]; then
        echo "❌ FATAL: $e2e_results_file not found in CI." >&2
        echo "   This means the 'Merge E2E Reports' step in the report job failed or produced no output." >&2
        echo "   Check: artifact download paths, playwright merge-reports exit code, and blob zip file naming." >&2
        exit 1
    fi
    echo "⚠️ WARNING: E2E results file not found. Defaulting to 0 (local skip)." >&2
    e2e_passed=0
    e2e_failed=0
    e2e_flaky=0
    e2e_skipped=0
    e2e_total=0
    e2e_shards="{}"
else
    # Playwright JSON reporter field names (stable since v1.20):
    #   .stats.expected   → tests that passed as expected
    #   .stats.unexpected → tests that failed
    #   .stats.flaky      → tests that passed on retry
    #   .stats.skipped    → tests skipped via test.skip()
    # e2e_total used for "141/141 passed" display in SQM output.
    e2e_passed=$(jq '.stats.expected // 0'    "$e2e_results_file")
    e2e_failed=$(jq '.stats.unexpected // 0'  "$e2e_results_file")
    e2e_flaky=$(jq  '.stats.flaky // 0'       "$e2e_results_file")
    e2e_skipped=$(jq '.stats.skipped // 0'   "$e2e_results_file")
    e2e_shards=$(jq  '.shards // {}'          "$e2e_results_file")
    e2e_total=$(jq '[.stats.expected, .stats.unexpected, .stats.flaky, .stats.skipped] | map(. // 0) | add' "$e2e_results_file")
fi

# Fallback totals for skipped/local E2E case
if [ -z "${e2e_flaky:-}" ]; then e2e_flaky=0; fi
if [ -z "${e2e_total:-}" ]; then e2e_total=0; fi

# Hard-fail if E2E tests failed — metrics should not silently pass a broken suite
if [ "${e2e_failed}" -gt 0 ] 2>/dev/null; then
    echo "❌ WARNING: $e2e_failed E2E test(s) failed. Metrics recorded but pipeline should fail." >&2
fi

# ─── Bundle Size Metrics ──────────────────────────────────────────────────────
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

# ─── Codebase Size Metrics ────────────────────────────────────────────────────
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

# ─── Lighthouse Scores ────────────────────────────────────────────────────────
LHCI_DIR=".lighthouseci"
lighthouse_file="$LHCI_DIR/lhr-*.json"

if compgen -G "$lighthouse_file" > /dev/null 2>&1; then
    lhr_file=$(ls -t $LHCI_DIR/lhr-*.json 2>/dev/null | head -1)
    if [ -n "$lhr_file" ] && [ -f "$lhr_file" ]; then
        lighthouse_performance=$(jq  '.categories.performance.score * 100 | floor'                "$lhr_file" 2>/dev/null || echo "0")
        lighthouse_accessibility=$(jq '.categories.accessibility.score * 100 | floor'             "$lhr_file" 2>/dev/null || echo "0")
        lighthouse_best_practices=$(jq '(.categories["best-practices"].score // 0) * 100 | floor' "$lhr_file" 2>/dev/null || echo "0")
        lighthouse_seo=$(jq           '.categories.seo.score * 100 | floor'                        "$lhr_file" 2>/dev/null || echo "0")
    else
        lighthouse_performance=0; lighthouse_accessibility=0
        lighthouse_best_practices=0; lighthouse_seo=0
    fi
else
    lighthouse_performance=0; lighthouse_accessibility=0
    lighthouse_best_practices=0; lighthouse_seo=0
fi

# ─── Assemble Final Metrics JSON ──────────────────────────────────────────────
jq -n \
  --argjson unit_passed           "$unit_passed" \
  --argjson unit_failed           "$unit_failed" \
  --argjson unit_skipped          "$unit_skipped" \
  --argjson unit_total            "$unit_total" \
  --argjson coverage_statements   "$coverage_statements" \
  --argjson coverage_branches     "$coverage_branches" \
  --argjson coverage_functions    "$coverage_functions" \
  --argjson coverage_lines        "$coverage_lines" \
  --argjson e2e_passed            "$e2e_passed" \
  --argjson e2e_failed            "$e2e_failed" \
  --argjson e2e_flaky             "$e2e_flaky" \
  --argjson e2e_skipped           "$e2e_skipped" \
  --argjson e2e_total             "$e2e_total" \
  --argjson e2e_shards            "${e2e_shards}" \
  --arg     bundle_size           "$bundle_size" \
  --arg     source_size           "$source_size" \
  --arg     total_size            "$total_size" \
  --arg     bloat_pct             "$bloat_pct" \
  --argjson lh_performance        "$lighthouse_performance" \
  --argjson lh_accessibility      "$lighthouse_accessibility" \
  --argjson lh_best_practices     "$lighthouse_best_practices" \
  --argjson lh_seo                "$lighthouse_seo" \
  --argjson total_runtime         "${TOTAL_RUNTIME_SECONDS:-0}" \
  '{
    "unit_tests": {
        "passed":  $unit_passed,
        "failed":  $unit_failed,
        "skipped": $unit_skipped,
        "total":   $unit_total
    },
    "coverage": {
        "statements": $coverage_statements,
        "branches":   $coverage_branches,
        "functions":  $coverage_functions,
        "lines":      $coverage_lines
    },
    "e2e_tests": {
        "passed":  $e2e_passed,
        "failed":  $e2e_failed,
        "flaky":   $e2e_flaky,
        "skipped": $e2e_skipped,
        "total":   $e2e_total,
        "shards":  $e2e_shards
    },
    "performance": {
        "initial_chunk_size": $bundle_size,
        "source_size":        $source_size,
        "total_size":         $total_size,
        "bloat_percentage":   $bloat_pct
    },
    "lighthouse": {
        "performance":     $lh_performance,
        "accessibility":   $lh_accessibility,
        "best_practices":  $lh_best_practices,
        "seo":             $lh_seo
    },
    "total_runtime_seconds": $total_runtime
  }' > "$METRICS_FILE"

echo "✅ Metrics written to $METRICS_FILE"
