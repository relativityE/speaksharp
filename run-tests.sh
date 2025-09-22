#!/bin/bash
# run-tests.sh - Run unit & E2E tests, collect metrics

set -euxo pipefail

TEST_RESULTS_DIR="test-results"

# Logging helpers
log() { echo "[LOG] $*"; }
error() { echo "[ERROR] $*"; }

# Step 1: Confirm dependencies exist
if [ ! -d "node_modules" ]; then
    error "node_modules missing. Run preinstall.sh first."
    exit 1
fi

# Step 2: Run unit tests
log "Running unit tests..."
if ! pnpm vitest run --coverage --reporter=json --outputFile="$TEST_RESULTS_DIR/unit-results.json"; then
    error "Unit tests failed. Dumping JSON..."
    cat "$TEST_RESULTS_DIR/unit-results.json" || true
    exit 1
fi

# Step 3: Run E2E tests
log "Running E2E tests..."
if ! pnpm playwright test; then
    error "E2E tests failed. Dumping JSON..."
    cat "$TEST_RESULTS_DIR/e2e-results/results.json" || true
    exit 1
fi

# Step 4: Combine metrics (optional, unchanged)
log "✅ All tests completed successfully"
