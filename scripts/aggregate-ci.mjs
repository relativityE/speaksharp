import fs from 'fs';
import path from 'path';
import { aggregatePlaywright } from './aggregate-playwright.mjs';
import { aggregateVitest } from './aggregate-vitest.mjs';

const OUTPUT_DIR = 'artifacts';
const METRICS_PATH = path.join(OUTPUT_DIR, 'ci-metrics.json');
const WALL_CLOCK_PATH = path.join(OUTPUT_DIR, 'ci-wall-clock.json');

// INPUT PATHS
const PW_MERGED_PATH = 'test-results/playwright/results.json';
const PW_FALLBACK_PATH = 'test-results/playwright-results.json';
const VT_PATH = 'test-results/unit/results.json';

function main() {
  const rootDir = process.cwd();
  
  // ---- 1. Aggregate Logical Metrics ----
  const pwPath = fs.existsSync(path.resolve(rootDir, PW_MERGED_PATH)) 
    ? path.resolve(rootDir, PW_MERGED_PATH) 
    : path.resolve(rootDir, PW_FALLBACK_PATH);
    
  const playwright = aggregatePlaywright(pwPath);
  const vitest = aggregateVitest(path.resolve(rootDir, VT_PATH));

  // Calculate Global Retry Overhead
  const totalRetryOverheadMs = playwright.retryOverheadMs;

  const metricsReport = {
    timestamp: new Date().toISOString(),
    playwright: {
      logicalTimeMs: playwright.totalDurationMs,
      retryOverheadMs: totalRetryOverheadMs,
      tests: playwright.testCount,
      topSlowTests: playwright.topSlowTests,
      breakdown: playwright.breakdown
    },
    vitest: {
      logicalTimeMs: vitest.totalDurationMs,
      tests: vitest.testCount
    },
    totals: {
      logicalTimeMs: playwright.totalDurationMs + vitest.totalDurationMs,
      retryOverheadMs: totalRetryOverheadMs
    }
  };

  // ---- 2. Aggregate Wall-Clock Performance ----
  const shardFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('ci-wall-clock-shard-') && f.endsWith('.json'));
    
  let aggregatedStages = [];
  let maxShardWallClockMs = 0;
  let preflightDuration = 0;
  let metricsDuration = 0;
  
  const testExecutionSubtasks = [];

  // If shards exist, we merge them
  if (shardFiles.length > 0) {
    shardFiles.forEach(file => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf8'));
        const shardNum = file.match(/shard-(\d+)/)[1];
        
        // Find "Test Execution" stage in this shard
        const testStage = data.stages.find(s => s.stage === 'Test Execution');
        if (testStage) {
          testExecutionSubtasks.push({
            name: `playwright:shard-${shardNum}`,
            duration: testStage.duration
          });
        }
        
        // Track longest shard as the critical path for Test Execution
        maxShardWallClockMs = Math.max(maxShardWallClockMs, testStage?.duration || 0);
        
        // Take Preflight from any shard (usually same across all)
        const preStage = data.stages.find(s => s.stage === 'Preflight Checks');
        if (preStage) preflightDuration = Math.max(preflightDuration, preStage.duration);
        
      } catch (e) {
        console.warn(`[METRICS] Failed to parse shard wall-clock: ${file}`);
      }
    });
  } else {
    // Fallback to single-run wall-clock if it exists
    const singlePath = path.join(OUTPUT_DIR, 'ci-wall-clock.json');
    if (fs.existsSync(singlePath)) {
        const data = JSON.parse(fs.readFileSync(singlePath, 'utf8'));
        aggregatedStages = data.stages;
        maxShardWallClockMs = data.actualWallClockMs; // Use the absolute time measured
    }
  }

  // If we have aggregated shards, reconstruct the stages list
  if (testExecutionSubtasks.length > 0) {
    aggregatedStages = [
      { stage: "Preflight Checks", duration: preflightDuration, subtasks: [] },
      { stage: "Test Execution", duration: maxShardWallClockMs, subtasks: testExecutionSubtasks },
      // Metrics & SQM (Current job)
      { stage: "Metrics & SQM", duration: 0, subtasks: [] } 
    ];
  }

  // Final Wall-Clock Construction
  const wallClockReport = {
    stages: aggregatedStages,
    totalDurationMs: aggregatedStages.reduce((sum, s) => sum + s.duration, 0),
    actualWallClockMs: maxShardWallClockMs + preflightDuration // Inferred for shards
  };

  // ---- 3. Persist ----
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  fs.writeFileSync(METRICS_PATH, JSON.stringify(metricsReport, null, 2));
  fs.writeFileSync(WALL_CLOCK_PATH, JSON.stringify(wallClockReport, null, 2));

  // ---- 4. Console Summary ----
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                 SPEAKSHARP LOGICAL TIMING                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`  Playwright E2E : ${(metricsReport.playwright.logicalTimeMs / 1000).toFixed(2)}s (${metricsReport.playwright.tests} tests)`);
  console.log(`  Retry Overhead : ${(metricsReport.playwright.retryOverheadMs / 1000).toFixed(2)}s`);
  console.log(`  Vitest Unit    : ${(metricsReport.vitest.logicalTimeMs / 1000).toFixed(2)}s (${metricsReport.vitest.tests} tests)`);
  console.log('  ────────────────────────────────────────────────────────────');
  console.log(`  TOTAL LOGICAL  : ${(metricsReport.totals.logicalTimeMs / 1000).toFixed(2)}s`);
  console.log('  ────────────────────────────────────────────────────────────\n');
  
  if (metricsReport.playwright.topSlowTests.length > 0) {
    console.log('🚀 TOP SLOWEST TESTS (COST + RETRIES):');
    metricsReport.playwright.topSlowTests.slice(0, 5).forEach((t, i) => {
      const overhead = t.retryOverheadMs > 0 ? ` [Retries: ${t.attempts}, Overhead: ${(t.retryOverheadMs/1000).toFixed(2)}s]` : '';
      console.log(`  ${i + 1}. ${(t.duration / 1000).toFixed(2)}s - ${t.title}${overhead}`);
    });
    console.log('');
  }

  if (aggregatedStages.length > 0) {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                   CI WALL-CLOCK SUMMARY                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    for (const t of aggregatedStages) {
        console.log(`  ${t.stage.padEnd(20)} : ${(t.duration / 1000).toFixed(2)}s`);
        for (const sub of (t.subtasks || [])) {
            console.log(`    └─ ${sub.name.padEnd(16)} : ${(sub.duration / 1000).toFixed(2)}s`);
        }
    }
    console.log('  ────────────────────────────────────────────────────────────\n');
  }
}

main();
