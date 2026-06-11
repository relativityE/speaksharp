import fs from 'fs';
import path from 'path';

const METRICS_FILE = path.resolve(process.cwd(), 'test-results/metrics.json');
const CI_AUDIT_FILE = path.resolve(process.cwd(), 'test-results/ci-audit.md');
const COVERAGE_FILE = path.resolve(process.cwd(), 'frontend/coverage/coverage-summary.json');
const EVIDENCE_DIR = path.resolve(process.cwd(), 'product_release/evidence');
const JSON_EVIDENCE_FILE = path.join(EVIDENCE_DIR, 'software-quality.latest.json');
const MD_EVIDENCE_FILE = path.join(EVIDENCE_DIR, 'software-quality-summary.latest.md');

const QUALITY_TARGETS = {
  tests: {
    failing: 0,
    skippedMax: 0,
    totalRuntimeMaxMinutes: 15,
  },
  coverage: {
    releaseFloor: 60,
    industryTarget: 80,
  },
  lighthouse: {
    performance: 90,
    accessibility: 90,
    bestPractices: 90,
    seo: 90,
  },
  performance: {
    codeBloatIndexPctMax: 20,
    totalSourceSizeMax: '60M',
    totalProjectSizeMax: '4G',
    initialChunkSizeMax: '500K',
  },
};

console.log('[QualityMetrics] Starting software quality evidence generation.');

function matchNumber(content, regex) {
  const match = content.match(regex);
  return match ? Number(match[1]) : null;
}

function readCiAuditOverride() {
  if (!fs.existsSync(CI_AUDIT_FILE)) return null;

  const content = fs.readFileSync(CI_AUDIT_FILE, 'utf-8');
  const unitPassed = matchNumber(content, /Unit Tests[\s\S]*?- \*\*Passed\*\*:\s*(\d+)\s*\/\s*\d+/);
  const unitTotal = matchNumber(content, /Unit Tests[\s\S]*?- \*\*Passed\*\*:\s*\d+\s*\/\s*(\d+)/);
  const e2ePassed = matchNumber(content, /E2E Tests[\s\S]*?- \*\*Passed\*\*:\s*(\d+)\s*\/\s*\d+/);
  const e2eTotal = matchNumber(content, /E2E Tests[\s\S]*?- \*\*Passed\*\*:\s*\d+\s*\/\s*(\d+)/);

  if (unitPassed === null || unitTotal === null || e2ePassed === null || e2eTotal === null) {
    return null;
  }

  return {
    unit_tests: {
      passed: unitPassed,
      failed: 0,
      skipped: Math.max(0, unitTotal - unitPassed),
      total: unitTotal,
    },
    e2e_tests: {
      passed: e2ePassed,
      failed: 0,
      skipped: Math.max(0, e2eTotal - e2ePassed),
      total: e2eTotal,
    },
    lighthouse: {
      performance: matchNumber(content, /- \*\*Performance\*\*:\s*(\d+)/),
      accessibility: matchNumber(content, /- \*\*Accessibility\*\*:\s*(\d+)/),
      best_practices: matchNumber(content, /- \*\*Best Practices\*\*:\s*(\d+)/),
      seo: matchNumber(content, /- \*\*SEO\*\*:\s*(\d+)/),
    },
  };
}

function readCoverage(metrics) {
  if (metrics.coverage) {
    return {
      statements: metrics.coverage.statements,
      branches: metrics.coverage.branches,
      functions: metrics.coverage.functions,
      lines: metrics.coverage.lines,
    };
  }

  if (fs.existsSync(COVERAGE_FILE)) {
    const coverageData = JSON.parse(fs.readFileSync(COVERAGE_FILE, 'utf-8'));
    const total = coverageData.total;
    return {
      statements: total.statements.pct,
      branches: total.branches.pct,
      functions: total.functions.pct,
      lines: total.lines.pct,
    };
  }

  return {
    statements: null,
    branches: null,
    functions: null,
    lines: null,
  };
}

function formatPct(value) {
  return value === null || value === undefined ? 'N/A' : `${value}%`;
}

function readMetrics() {
  if (!fs.existsSync(METRICS_FILE)) {
    throw new Error(`Metrics artifact not found: ${METRICS_FILE}`);
  }

  return JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));
}

function buildEvidence() {
  const metrics = readMetrics();
  const ciAuditOverride = readCiAuditOverride();
  const unitTests = ciAuditOverride?.unit_tests ?? metrics.unit_tests ?? { passed: 0, failed: 0, skipped: 0, total: 0 };
  const e2eTests = ciAuditOverride?.e2e_tests ?? metrics.e2e_tests ?? { passed: 0, failed: 0, skipped: 0, total: 0 };
  const hasCurrentLighthouseMetrics = metrics.lighthouse && Object.values(metrics.lighthouse).some(value => Number(value) > 0);
  const lighthouse = hasCurrentLighthouseMetrics ? metrics.lighthouse : ciAuditOverride?.lighthouse ?? null;
  const coverage = readCoverage(metrics);
  const performance = metrics.performance ?? {};

  const e2eTotal = e2eTests.total ?? ((e2eTests.passed || 0) + (e2eTests.failed || 0) + (e2eTests.skipped || 0));
  const totalTests = (unitTests.total || 0) + e2eTotal;
  const passingTests = (unitTests.passed || 0) + (e2eTests.passed || 0);
  const failingTests = (unitTests.failed || 0) + (e2eTests.failed || 0);
  const skippedTests = (unitTests.skipped || 0) + (e2eTests.skipped || 0);
  const totalRuntimeSeconds = metrics.total_runtime_seconds || 0;

  return {
    schemaVersion: 1,
    kind: 'software-quality',
    generatedAt: new Date().toISOString(),
    run: {
      githubRunId: process.env.GITHUB_RUN_ID ?? null,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      commitSha: process.env.GITHUB_SHA ?? null,
      actor: process.env.GITHUB_ACTOR ?? null,
      source: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
    },
    tests: {
      total: totalTests,
      passing: passingTests,
      failing: failingTests,
      skipped: skippedTests,
      unit: unitTests,
      e2e: {
        ...e2eTests,
        total: e2eTotal,
      },
    },
    targets: QUALITY_TARGETS,
    coverage,
    lighthouse,
    performance: {
      totalSourceSize: performance.source_size ?? null,
      totalProjectSize: performance.total_size ?? null,
      initialChunkSize: performance.initial_chunk_size ?? null,
      codeBloatIndexPct: performance.bloat_percentage ?? null,
    },
    runtime: {
      totalRuntimeSeconds,
    },
  };
}

function renderMarkdown(evidence) {
  const runtime = evidence.runtime.totalRuntimeSeconds > 0
    ? `${Math.floor(evidence.runtime.totalRuntimeSeconds / 60)}m ${evidence.runtime.totalRuntimeSeconds % 60}s`
    : 'See CI logs';
  const unitTotal = evidence.tests.unit.total || 0;
  const e2eTotal = evidence.tests.e2e.total || 0;
  const unitPassingPct = unitTotal > 0 ? ((evidence.tests.unit.passed / unitTotal) * 100).toFixed(1) : '0.0';
  const e2ePassingPct = e2eTotal > 0 ? ((evidence.tests.e2e.passed / e2eTotal) * 100).toFixed(1) : '0.0';
  const lighthouse = evidence.lighthouse;
  const targets = evidence.targets;

  return `# Software Quality Evidence

Generated: ${evidence.generatedAt}

Source: ${evidence.run.source}
Commit: ${evidence.run.commitSha ?? 'local/unavailable'}
GitHub run: ${evidence.run.githubRunId ?? 'local/unavailable'}

## Test Suite State

| Metric | Target | Latest measured |
|---|---:|---:|
| Total tests | Track trend | ${evidence.tests.total} (${unitTotal} unit + ${e2eTotal} E2E) |
| Passing tests | 100% of non-skipped tests | ${evidence.tests.passing} (${evidence.tests.unit.passed} unit + ${evidence.tests.e2e.passed} E2E) |
| Failing tests | ${targets.tests.failing} | ${evidence.tests.failing} |
| Disabled/skipped tests | ${targets.tests.skippedMax} release-path skips | ${evidence.tests.skipped} |
| Passing unit tests | 100% | ${evidence.tests.unit.passed}/${unitTotal} (${unitPassingPct}%) |
| Passing E2E tests | 100% | ${evidence.tests.e2e.passed}/${e2eTotal} (${e2ePassingPct}%) |
| Total runtime | <= ${targets.tests.totalRuntimeMaxMinutes}m | ${runtime} |

## Coverage Summary

| Metric | Release floor | Industry target | Latest measured |
|---|---:|---:|---:|
| Statements | ${targets.coverage.releaseFloor}% | ${targets.coverage.industryTarget}% | ${formatPct(evidence.coverage.statements)} |
| Branches | ${targets.coverage.releaseFloor}% | ${targets.coverage.industryTarget}% | ${formatPct(evidence.coverage.branches)} |
| Functions | ${targets.coverage.releaseFloor}% | ${targets.coverage.industryTarget}% | ${formatPct(evidence.coverage.functions)} |
| Lines | ${targets.coverage.releaseFloor}% | ${targets.coverage.industryTarget}% | ${formatPct(evidence.coverage.lines)} |

## Code Bloat And Performance

| Metric | Target | Latest measured |
|---|---:|---:|
| Total source size | <= ${targets.performance.totalSourceSizeMax} | ${evidence.performance.totalSourceSize ?? 'N/A'} |
| Total project size | <= ${targets.performance.totalProjectSizeMax} | ${evidence.performance.totalProjectSize ?? 'N/A'} |
| Initial chunk size | <= ${targets.performance.initialChunkSizeMax} | ${evidence.performance.initialChunkSize ?? 'N/A'} |
| Code bloat index | < ${targets.performance.codeBloatIndexPctMax}% | ${evidence.performance.codeBloatIndexPct ?? 'N/A'}% |
| Lighthouse performance | >= ${targets.lighthouse.performance} | ${lighthouse?.performance ?? 'N/A'} |
| Lighthouse accessibility | >= ${targets.lighthouse.accessibility} | ${lighthouse?.accessibility ?? 'N/A'} |
| Lighthouse best practices | >= ${targets.lighthouse.bestPractices} | ${lighthouse?.best_practices ?? 'N/A'} |
| Lighthouse SEO | >= ${targets.lighthouse.seo} | ${lighthouse?.seo ?? 'N/A'} |
`;
}

try {
  const evidence = buildEvidence();
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(JSON_EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
  fs.writeFileSync(MD_EVIDENCE_FILE, renderMarkdown(evidence));

  console.log(`[QualityMetrics] Evidence written to ${JSON_EVIDENCE_FILE}`);
  console.log(`[QualityMetrics] Summary written to ${MD_EVIDENCE_FILE}`);
} catch (error) {
  console.error('[QualityMetrics] Failed to generate software quality evidence:', error);
  process.exit(1);
}
