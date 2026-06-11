#!/bin/bash
# Canonical Test Audit Wrapper (v14)
# Delegates all execution logic to scripts/run-ci.mjs (Node.js)

set -euo pipefail

show_help() {
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  prepare               Run CI prepare stage: preflight only"
    echo "  unit                  Run quality checks and unit coverage"
    echo "  unit-shard [n] [total] Run one sharded Vitest unit slice"
    echo "  build                 Build the test application artifact"
    echo "  health-check          Run app health check suite once"
    echo "  test [shard]          Run CI E2E suite against prepared build; optional shard is legacy/debug only"
    echo "  report                Generate CI metrics/report from restored artifacts"
    echo "  ci-simulate           Run the full CI pipeline (Node.js Orchestrator)"
    echo "  local                 Run the full local audit (Node.js Orchestrator)"
    echo "  agent                 Run the Agent-safe repair loop (Node.js Orchestrator)"
    echo "  clean                 Remove test artifacts, reports, and temporary metadata"
    echo "  infra                 Run Infrastructure Probe suite (Fast)"
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
    if [ "$arg" = "prepare" ]; then STAGE="prepare"; fi
    if [ "$arg" = "unit" ]; then STAGE="unit"; fi
    if [ "$arg" = "unit-shard" ]; then STAGE="unit-shard"; fi
    if [ "$arg" = "build" ]; then STAGE="build"; fi
    if [ "$arg" = "test" ]; then STAGE="test"; fi
    if [ "$arg" = "report" ]; then STAGE="report"; fi
    if [ "$arg" = "ci-simulate" ]; then STAGE="ci-simulate"; fi
    if [ "$arg" = "agent" ]; then STAGE="agent"; fi
    if [ "$arg" = "local" ]; then STAGE="local"; fi
    if [ "$arg" = "health-check" ]; then STAGE="health-check"; fi
    if [ "$arg" = "infra" ]; then STAGE="health-check"; fi
    if [ "$arg" = "clean" ]; then STAGE="clean"; fi
    if [ "$arg" = "--help" ] || [ "$arg" = "-h" ]; then show_help; exit 0; fi
done

case $STAGE in
    prepare)
        echo "🚀 Running CI prepare stage..."
        ./scripts/preflight.sh
        ;;
    unit)
        echo "🚀 Running CI unit stage..."
        pnpm quality
        rm -rf artifacts/coverage
        mkdir -p artifacts/coverage/.tmp
        pnpm exec vitest run --config frontend/vitest.config.mjs --coverage --coverage.reporter=json-summary --reporter=default --reporter=./scripts/vitest-ci-reporter.mjs
        ;;
    unit-shard)
        echo "🚀 Running CI unit shard stage..."
        UNIT_SHARD=""
        UNIT_SHARD_TOTAL=""
        for subarg in "$@"; do
            if [[ "$subarg" =~ ^[0-9]+$ ]]; then
                if [ -z "$UNIT_SHARD" ]; then
                    UNIT_SHARD="$subarg"
                else
                    UNIT_SHARD_TOTAL="$subarg"
                fi
            fi
        done
        if [ -z "$UNIT_SHARD" ] || [ -z "$UNIT_SHARD_TOTAL" ]; then
            echo "Usage: $0 unit-shard [n] [total]" >&2
            exit 1
        fi
        pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false --shard="${UNIT_SHARD}/${UNIT_SHARD_TOTAL}" --reporter=default --reporter=./scripts/vitest-ci-reporter.mjs
        ;;
    build)
        echo "🚀 Running CI build stage..."
        pnpm build:test
        ;;
    health-check)
        echo "🚀 Running CI health-check stage..."
        mkdir -p test-results/playwright-infra
        PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/playwright-infra/results.json \
            pnpm exec playwright test --project=infra-probe --workers=1 --reporter=line,json --output=test-results/playwright-infra
        ;;
    test)
        echo "🚀 Running CI E2E shard stage..."
        SHARD=""
        for subarg in "$@"; do
            if [[ "$subarg" =~ ^[0-9]+$ ]]; then SHARD="$subarg"; fi
        done
        if [ -n "$SHARD" ]; then
            pnpm exec playwright test --project=full-suite --no-deps --shard="${SHARD}/4" --reporter=blob --output=test-results/playwright
        else
            pnpm exec playwright test --project=full-suite --no-deps --reporter=blob --output=test-results/playwright
        fi
        ;;
    report)
        echo "🚀 Running CI report stage..."
        ./scripts/run-metrics.sh
        QUALITY_METRICS_FLAG="--write-quality-metrics=false"
        for subarg in "$@"; do
            if [[ "$subarg" == --write-quality-metrics=* || "$subarg" == --write-prd-metrics=* ]]; then
                QUALITY_METRICS_FLAG="$subarg"
            fi
        done
        node scripts/run-ci.mjs --only-report "$QUALITY_METRICS_FLAG"
        ;;
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
