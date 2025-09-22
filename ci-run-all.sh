#!/bin/bash
# ci-run-all.sh
# Comprehensive orchestrator for the CI/CD test pipeline.
# This script ensures all recovery, installation, testing, and documentation steps
# are run in the correct order, respecting the project's architecture.

# Exit immediately if any command fails, and print commands as they are executed.
set -euxo pipefail

# --- Logging ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "\n${BLUE}### $1 ###${NC}"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }

# --- Main Execution ---

log "Step 0: Disabling Husky pre-commit hooks for this automated run"
export HUSKY=0
success "Husky hooks disabled."

log "Step 1: Checking if VM recovery is needed"
if [ "${FORCE_VM_RECOVERY:-0}" = "1" ]; then
    echo "FORCE_VM_RECOVERY is set. Running vm-recovery.sh..."
    ./vm-recovery.sh
    success "VM recovery complete."
else
    success "Skipping VM recovery. Set FORCE_VM_RECOVERY=1 to run it."
fi

log "Step 2: Making scripts executable"
chmod +x run-*.sh update-sqm-doc.sh preinstall.sh vm-recovery.sh
success "Scripts are now executable."

log "Step 3: Ensuring Node dependencies are installed"
./preinstall.sh
success "Node dependency installation complete."

log "Step 4: Ensuring Browser dependencies are installed"
pnpm run install:browsers
success "Browser dependency installation complete."

log "Step 5: Running Quality Checks"
./run-lint.sh
./run-type-check.sh
success "Quality checks passed."

log "Step 6: Running Unit Tests"
./run-unit-tests.sh
success "Unit tests finished."

log "Step 7: Running E2E Tests"
./run-e2e-tests.sh
success "E2E tests finished."

log "Step 8: Running Build and Bundle Analysis"
./run-build.sh
success "Build and bundle analysis finished."

log "Step 9: Aggregating Metrics"
./run-metrics.sh
success "Metrics aggregated."

log "Step 10: Updating Documentation"
./update-sqm-doc.sh
success "Documentation updated."

log "CI pipeline finished successfully!"
