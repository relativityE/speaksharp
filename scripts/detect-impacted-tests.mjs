import { execSync } from 'child_process';
import fs from 'fs';

const IMPACT_MAP_PATH = 'test-impact-map.json';

// Large `git diff` outputs can exceed Node's default 1 MB execSync buffer → ENOBUFS. Cap generously.
const EXEC_MAX_BUFFER = 64 * 1024 * 1024; // 64 MB

function getChangedFiles() {
  try {
    return execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8', maxBuffer: EXEC_MAX_BUFFER })
      .split('\n')
      .filter(Boolean);
  } catch {
    // Fallback if origin/main is missing
    return execSync('git diff --name-only HEAD~1', { encoding: 'utf8', maxBuffer: EXEC_MAX_BUFFER })
      .split('\n')
      .filter(Boolean);
  }
}

const map = JSON.parse(fs.readFileSync(IMPACT_MAP_PATH, 'utf8'));
const changedFiles = getChangedFiles();
const impactedTests = new Set(['tests/e2e/core-journey.e2e.spec.ts']); // Always run Core Journey

changedFiles.forEach(file => {
  for (const [prefix, tests] of Object.entries(map)) {
    if (file.startsWith(prefix)) {
      tests.forEach(t => impactedTests.add(t));
    }
  }
});

console.log(Array.from(impactedTests).join(' '));
