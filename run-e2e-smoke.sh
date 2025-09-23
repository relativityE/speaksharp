#!/bin/bash
set -euo pipefail
export HUSKY=0

echo "--- Running E2E Smoke Tests ---"

# This script runs a targeted set of E2E tests defined as the 'chromium-smoke'
# project in playwright.config.ts. This provides a fast, minimal check
# to ensure the most critical user flows are working.

pnpm playwright test --project=chromium-smoke
