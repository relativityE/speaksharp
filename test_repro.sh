#!/bin/bash
set -e
echo "Starting test..."
# This simulates a grep that might fail on some platforms due to \s support
echo "Tests  461 passed (461)" | grep -E "Tests\s+[0-9]+" || echo "Grep failed to find match"

echo "If you see this, the script continued."
