#!/bin/bash
set -euo pipefail

# Find all test files and run them one by one

# List of test files
TEST_FILES=(
  "src/services/transcription/__tests__/TranscriptionService.test.ts"
  "src/contexts/__tests__/AuthContext.test.tsx"
  "src/components/session/__tests__/TranscriptPanel.test.tsx"
  "src/hooks/__tests__/useSpeechRecognition.test.tsx"
  "src/hooks/__tests__/useSessionManager.test.ts"
  "src/hooks/__tests__/minimal.test.ts"
  "src/hooks/__tests__/useSpeechRecognition.test.ts"
  "src/lib/__tests__/dateUtils.test.ts"
  "src/lib/__tests__/analyticsUtils.test.ts"
  "src/__tests__/fillerWordUtils.test.ts"
  "src/__tests__/main.test.tsx"
)

# Loop through each test file and run it
for test_file in "${TEST_FILES[@]}"; do
  echo "--- Running test: $test_file ---"
  start_time=$(date +%s)
  if pnpm vitest run "$test_file"; then
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    echo "✅ SUCCESS: $test_file completed in $duration seconds."
  else
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    echo "❌ FAILURE: $test_file failed after $duration seconds."
    exit 1
  fi
  echo ""
done

echo "🎉 All tests passed individually."
