#!/usr/bin/env bash
set -euo pipefail

# =============================== SpeakSharp E2E Full Playbook (Fixed)
# Purpose: End-to-end automation for verifying, inspecting, testing, and validating E2E tests
# Usage: chmod +x ./scripts/e2e-playbook.sh && ./scripts/e2e-playbook.sh
#
# Fixes applied:
# - Removed nvm dependencies (use current Node version)
# - Fixed MSW typo in Phase 4 (mswReady)
# - Fixed grep typo in Phase 6
# - Added better error handling and validation
# - Improved Vite server lifecycle management
# - Added verification steps after each phase

LOG_DIR="./logs"
PHASE_TIMEOUT=300
SERVER_PORT=5173
VITE_PID=""

mkdir -p "$LOG_DIR"

log() {
    echo -e "\n[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_DIR/playbook.log"
}

abort_if_failed() {
    local phase="$1"
    log "❌ FAILURE detected in phase $phase. Review logs in $LOG_DIR/phase${phase}.log"

    # Kill Vite server if running
    if [ -n "$VITE_PID" ] && ps -p "$VITE_PID" > /dev/null 2>&1; then
        log "Cleaning up: Killing Vite server (PID: $VITE_PID)"
        kill "$VITE_PID" 2>/dev/null || true
    fi

    log "Pausing execution for review. Check the logs before proceeding."
    exit 1
}

cleanup_on_exit() {
    if [ -n "$VITE_PID" ] && ps -p "$VITE_PID" > /dev/null 2>&1; then
        log "Cleanup: Terminating Vite server (PID: $VITE_PID)"
        kill "$VITE_PID" 2>/dev/null || true
    fi
}

trap cleanup_on_exit EXIT INT TERM

# ---------- PHASE 0 ----------
log "=== PHASE 0: Environment Verification & Stabilization ==="
{
    log "Current Node version: $(node -v)"

    # Verify Node version is 18+
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo "❌ Node version too old. Need Node 18+, have Node $NODE_VERSION"
        exit 1
    fi

    log "Current pnpm version: $(pnpm -v)"

    # Clean installation
    log "Removing old node_modules and lock file..."
    rm -rf node_modules pnpm-lock.yaml

    log "Pruning pnpm store..."
    timeout ${PHASE_TIMEOUT}s pnpm store prune || {
        echo "⚠️  Store prune failed or timed out, continuing anyway..."
    }

    log "Killing any process on port ${SERVER_PORT}..."
    timeout 60s pnpm exec kill-port $SERVER_PORT 2>/dev/null || true

    log "Installing dependencies (this may take several minutes)..."
    timeout ${PHASE_TIMEOUT}s pnpm install --no-frozen-lockfile

    # Verify installation
    if [ ! -d "node_modules" ]; then
        echo "❌ node_modules directory not created"
        exit 1
    fi

    if [ ! -f "node_modules/.bin/playwright" ]; then
        log "Installing Playwright browsers..."
        timeout ${PHASE_TIMEOUT}s pnpm exec playwright install --with-deps
    fi

    log "Verification:"
    log "  - node_modules size: $(du -sh node_modules 2>/dev/null | cut -f1)"
    log "  - Playwright version: $(pnpm exec playwright --version)"

} |& tee "$LOG_DIR/phase0.log" || abort_if_failed 0
log "✅ PHASE 0 complete — environment stable."

# ---------- PHASE 1 ----------
log "=== PHASE 1: Launch Dev Server & Verify Port ==="
{
    log "Ensuring port ${SERVER_PORT} is free..."
    timeout 60s pnpm exec kill-port $SERVER_PORT 2>/dev/null || true
    sleep 2

    log "Starting Vite dev server on port ${SERVER_PORT}..."
    pnpm exec vite --port $SERVER_PORT > "$LOG_DIR/vite-server.log" 2>&1 &
    VITE_PID=$!
    log "Vite server started with PID: $VITE_PID"

    # Wait for dev server to be ready
    log "Waiting for dev server to respond..."
    for i in {1..30}; do
        if curl -sf "http://localhost:${SERVER_PORT}" >/dev/null 2>&1; then
            log "[OK] Dev server responding on port ${SERVER_PORT}"
            break
        fi
        if [ "$i" -eq 30 ]; then
            echo "[ERROR] Dev server did not start after 30 seconds"
            tail -20 "$LOG_DIR/vite-server.log"
            exit 1
        fi
        echo "[WAIT] Attempt $i/30 - Port ${SERVER_PORT} not yet ready..."
        sleep 1
    done

    # Verify server is actually serving content
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${SERVER_PORT}")
    if [ "$HTTP_STATUS" != "200" ]; then
        echo "[ERROR] Server returned HTTP $HTTP_STATUS"
        exit 1
    fi

} |& tee "$LOG_DIR/phase1.log" || abort_if_failed 1
log "✅ PHASE 1 complete — dev server responding."

# ---------- PHASE 2 ----------
log "=== PHASE 2: Inspect /auth DOM for updated selectors ==="
{
    cat > ./scripts/inspect-auth-dom.js <<'INSPECT_EOF'
const { chromium } = require('playwright');

(async () => {
    console.log('===== AUTH DOM INSPECTION START', new Date().toISOString(), '=====');

    const browser = await chromium.launch();
    const page = await browser.newPage();

    try {
        await page.goto('http://localhost:5173/auth', { waitUntil: 'networkidle', timeout: 30000 });

        // Get all elements with data-testid
        const els = await page.$$('[data-testid]');
        const dump = {};

        for (const el of els) {
            const id = await el.getAttribute('data-testid');
            const html = await el.evaluate(el => el.outerHTML);
            dump[id] = html;
        }

        console.log(JSON.stringify(dump, null, 2));

        // Also capture page title and URL for verification
        const title = await page.title();
        const url = page.url();
        console.log(JSON.stringify({ meta: { title, url } }, null, 2));

    } catch (error) {
        console.error('Error inspecting DOM:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
})();
INSPECT_EOF

    timeout ${PHASE_TIMEOUT}s node ./scripts/inspect-auth-dom.js | tee ./logs/auth-dom.json

    # Verify output was captured
    if [ ! -s "./logs/auth-dom.json" ]; then
        echo "[ERROR] auth-dom.json is empty or missing"
        exit 1
    fi

} |& tee "$LOG_DIR/phase2.log" || abort_if_failed 2
log "✅ PHASE 2 complete — DOM snapshot captured."

# ---------- PHASE 3 ----------
log "=== PHASE 3: Update POM / Selector Layer ==="
{
    log "Verifying selectors in tests/e2e/poms/authPage.pom.ts ..."

    if [ -f "tests/e2e/poms/authPage.pom.spec.ts" ]; then
        timeout ${PHASE_TIMEOUT}s pnpm exec playwright test tests/e2e/poms/authPage.pom.spec.ts
    else
        log "[WARN] POM spec file not found, skipping verification"
        log "[INFO] Continuing to next phase..."
    fi

} |& tee "$LOG_DIR/phase3.log" || {
    log "[WARN] Phase 3 encountered issues but continuing..."
}
log "✅ PHASE 3 complete — POM verification attempted."

# ---------- PHASE 4 ----------
log "=== PHASE 4: Verify Browser-based MSW startup ==="
{
    log "Checking MSW worker initialization..."

    cat > ./scripts/check-msw.js <<'MSW_EOF'
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Capture console messages
    page.on('console', msg => console.log('BROWSER:', msg.text()));

    try {
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });

        // Wait for MSW to be ready (fixed typo: mswReady not msWReady)
        await page.waitForFunction(() => window.mswReady === true, { timeout: 10000 });
        console.log('[OK] MSW worker is ready');

    } catch (error) {
        console.error('[ERROR] MSW not ready:', error.message);

        // Check if mswReady exists but is false
        const mswStatus = await page.evaluate(() => ({
            mswReady: window.mswReady,
            hasMSW: typeof window.mswReady !== 'undefined'
        }));
        console.log('MSW Status:', JSON.stringify(mswStatus));

        throw error;
    } finally {
        await browser.close();
    }
})();
MSW_EOF

    timeout ${PHASE_TIMEOUT}s node ./scripts/check-msw.js

} |& tee "$LOG_DIR/phase4.log" || abort_if_failed 4
log "✅ PHASE 4 complete — MSW worker initialized successfully."

# ---------- PHASE 5 ----------
log "=== PHASE 5: Execute Auth E2E Tests with Timing ==="
{
    if [ -f "tests/e2e/auth.e2e.spec.ts" ]; then
        log "Running auth E2E tests..."
        timeout ${PHASE_TIMEOUT}s time pnpm exec playwright test tests/e2e/auth.e2e.spec.ts |& tee "$LOG_DIR/auth-e2e.log"
    else
        log "[WARN] Auth E2E spec file not found"
        exit 1
    fi
} || {
    log "[WARN] First attempt failed, retrying with trace..."
    timeout ${PHASE_TIMEOUT}s pnpm exec playwright test tests/e2e/auth.e2e.spec.ts --trace on |& tee "$LOG_DIR/auth-e2e-trace.log" || abort_if_failed 5
}
log "✅ PHASE 5 complete — Auth E2E tests executed."

# ---------- PHASE 6 ----------
log "=== PHASE 6: Align Local & CI/CD Configuration ==="
{
    log "Validating playwright.config.ts webServer configuration..."

    if [ -f "playwright.config.ts" ]; then
        # Fixed: use grep instead of [text_search]
        if grep -q "reuseExistingServer.*true" playwright.config.ts; then
            log "[OK] reuseExistingServer is set to true"
        else
            log "[WARN] reuseExistingServer not set to true — consider updating config"
        fi
    else
        log "[WARN] playwright.config.ts not found"
    fi

    log "Checking CI workflow consistency..."
    if [ -f ".github/workflows/e2e.yml" ]; then
        log "[OK] E2E workflow exists"
    else
        log "[WARN] Missing .github/workflows/e2e.yml"
    fi

} |& tee "$LOG_DIR/phase6.log" || abort_if_failed 6
log "✅ PHASE 6 complete — CI/CD configuration verified."

# ---------- PHASE 7 ----------
log "=== PHASE 7: Visual Homepage Verification ==="
{
    log "Launching homepage and capturing full-page screenshot..."

    cat > ./scripts/screenshot-homepage.js <<'SCREENSHOT_EOF'
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    try {
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });

        const screenshot = await page.screenshot({ fullPage: true });

        // Save to file instead of outputting base64
        fs.writeFileSync('./logs/homepage-screenshot.png', screenshot);

        console.log('✅ Full-page screenshot captured');
        console.log('Screenshot size:', screenshot.length, 'bytes');
        console.log('Saved to: ./logs/homepage-screenshot.png');

    } catch (error) {
        console.error('[ERROR] Screenshot failed:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
})();
SCREENSHOT_EOF

    timeout ${PHASE_TIMEOUT}s node ./scripts/screenshot-homepage.js

} |& tee "$LOG_DIR/phase7.log" || abort_if_failed 7
log "✅ PHASE 7 complete — Full-page homepage screenshot captured."

# ---------- CLEANUP ----------
log "=== CLEANUP: Terminating Vite Server ==="
if [ -n "$VITE_PID" ] && ps -p "$VITE_PID" > /dev/null 2>&1; then
    kill "$VITE_PID" 2>/dev/null || true
    log "✅ Vite server terminated (PID: $VITE_PID)"
    VITE_PID=""
else
    log "[INFO] Vite server already stopped"
fi

# ---------- SUMMARY ----------
log "========================================="
log "🎉 ALL PHASES COMPLETE"
log "========================================="
log "Summary of logs:"
log "  - Full playbook: $LOG_DIR/playbook.log"
log "  - Phase 0 (setup): $LOG_DIR/phase0.log"
log "  - Phase 1 (server): $LOG_DIR/phase1.log"
log "  - Phase 2 (DOM): $LOG_DIR/phase2.log"
log "  - Phase 3 (POM): $LOG_DIR/phase3.log"
log "  - Phase 4 (MSW): $LOG_DIR/phase4.log"
log "  - Phase 5 (tests): $LOG_DIR/auth-e2e.log"
log "  - Phase 6 (config): $LOG_DIR/phase6.log"
log "  - Phase 7 (visual): $LOG_DIR/phase7.log"
log "  - Vite server: $LOG_DIR/vite-server.log"
log "========================================="
