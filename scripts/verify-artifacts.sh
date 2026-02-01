#!/bin/bash
set -euo pipefail

# Usage: ./scripts/verify-artifacts.sh [--path <dir>] [build|metrics|test-results]

BASE_DIR="."
if [ "${1:-}" == "--path" ]; then
    BASE_DIR="$2"
    shift 2
fi

check_build() {
    if [ ! -d "$BASE_DIR/frontend/dist" ]; then
        echo "❌ Missing artifact: $BASE_DIR/frontend/dist (Build output)"
        return 1
    fi
    echo "✅ Found artifact: $BASE_DIR/frontend/dist"
    return 0
}

check_metrics() {
    if [ ! -f "$BASE_DIR/unit-metrics.json" ]; then
        echo "❌ Missing artifact: $BASE_DIR/unit-metrics.json (Unit test metrics)"
        return 1
    fi
    echo "✅ Found artifact: $BASE_DIR/unit-metrics.json"
    return 0
}

check_test_results() {
    if [ ! -d "$BASE_DIR/test-results" ]; then
        echo "⚠️ Missing artifact: $BASE_DIR/test-results (E2E results) - This may be expected if tests failed or haven't run."
        return 0 # Warning only
    fi
    echo "✅ Found artifact: $BASE_DIR/test-results"
    return 0
}

FAILED=0

if [ $# -eq 0 ]; then
    # Check all
    check_build || FAILED=1
    check_metrics || FAILED=1
    check_test_results || FAILED=1
else
    # Check specific
    for arg in "$@"; do
        case $arg in
            build) check_build || FAILED=1 ;;
            metrics) check_metrics || FAILED=1 ;;
            test-results) check_test_results || FAILED=1 ;;
            *) echo "Unknown artifact type: $arg"; FAILED=1 ;;
        esac
    done
fi

if [ "$FAILED" -eq 1 ]; then
    echo "❌ Artifact verification failed."
    exit 1
fi

echo "🎉 All required artifacts verified."
exit 0
