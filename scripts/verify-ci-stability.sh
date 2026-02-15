#!/bin/bash

echo "🧪 Running CI stability verification..."

# cd into frontend to pick up vitest.config.mjs
cd frontend

# Run each test file 10 times
declare -a test_files=(
  "src/services/transcription/__tests__/TranscriptionService.zombie.test.ts"
  "src/services/transcription/utils/__tests__/AudioProcessor.test.ts"
  "src/hooks/__tests__/useSessionLifecycle.test.tsx"
  "src/pages/__tests__/SessionPage.timer.component.test.tsx"
  "src/services/transcription/modes/__tests__/CloudAssemblyAI.test.ts"
  "src/pages/__tests__/SignUpPage.component.test.tsx"
  "src/hooks/useSpeechRecognition/__tests__/index.component.test.tsx"
)

for file in "${test_files[@]}"; do
  echo "Testing: $file (10 iterations)"
  
  for i in {1..10}; do
    echo "  Iteration $i/10..."
    
    if ! npx vitest run "$file" --reporter=return-of-the-jedi > /dev/null 2>&1; then
      echo "  ❌ FAILED on iteration $i"
      # Run again with output to see error
      npx vitest run "$file"
      exit 1
    fi
  done
  
  echo "  ✅ PASSED all 10 iterations"
done

echo "✅ All tests passed 10/10 times - CI is stable!"
