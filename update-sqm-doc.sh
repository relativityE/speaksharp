#!/bin/bash
# update-sqm-doc.sh - Update PRD.md with metrics

set -euxo pipefail

TEST_RESULTS_DIR="test-results"
METRICS_FILE="$TEST_RESULTS_DIR/metrics.json"

log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"; }
success() { echo "[SUCCESS] $1"; }
warning() { echo "[WARNING] $1"; }

[ -f "$METRICS_FILE" ] || { warning "Metrics file not found, skipping PRD update"; exit 0; }
[ -f "docs/PRD.md" ] || { warning "PRD.md not found"; exit 0; }

# Extract metrics
unit_tests_passed=$(jq -r '.unit_tests.passed // 0' "$METRICS_FILE")
unit_tests_total=$(jq -r '.unit_tests.total // 0' "$METRICS_FILE")
e2e_tests_passed=$(jq -r '.e2e_tests.passed // 0' "$METRICS_FILE")
e2e_tests_total=$(jq -r '.e2e_tests.total // 0' "$METRICS_FILE")
line_coverage=$(jq -r '.unit_tests.coverage.lines // 0' "$METRICS_FILE")
bundle_size=$(jq -r '.bundle.size // "unknown"' "$TEST_RESULTS_DIR/bundle-metrics.json")

metrics_section="## Software Quality Metrics (Last Updated: $(date))
| Metric | Value |
|--------|-------|
| Unit Tests | $unit_tests_passed/$unit_tests_total passed |
| E2E Tests | $e2e_tests_passed/$e2e_tests_total passed |
| Code Coverage | ${line_coverage}% |
| Bundle Size | $bundle_size |
*Metrics updated automatically by \`update-sqm-doc.sh\`*"

# Replace or append
if grep -q "Software Quality Metrics" docs/PRD.md; then
    sed -i '/## Software Quality Metrics/,/^\*Metrics updated automatically/c\'"$metrics_section" docs/PRD.md
else
    echo -e "\n$metrics_section" >> docs/PRD.md
fi

success "PRD.md updated with latest metrics"
