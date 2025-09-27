#!/bin/bash
set -euo pipefail

METRICS_FILE="test-results/metrics.json"
PRD_FILE="docs/PRD.md"
REPLACEMENT_FILE="docs/sqm_section.md"

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

# Create the new metrics section content in a temporary file
cat > "$REPLACEMENT_FILE" << EOL
## Software Quality Metrics (Last Updated: $(date))
| Metric | Value |
|--------|-------|
| Unit Tests | $unit_passed/$unit_total passed |
| E2E Tests | $e2e_passed/$e2e_total passed |
| Code Coverage | ${coverage}% (lines) |
| Bundle Size | $bundle_size |
*Metrics updated automatically by the CI pipeline.*
EOL

# Use a more portable sed command to replace the section by reading from the temp file
if grep -q "## Software Quality Metrics" "$PRD_FILE"; then
    # This command deletes the old section and reads the new content from the replacement file.
    # It is more robust than using the 'c' command with a variable.
    sed -i.bak -e "/## Software Quality Metrics/,/^\*Metrics updated automatically/ { /## Software Quality Metrics/r $REPLACEMENT_FILE" -e 'd' -e '}' "$PRD_FILE"
    rm "$PRD_FILE.bak"
else
    # If the section doesn't exist, append it.
    echo "" >> "$PRD_FILE"
    cat "$REPLACEMENT_FILE" >> "$PRD_FILE"
fi

rm "$REPLACEMENT_FILE"

log "PRD.md updated successfully with the latest metrics."