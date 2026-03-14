import fs from 'fs';
import path from 'path';

/**
 * ANSI color codes for terminal formatting
 */
export const ANSI = {
    BOLD: '\x1b[1m',
    CYAN: '\x1b[36m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    RED: '\x1b[31m',
    DIM: '\x1b[2m',
    RESET: '\x1b[0m',
};

/**
 * Renders a stylized box for terminal headers/footers
 */
export function renderBox(title, width = 60) {
    const line = '═'.repeat(width);
    const padding = Math.max(0, Math.floor((width - title.length - 2) / 2));
    const leftPad = ' '.repeat(padding);
    const rightPad = ' '.repeat(width - title.length - 2 - padding);

    return [
        `╔${line}╗`,
        `║${leftPad} ${ANSI.BOLD}${title}${ANSI.RESET} ${rightPad}║`,
        `╚${line}╝`
    ].join('\n');
}

/**
 * Formats duration from milliseconds to human-readable string
 */
export function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const seconds = (ms / 1000).toFixed(1);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(0);
    return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Parses Playwright results from multiple potential locations (merged vs local)
 */
export function parsePlaywrightResults(rootDir) {
    const DEBUG = process.env.LOG_LEVEL === 'debug';
    const resultsPath = path.join(rootDir, 'artifacts', 'playwright', 'results.json');

    const telemetry = { passed: 0, failed: 0, flaky: 0, skipped: 0, shards: {} };

    // 1. Check for Shards
    const shardsDir = path.join(rootDir, 'artifacts', 'playwright');
    if (fs.existsSync(shardsDir)) {
        const shards = fs.readdirSync(shardsDir).filter(s => s.startsWith('shard-'));
        if (shards.length > 0) {
            for (const shard of shards) {
                const shardId = shard.replace('shard-', '');
                const shardPath = path.join(shardsDir, shard, 'report.json'); // Assumes unzipped or separate json
                // Note: If they are only zips, we'd need to unzip. 
                // But ci.yml can be adjusted to unzip or we assume merged report is primary.
                // For now, let's stick to the merged results.json but provide the structure.
            }
        }
    }

    if (!fs.existsSync(resultsPath)) {
        if (DEBUG) console.log(`[CI DEBUG] Playwright results missing at: ${resultsPath}`);
        return telemetry;
    }

    try {
        const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

        function walk(suite) {
            if (suite.specs) {
                suite.specs.forEach(spec => {
                    if (spec.tests) {
                        spec.tests.forEach(test => {
                            const status = test.status;
                            const outcome = test.outcome || (status === 'expected' || status === 'passed' ? 'expected' : 'unexpected');

                            if (outcome === 'skipped' || status === 'skipped') {
                                telemetry.skipped++;
                            } else if (outcome === 'expected') {
                                telemetry.passed++;
                            } else if (outcome === 'flaky') {
                                telemetry.flaky++;
                            } else {
                                telemetry.failed++;
                            }
                        });
                    }
                });
            }
            if (suite.suites) {
                suite.suites.forEach(walk);
            }
        }

        if (data.suites) {
            data.suites.forEach(walk);
        }

        // 2. Extract Shard Metadata if available
        if (data.metadata?.shards || data.shards) {
            const shardData = data.metadata?.shards || data.shards;
            telemetry.shards = shardData;

            // Aggregate shard counts into global telemetry
            Object.values(shardData).forEach(s => {
                telemetry.passed += s.passed || 0;
                telemetry.failed += (s.total || 0) - (s.passed || 0);
            });
        }

        return telemetry;
    } catch (e) {
        console.warn(`⚠️ [CI] Failed to parse Playwright results at ${resultsPath}:`, e.message);
        return telemetry;
    }
}

/**
 * Extracts Lighthouse scores by averaging all .report.json files
 */
export function parseLighthouse(rootDir) {
    const DEBUG = process.env.LOG_LEVEL === 'debug';
    
    // Check local results first (Orchestrator mode), then artifacts (Aggregator mode)
    let resultsDir = path.join(rootDir, 'lighthouse-results');
    if (!fs.existsSync(resultsDir)) {
        resultsDir = path.join(rootDir, 'artifacts', 'lighthouse');
    }

    if (!fs.existsSync(resultsDir)) {
        if (DEBUG) console.log('[CI DEBUG] Lighthouse results directory missing.');
        return {};
    }

    try {
        const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('-report.json'));
        if (files.length === 0) return {};

        const totals = { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 };
        let count = 0;

        for (const file of files) {
            const filePath = path.join(resultsDir, file);
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

            if (data.categories) {
                totals.performance += (data.categories.performance?.score || 0) * 100;
                totals.accessibility += (data.categories.accessibility?.score || 0) * 100;
                totals.bestPractices += (data.categories['best-practices']?.score || 0) * 100;
                totals.seo += (data.categories.seo?.score || 0) * 100;
                count++;
            }
        }

        if (count === 0) return {};

        return {
            performance: Math.round(totals.performance / count),
            accessibility: Math.round(totals.accessibility / count),
            bestPractices: Math.round(totals.bestPractices / count),
            seo: Math.round(totals.seo / count)
        };
    } catch (e) {
        console.warn('⚠️ [CI] Failed to parse Lighthouse reports:', e.message);
        return {};
    }
}

/**
 * @deprecated Playwright already performs merging via `merge-reports`.
 * Legacy/Alternative Shard aggregation (kept for extreme backward compatibility)
 */
export function aggregateShards(rootDir) {
    console.warn('⚠️ [CI] aggregateShards() is deprecated. Use native Playwright merging instead.');
    const reportDir = path.join(rootDir, 'test-results/playwright');
    const resultsFile = path.join(reportDir, 'results.json');

    if (!fs.existsSync(resultsFile)) return null;

    try {
        const data = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
        return data.shards || null;
    } catch {
        return null;
    }
}

/**
 * Parses Vitest results from the JSON report
 */
export function parseVitestResults(rootDir) {
    const DEBUG = process.env.LOG_LEVEL === 'debug';
    const resultsPath = path.join(rootDir, 'test-results', 'unit', 'results.json');
    const telemetry = { passed: 0, failed: 0, total: 0 };

    if (!fs.existsSync(resultsPath)) {
        if (DEBUG) console.log(`[CI DEBUG] Vitest results missing at: ${resultsPath}`);
        return telemetry;
    }

    try {
        const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
        return {
            passed: data.numPassedTests || 0,
            failed: data.numFailedTests || 0,
            total: data.numTotalTests || 0
        };
    } catch (e) {
        console.warn('⚠️ [CI] Failed to parse Vitest results:', e.message);
        return telemetry;
    }
}

/**
 * Extracts SQM results using canonical data sources
 */
export function getSQMResults(rootDir, currentTelemetry = {}) {
    const DEBUG = process.env.LOG_LEVEL === 'debug';
    
    // Check local coverage first, then artifacts
    let coveragePath = path.join(rootDir, 'frontend', 'coverage', 'coverage-summary.json');
    if (!fs.existsSync(coveragePath)) {
        coveragePath = path.join(rootDir, 'artifacts', 'coverage', 'coverage-summary.json');
    }

    let metricsPath = path.join(rootDir, 'artifacts', 'metrics', 'unit-metrics.json');

    const result = {
        coverage: 0,
        score: 0,
        passingRate: 0
    };

    // 1. Lines Coverage
    if (fs.existsSync(coveragePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
            result.coverage = data.total?.lines?.pct || 0;
        } catch (e) {
            if (DEBUG) console.warn('[CI DEBUG] Failed to parse coverage:', e.message);
        }
    }

    // 2. Metrics & Score computation
    // Merge current run telemetry for the score calculation
    const e2e = currentTelemetry.tests?.playwright || { passed: 0, failed: 0 };
    const unit = currentTelemetry.tests?.vitest || { passed: 0, failed: 0 };
    const lh = currentTelemetry.lighthouse || { performance: 0 };

    const totalTests = (e2e.passed + e2e.failed) + (unit.passed + unit.failed);
    const passedTests = e2e.passed + unit.passed;
    result.passingRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;

    // SQM Recalibration (40/40/20 weighting)
    // 1. Passing Rate: 40 points
    const passingContribution = (result.passingRate / 100) * 40;

    // 2. Coverage: 40 points (Normalized: 80% coverage = 40 points)
    const coverageContribution = Math.min(40, (result.coverage / 80) * 40);

    // 3. Lighthouse: 20 points (Normalized: 90 Performance = 20 points)
    const lhPerformance = lh.performance || 0;
    const lhContribution = Math.min(20, (lhPerformance / 90) * 20);

    result.score = Math.round(passingContribution + coverageContribution + lhContribution);

    // Boundary check
    if (result.score > 100) result.score = 100;

    if (DEBUG) {
        console.log(`[SQM DEBUG] Passing: ${passingContribution.toFixed(1)} | Coverage: ${coverageContribution.toFixed(1)} | LH: ${lhContribution.toFixed(1)} | Total: ${result.score}`);
    }

    return result;
}
