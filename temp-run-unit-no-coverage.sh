#!/bin/bash
set -euo pipefail

echo "--- Running Unit Tests without Coverage ---"
# Using time to measure the duration of the test run.
# Using the default reporter for clear console output.
# Omitting the --coverage flag to test the performance impact.
time pnpm vitest run --reporter=default
