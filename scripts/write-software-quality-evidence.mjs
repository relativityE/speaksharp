import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Candidate imports occur only after old output is invalidated, including on parse/import failure.
let COVERAGE_RELEASE_FLOOR, assertSoftwareQualityEvidence, parseCiAuditOverride;

const METRICS_FILE = path.resolve(process.cwd(), 'test-results/metrics.json');
const CI_AUDIT_FILE = path.resolve(process.cwd(), 'test-results/ci-audit.md');
const COVERAGE_FILE = path.resolve(process.cwd(), 'frontend/coverage/coverage-summary.json');
const EVIDENCE_DIR = path.resolve(process.cwd(), 'product_release/evidence');
const JSON_EVIDENCE_FILE = path.join(EVIDENCE_DIR, 'software-quality.latest.json');
const MD_EVIDENCE_FILE = path.join(EVIDENCE_DIR, 'software-quality-summary.latest.md');
const serviceLevelMode=process.argv.slice(2).includes('--service-levels');
const SERVICE_OUTPUTS=['service-levels.latest.json','service-levels-summary.latest.md'].map(name=>path.join(EVIDENCE_DIR,name));
const CI_METRICS_FILE = path.resolve(process.cwd(), 'artifacts/ci-metrics.json');

const QUALITY_TARGETS = {
  tests: {
    failing: 0,
    skippedMax: 0,
    totalRuntimeMaxMinutes: 15,
  },
  coverage: {
    releaseFloor: null,
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

function readCiAuditOverride() {
  if (!fs.existsSync(CI_AUDIT_FILE)) return null;
  return parseCiAuditOverride(fs.readFileSync(CI_AUDIT_FILE, 'utf-8'));
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

function readLogicalRuntimeSeconds() {
  if (!fs.existsSync(CI_METRICS_FILE)) return null;
  const ciMetrics = JSON.parse(fs.readFileSync(CI_METRICS_FILE, 'utf-8'));
  const milliseconds = Number(ciMetrics?.totals?.logicalTimeMs);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.ceil(milliseconds / 1000) : null;
}

function buildEvidence() {
  const metrics = readMetrics();
  const ciAuditOverride = readCiAuditOverride();
  // The metrics JSON is assembled from the canonical shard artifacts. The Markdown report is a
  // presentation layer and may legitimately be absent or stale; it must never replace canonical counts.
  const unitTests = metrics.unit_tests ?? ciAuditOverride?.unit_tests ?? null;
  const e2eTests = metrics.e2e_tests ?? ciAuditOverride?.e2e_tests ?? null;
  const hasCurrentLighthouseMetrics = metrics.lighthouse && Object.values(metrics.lighthouse).some(value => Number(value) > 0);
  const lighthouse = hasCurrentLighthouseMetrics ? metrics.lighthouse : ciAuditOverride?.lighthouse ?? null;
  const coverage = readCoverage(metrics);
  const performance = metrics.performance ?? {};

  const e2eTotal = e2eTests?.total ?? ((e2eTests?.passed || 0) + (e2eTests?.failed || 0) + (e2eTests?.skipped || 0));
  const totalTests = (unitTests?.total || 0) + e2eTotal;
  const passingTests = (unitTests?.passed || 0) + (e2eTests?.passed || 0);
  const failingTests = (unitTests?.failed || 0) + (e2eTests?.failed || 0);
  const skippedTests = (unitTests?.skipped || 0) + (e2eTests?.skipped || 0);
  const recordedRuntime = Number(metrics.total_runtime_seconds);
  const totalRuntimeSeconds = recordedRuntime > 0 ? recordedRuntime : readLogicalRuntimeSeconds();

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
        ...(e2eTests ?? {}),
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
Run attempt: ${evidence.provenance.runAttempt ?? 'local'}
Execution coverage: ${evidence.executionCoverage.status} (${evidence.overallStatus})
Claim scope: metrics and explicitly registered analytics faults only; not all product journeys.

${evidence.executionCoverage.rows.map(row => `- ${row.status}: ${row.file} (${row.route?.runner ?? 'no registered runner'})`).join('\n')}

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
  // Never consume an uploaded/local PASS receipt: execute against this checkout on this run.
  // Remove previous output first so a failed attempt cannot leave an apparently current PASS.
  fs.rmSync(JSON_EVIDENCE_FILE, { force: true });
  fs.rmSync(MD_EVIDENCE_FILE, { force: true });
  if (serviceLevelMode) for (const file of SERVICE_OUTPUTS) fs.rmSync(file,{force:true});
  if (process.argv.slice(2).some(arg=>arg!=='--service-levels')) throw new Error('Unknown quality evidence argument');
  ({COVERAGE_RELEASE_FLOOR,assertSoftwareQualityEvidence,parseCiAuditOverride}=await import('./lib/softwareQualityEvidenceQualification.mjs'));
  const {runTestEfficacy,runVitestExecution}=await import('./run-test-efficacy.mjs');
  const {executionContext,changedEvidencePaths,executionCoverage,resolveComparisonBase}=await import('./lib/testExecutionEvidence.mjs');
  // Standalone local writes get a new identity; consumers must receive this identity from the
  // invoking controller, never adopt it from the receipt they are trying to validate.
  process.env.SOFTWARE_QUALITY_INVOCATION ??= randomUUID();
  QUALITY_TARGETS.coverage.releaseFloor=COVERAGE_RELEASE_FLOOR;
  const evidence = buildEvidence();
  const qualification = assertSoftwareQualityEvidence(evidence);
  process.env.TEST_EFFICACY_BASE=resolveComparisonBase(process.cwd());
  const provenance=executionContext(process.cwd());
  evidence.provenance=provenance;
  evidence.testEfficacy = runTestEfficacy({provenance});
  evidence.testExecution = runVitestExecution({provenance});
  evidence.executionCoverage=executionCoverage(changedEvidencePaths(process.cwd(),process.env.TEST_EFFICACY_BASE),
    {root:process.cwd(),expected:provenance,pilot:evidence.testEfficacy,execution:evidence.testExecution,base:process.env.TEST_EFFICACY_BASE});
  evidence.overallStatus=evidence.executionCoverage.status==='COMPLETE'?'QUALIFIED':'UNQUALIFIED';
  evidence.trust='candidate-controlled observation; independent checker/runtime isolation not established';
  if (evidence.run.source === 'github-actions' && evidence.run.commitSha !== evidence.testEfficacy.commit) {
    throw new Error('CI commit identity differs from tested checkout');
  }
  if (evidence.overallStatus !== 'QUALIFIED') {
    const gaps=evidence.executionCoverage.rows.filter(row=>row.status!=='EXECUTED');
    const pilotGap=evidence.executionCoverage.pilot.status==='NOT RUN'?'NOT RUN: applicable analytics pilot; ':'';
    throw new Error(`Unqualified execution coverage: ${pilotGap}${gaps.map(row=>`${row.status}: ${row.file}`).join('; ')}`);
  }
  evidence.qualification = { status: 'valid', scope:'quality-metrics-only', ...qualification };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(JSON_EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
  fs.writeFileSync(MD_EVIDENCE_FILE, renderMarkdown(evidence));

  console.log(`[QualityMetrics] Evidence written to ${JSON_EVIDENCE_FILE}`);
  console.log(`[QualityMetrics] Summary written to ${MD_EVIDENCE_FILE}`);
  if (serviceLevelMode) {
    execFileSync(process.execPath,[path.join(path.dirname(fileURLToPath(import.meta.url)),'write-service-level-evidence.mjs')],
      {cwd:process.cwd(),env:process.env,stdio:'inherit',timeout:120000});
  }
} catch (error) {
  if (serviceLevelMode) {
    for (const file of [JSON_EVIDENCE_FILE,MD_EVIDENCE_FILE,...SERVICE_OUTPUTS]) fs.rmSync(file,{force:true});
  }
  console.error('[QualityMetrics] Failed to generate software quality evidence:', error);
  process.exit(1);
}
