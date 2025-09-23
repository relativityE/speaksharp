#!/bin/bash
set -euo pipefail

echo "--- Running Unit Tests in Parallel without Coverage ---"
# Using the --pool=threads and --poolOptions.threads=4 to match the local `test:unit` script.
# Omitting --coverage to isolate the effect of parallelization.
time pnpm vitest run --pool=threads --poolOptions.threads=4 --reporter=default
