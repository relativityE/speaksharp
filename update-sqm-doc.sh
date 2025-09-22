#!/bin/bash
set -euo pipefail

METRICS_FILE="test-results/metrics.json"
PRD_FILE="docs/PRD.md"

log() { echo "[SQM] $1"; }

if [ ! -f "$METRICS_FILE" ]; then
  log "Metrics file not found, skipping PRD update."
  exit 0
fi

if [ ! -f "$PRD_FILE" ]; then
  log "PRD.md not found, skipping update."
  exit 0
fi

# Extract metrics using jq
unit_passed=$(jq -r '.unit_tests.passed // 0' "$METRICS_FILE")
unit_total=$(jq -r '.unit_tests.total // 0' "$METRICS_FILE")
e2e_passed=$(jq -r '.e2e_tests.passed // 0' "$METRICS_FILE")
e2e_total=$(jq -r '.e2e_tests.total // 0' "$METRICS_FILE")
coverage=$(jq -r '.unit_tests.coverage.lines // 0' "$METRICS_FILE")
bundle_size=$(jq -r '.bundle.size // "unknown"' "$METRICS_FILE")

# Create the new metrics section content
metrics_section="## Software Quality Metrics (Last Updated: $(date))
| Metric | Value |
|--------|-------|
| Unit Tests | $unit_passed/$unit_total passed |
| E2E Tests | $e2e_passed/$e2e_total passed |
| Code Coverage | ${coverage}% (lines) |
| Bundle Size | $bundle_size |
*Metrics updated automatically by the CI pipeline.*"

# Use sed to find and replace the existing metrics section, or append if it doesn't exist
if grep -q "## Software Quality Metrics" "$PRD_FILE"; then
    # The regex here looks for the start of the section (## Software...) and the end (*Metrics updated...)
    # The 'c' command in sed then replaces that entire block.
    # Note: Using a temporary file for sed is safer on more platforms (like macOS)
    sed -i.bak '/## Software Quality Metrics/,/^\*Metrics updated automatically/c\'"$metrics_section" "$PRD_FILE"
    rm "$PRD_FILE.bak"
else
    echo -e "\n$metrics_section" >> "$PRD_FILE"
fi

log "PRD.md updated successfully with the latest metrics."
