#!/bin/bash
# Canonical Test Audit Wrapper (v14)
# Delegates all execution logic to scripts/run-ci.mjs (Node.js)

set -euo pipefail

show_help() {
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  ci-simulate           Run the full CI pipeline (Node.js Orchestrator)"
    echo "  local                 Run the full local audit (Node.js Orchestrator)"
    echo "  agent                 Run the Agent-safe repair loop (Node.js Orchestrator)"
    echo "  clean                 Remove test artifacts, reports, and temporary metadata"
    echo ""
    echo "Options:"
    echo "  --skip-lighthouse     (ci-simulate|local) Skip the Lighthouse CI stage"
    echo "  --nuclear             (clean) Kill Vite/Playwright processes and wipe all caches"
    echo "  --help, -h            Show this help message"
}

# --- Main ---
STAGE="local"
SKIP_LH=false
if [ $# -eq 0 ]; then show_help; exit 1; fi

for arg in "$@"; do
    if [ "$arg" = "--skip-lighthouse" ]; then SKIP_LH=true; fi
    if [ "$arg" = "ci-simulate" ]; then STAGE="ci-simulate"; fi
    if [ "$arg" = "agent" ]; then STAGE="agent"; fi
    if [ "$arg" = "local" ]; then STAGE="local"; fi
    if [ "$arg" = "clean" ]; then STAGE="clean"; fi
    if [ "$arg" = "--help" ] || [ "$arg" = "-h" ]; then show_help; exit 0; fi
done

case $STAGE in
    ci-simulate|local|agent) 
        echo "🚀 Delegating to Node.js CI Orchestrator..."
        node scripts/run-ci.mjs "$@"
        ;;
    clean) 
        NUCLEAR=false
        for subarg in "$@"; do if [ "$subarg" = "--nuclear" ]; then NUCLEAR=true; fi; done

        if [ "$NUCLEAR" = true ]; then
            echo "☢️  NUCLEAR CLEAN - Wiping all caches and killing processes..."
            pkill -9 -f "playwright|vitest|chromium|vite" || true
            rm -rf frontend/dist frontend/node_modules/.vite frontend/.vite node_modules/.cache 2>/dev/null || true
            # Recursive log cleanup (User Request)
            echo "🧹 Purging all logs recursively..."
            find . -type f -name "*.log" -delete || true
        fi

        echo "🧹 Cleaning CI & Test artifacts..."
        # Unified artifact & report purge
        rm -rf artifacts/ test-results/ merged-reports/ blob-report/ playwright-report/ 2>/dev/null || true
        rm -rf lighthouse-results/ .lighthouseci/ screenshots/ coverage/ html/ 2>/dev/null || true
        rm -rf test-support/ blob-collection/ playwright-results.json/ 2>/dev/null || true
        rm -rf .playwright/ .pytest_cache/ .vitest-reports/ 2>/dev/null || true
        rm -f ci-audit.md ci_run.log *-metrics.json results.json lighthouse-*.json summary.json ci-results.json 2>/dev/null || true
        # Recursive trace and debug log purge
        find . -type f -name "debug*.log" -delete || true
        find . -type f -name "trace.zip" -delete || true
        echo "✅ Clean complete."
        ;;
    *) 
        show_help
        exit 1 ;;
esac
