
import fs from 'fs';
import path from 'path';

const PRD_FILE = path.resolve(process.cwd(), 'docs/PRD.md');
const METRICS_FILE = path.resolve(process.cwd(), 'test-results/metrics.json');
const COVERAGE_FILE = path.resolve(process.cwd(), 'frontend/coverage/coverage-summary.json');

console.log('[UpdateScript] Starting PRD metrics update.');

try {
  // Read all necessary source files
  const prdContent = fs.readFileSync(PRD_FILE, 'utf-8');
  const metrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));

  // Read coverage data
  let coverage = { statements: 'N/A', branches: 'N/A', functions: 'N/A', lines: 'N/A' };
  if (fs.existsSync(COVERAGE_FILE)) {
    const coverageData = JSON.parse(fs.readFileSync(COVERAGE_FILE, 'utf-8'));
    const total = coverageData.total;
    coverage = {
      statements: `${total.statements.pct}%`,
      branches: `${total.branches.pct}%`,
      functions: `${total.functions.pct}%`,
      lines: `${total.lines.pct}%`
    };
  }

  // --- Data Calculation ---
  const { unit_tests, e2e_tests, performance } = metrics;
  const e2eTotal = (e2e_tests.passed || 0) + (e2e_tests.failed || 0) + (e2e_tests.skipped || 0);
  const totalTests = unit_tests.total + e2eTotal;
  const passingTests = unit_tests.passed + e2e_tests.passed;
  const failingTests = unit_tests.failed + e2e_tests.failed;
  const skippedTests = unit_tests.skipped + e2e_tests.skipped;

  // Calculate percentages
  const unitTestsPassingPct = unit_tests.total > 0 ? ((unit_tests.passed / unit_tests.total) * 100).toFixed(1) : 0;
  const e2eTestsPassingPct = e2eTotal > 0 ? ((e2e_tests.passed / e2eTotal) * 100).toFixed(1) : 0;

  // --- New Vertical Table Generation ---
  const newSqmSection = `
## 6. Software Quality Metrics

**Last Updated:** ${new Date().toUTCString()}

**Note:** This section is automatically updated by the CI pipeline. The data below reflects the most recent successful run.

---

### Test Suite State

| Metric                  | Value |
| ----------------------- | ----- |
| Total tests             | ${totalTests} (${unit_tests.total} unit + ${e2eTotal} E2E) |
| Unit tests              | ${unit_tests.total}   |
| E2E tests (Playwright)  | ${e2eTotal}  |
| Passing tests           | ${passingTests} (${unit_tests.passed} unit + ${e2e_tests.passed} E2E)   |
| Failing tests           | ${failingTests}   |
| Disabled/skipped tests  | ${skippedTests} (E2E only)   |
| Passing unit tests      | ${unit_tests.passed}/${unit_tests.total} (${unitTestsPassingPct}%)   |
| Passing E2E tests       | ${e2e_tests.passed}/${e2eTotal} (${e2eTestsPassingPct}%)   |
| Total runtime           | See CI logs   |

---

### Coverage Summary

| Metric     | Value |
| ---------- | ----- |
| Statements | ${coverage.statements}   |
| Branches   | ${coverage.branches}   |
| Functions  | ${coverage.functions}   |
| Lines      | ${coverage.lines}   |

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
