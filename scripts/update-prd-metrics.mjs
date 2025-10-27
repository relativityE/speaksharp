
import fs from 'fs';
import path from 'path';

const PRD_FILE = path.resolve(process.cwd(), 'docs/PRD.md');
const METRICS_FILE = path.resolve(process.cwd(), 'test-results/metrics.json');

console.log('[UpdateScript] Starting PRD metrics update.');

try {
  // Read all necessary source files
  const prdContent = fs.readFileSync(PRD_FILE, 'utf-8');
  const metrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));

  // --- Data Calculation ---
  const { unit_tests, e2e_tests, performance } = metrics;
  const e2eTotal = (e2e_tests.passed || 0) + (e2e_tests.failed || 0) + (e2e_tests.skipped || 0);
  const totalTests = unit_tests.total + e2eTotal;
  const passingTests = unit_tests.passed + e2e_tests.passed;
  const failingTests = unit_tests.failed + e2e_tests.failed;
  const skippedTests = unit_tests.skipped + e2e_tests.skipped;
  const unitTestsPassing = `${unit_tests.passed} / ${unit_tests.total}`;
  const e2eTestsFailing = `${e2e_tests.failed} / ${e2eTotal}`;

  // --- New Vertical Table Generation ---
  const newSqmSection = `
## 6. Software Quality Metrics

**Last Updated:** ${new Date().toUTCString()}

**Note:** This section is automatically updated by the CI pipeline. The data below reflects the most recent successful run.

---

### Test Suite State

| Metric                  | Value |
| ----------------------- | ----- |
| Total tests             | ${totalTests} |
| Unit tests              | ${unit_tests.total}   |
| E2E tests (Playwright)  | ${e2eTotal}  |
| Passing tests           | ${passingTests}   |
| Failing tests           | ${failingTests}   |
| Disabled/skipped tests  | ${skippedTests}   |
| Unit tests passing      | ${unitTestsPassing}   |
| E2E tests failing       | ${e2eTestsFailing}   |
| Total runtime           | N/A   |

---

### Coverage Summary

| Metric     | Value |
| ---------- | ----- |
| Statements | N/A   |
| Branches   | N/A   |
| Functions  | N/A   |
| Lines      | ${unit_tests.coverage.lines}%   |

---

### Code Bloat & Performance

This section provides metrics that help identify "code bloat"—unnecessary or dead code that increases load times and harms the user experience.

| Metric | Value | Description |
|---|---|---|
| **Initial Chunk Size** | ${performance.initial_chunk_size} | The size of the largest initial JavaScript bundle. This is a direct measure of the amount of code a user has to download and parse on their first visit. Large values here are a strong indicator of code bloat. |
| **Lighthouse Score** | (coming soon) | A comprehensive performance score from Google Lighthouse. It measures the *impact* of code bloat on the user experience, including metrics like Time to Interactive. |

---
  `.trim();

  // --- File Injection Logic ---
  const startMarker = '<!-- SQM:START -->';
  const endMarker = '<!-- SQM:END -->';
  const startIndex = prdContent.indexOf(startMarker);
  const endIndex = prdContent.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1) {
    throw new Error('SQM markers not found in PRD.md');
  }

  const contentBefore = prdContent.substring(0, startIndex + startMarker.length);
  const contentAfter = prdContent.substring(endIndex);

  const newPrdContent = [contentBefore, newSqmSection, contentAfter].join('\n');

  fs.writeFileSync(PRD_FILE, newPrdContent);
  console.log('[UpdateScript] PRD.md updated successfully.');

} catch (error) {
  console.error('[UpdateScript] Failed to update PRD.md:', error);
  process.exit(1);
}
