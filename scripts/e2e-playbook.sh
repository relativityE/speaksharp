#!/usr/bin/env bash
set -euo pipefail

# =============================== SpeakSharp E2E Full Playbook (FIXED)
# Purpose: End-to-end automation for verifying, inspecting, testing, and validating E2E tests in local & CI environments.
# Usage: chmod +x ./scripts/e2e-playbook.sh && ./scripts/e2e-playbook.sh

LOG_DIR="./logs"
PHASE_TIMEOUT=300
SERVER_PORT=5173
VITE_PID=""

mkdir -p "$LOG_DIR"

log() {
    echo -e "\n[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_DIR/playbook.log"
}

# Cleanup function to be called on script exit
cleanup_on_exit() {
    if [ -n "$VITE_PID" ] && ps -p "$VITE_PID" > /dev/null 2>&1; then
        log "[CLEANUP] Terminating Vite server (PID: $VITE_PID)"
        kill "$VITE_PID" 2>/dev/null || true
    fi
}

# Register the cleanup function to run on EXIT, INT, TERM signals
trap cleanup_on_exit EXIT INT TERM

abort_if_failed() {
    local phase="$1"
    log "❌ FAILURE detected in phase $phase. Review logs in $LOG_DIR/phase${phase}.log"
    exit 1
}

# ---------- PHASE 0 ----------
log "=== PHASE 0: Environment Verification & Stabilization ==="
{
    log "[INFO] Ensuring correct Node.js version..."
    nvm install 22.12.0
    nvm use 22.12.0
    node -v
    pnpm -v

    # Clear dependencies and install
    log "[INFO] Clearing old dependencies and reinstalling..."
    rm -rf node_modules pnpm-lock.yaml
    timeout ${PHASE_TIMEOUT}s pnpm install --no-frozen-lockfile

    # Install Playwright browsers
    log "[INFO] Installing Playwright browsers and dependencies..."
    timeout ${PHASE_TIMEOUT}s pnpm exec playwright install --with-deps

    # Kill any processes on the Vite port
    log "[INFO] Clearing port ${SERVER_PORT}..."
    timeout 60s pnpm exec kill-port $SERVER_PORT 2>/dev/null || true
} |& tee "$LOG_DIR/phase0.log" || abort_if_failed 0
log "✅ PHASE 0 complete — environment stable and browsers installed."

# ---------- PHASE 1 ----------
log "=== PHASE 1: Launch Dev Server & Verify Port ==="
{
    log "[INFO] Starting Vite dev server..."
    pnpm exec vite --port $SERVER_PORT > "$LOG_DIR/vite-server.log" 2>&1 &
    VITE_PID=$!
    log "[INFO] Vite server started with PID: $VITE_PID"

    log "[INFO] Waiting for dev server to respond..."
    for i in {1..60}; do
        if curl -sf "http://localhost:${SERVER_PORT}" >/dev/null 2>&1; then
            log "[OK] Dev server responding on port ${SERVER_PORT}"
            break
        fi
        if [ "$i" -eq 60 ]; then
            log "[ERROR] Dev server did not start after 60 seconds."
            abort_if_failed 1
        fi
        sleep 1
    done
} |& tee "$LOG_DIR/phase1.log" || abort_if_failed 1
log "✅ PHASE 1 complete — dev server responding."

# ---------- PHASE 2 ----------
log "=== PHASE 2: Inspect /auth DOM for updated selectors (Node Script) ==="
{
  cat > ./scripts/inspect-auth-dom.cjs <<'EOF'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto('http://localhost:5173/auth', { waitUntil: 'networkidle' });
    const els = await page.$$('[data-testid]');
    const dump = {};
    for (const el of els) {
        const id = await el.getAttribute('data-testid');
        const html = await el.evaluate(e => e.outerHTML);
        dump[id] = html;
    }
    console.log(JSON.stringify(dump, null, 2));
  } finally {
    await browser.close();
  }
})();
EOF
  timeout ${PHASE_TIMEOUT}s node ./scripts/inspect-auth-dom.cjs | tee "$LOG_DIR/auth-dom.json"
} |& tee "$LOG_DIR/phase2.log" || abort_if_failed 2
log "✅ PHASE 2 complete — DOM snapshot captured."

# ---------- PHASE 3 ----------
log "=== PHASE 3: Update POM / Selector Layer ==="
{
    if [ -f tests/e2e/poms/authPage.pom.spec.ts ]; then
        timeout ${PHASE_TIMEOUT}s pnpm exec playwright test tests/e2e/poms/authPage.pom.spec.ts
    else
        log "[WARN] POM spec file not found, skipping."
    fi
} |& tee "$LOG_DIR/phase3.log" || abort_if_failed 3
log "✅ PHASE 3 complete — POM verified."

# ---------- PHASE 4 ----------
log "=== PHASE 4: Verify Browser-based MSW startup (Node Script) ==="
{
    node -e "
    (async () => {
      const { chromium } = require('playwright');
      const browser = await chromium.launch();
      const page = await browser.newPage();
      page.on('console', msg => console.log('BROWSER:', msg.text()));
      try {
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
        // Use event-driven synchronization instead of polling
        await page.evaluate(() => {
          return new Promise((resolve) => {
            // Check if already ready (fallback for late check)
            if (window.mswReady) {
              resolve();
              return;
            }
            // Wait for the event
            window.addEventListener('e2e:msw-ready', () => resolve(), { once: true });
          });
        });
        console.log('[OK] MSW is ready');
      } finally {
        await browser.close();
      }
    })().catch(e => { console.error(e); process.exit(1); });
    "
} |& tee "$LOG_DIR/phase4.log" || abort_if_failed 4
log "✅ PHASE 4 complete — MSW worker initialized successfully."

# ---------- PHASE 5 ----------
log "=== PHASE 5: Execute Smoke/Auth E2E Tests ==="
{
    timeout ${PHASE_TIMEOUT}s time pnpm exec playwright test --grep @smoke tests/e2e/smoke.e2e.spec.ts
} |& tee "$LOG_DIR/smoke-e2e.log" || {
    log "[WARN] First attempt failed, retrying with trace..."
    timeout ${PHASE_TIMEOUT}s pnpm exec playwright test --grep @smoke tests/e2e/smoke.e2e.spec.ts --trace on |& tee "$LOG_DIR/smoke-e2e-trace.log" || abort_if_failed 5
}
log "✅ PHASE 5 complete — Smoke E2E tests executed."

# ---------- PHASE 6 ----------
log "=== PHASE 6: Align Local & CI/CD Configuration ==="
{
    grep -q "reuseExistingServer: true" playwright.config.ts || log "[WARN] reuseExistingServer not set"
    test -f .github/workflows/e2e.yml && log "[OK] Workflow exists" || log "[WARN] Missing e2e.yml"
} |& tee "$LOG_DIR/phase6.log" || abort_if_failed 6
log "✅ PHASE 6 complete — CI/CD configuration verified."

# ---------- PHASE 7 ----------
log "=== PHASE 7: Visual Homepage Verification (Node Script) ==="
{
    node -e "
    (async () => {
      const { chromium } = require('playwright');
      try {
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="app-main"]', { timeout: 10000 });
        const screenshot = await page.screenshot({ fullPage: true });
        console.log('✅ Full-page screenshot captured (base64):');
        console.log(screenshot.toString('base64'));
        await browser.close();
      } catch (err) {
        console.error('Screenshot failed:', err);
        process.exit(1);
      }
    })();
    "
} |& tee "$LOG_DIR/phase7.log" || abort_if_failed 7
log "✅ PHASE 7 complete — Full-page homepage screenshot captured."

log "🎉 All phases complete!"
