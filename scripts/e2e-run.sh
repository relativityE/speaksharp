#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="./logs"
mkdir -p "$LOG_DIR"
PHASE_TIMEOUT=300
SERVER_PORT=5173

log() { echo -e "\n[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_DIR/playbook.log"; }
abort() { echo "❌ $1" | tee -a "$LOG_DIR/playbook.log"; exit 1; }

# --- Environment Gate ---
if [ ! -f "$LOG_DIR/.env-setup-complete" ]; then
    abort "Environment setup is not complete. Please run ./scripts/env-setup.sh first."
fi
log "✅ Environment gate passed."

# --- Phase 1: Start Vite ---
log "=== PHASE 1: Start Vite ==="
timeout ${PHASE_TIMEOUT}s pnpm dev |& tee "$LOG_DIR/phase1.log" &
VITE_PID=$!
sleep 5
if ! curl -s http://localhost:$SERVER_PORT >/dev/null; then
    kill $VITE_PID
    abort "Vite failed to start on $SERVER_PORT"
fi
log "✅ Vite running on $SERVER_PORT"

# --- Phase 2: DOM Inspection ---
log "=== PHASE 2: DOM Inspection ==="
timeout ${PHASE_TIMEOUT}s npx dotenv -e .env.test -- node ./scripts/dump-dom.js |& tee "$LOG_DIR/phase2.log" || abort "Phase 2 failed"

# --- Phase 5: Auth E2E ---
log "=== PHASE 5: Auth E2E ==="
timeout ${PHASE_TIMEOUT}s pnpm exec playwright test tests/e2e/auth.e2e.spec.ts --reporter=list |& tee "$LOG_DIR/phase5.log" || abort "Phase 5 failed"

# --- Phase 6: CI/CD Validation ---
log "=== PHASE 6: CI/CD Validation ==="
# Placeholder for future CI validation steps.
echo "[INFO] Phase 6: CI/CD Validation placeholder." |& tee "$LOG_DIR/phase6.log"

# --- Phase 7: Visual Homepage Verification ---
log "=== PHASE 7: Visual Homepage Verification ==="
timeout ${PHASE_TIMEOUT}s npx dotenv -e .env.test -- node ./scripts/screenshot-homepage.js |& tee "$LOG_DIR/phase7.log" || abort "Phase 7 failed"

# --- Cleanup ---
log "✅ All phases completed successfully"
kill $VITE_PID
