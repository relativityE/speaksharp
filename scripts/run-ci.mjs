import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { CI_CONFIG } from './ci.config.js';
import {
    parseVitestResults,
    parsePlaywrightResults,
    ANSI,
    renderBox,
    formatDuration,
    parseLighthouse,
    getSQMResults
} from './ci-telemetry-utils.mjs';

// Structural Simplification - Direct Telemetry
global.__CI_TELEMETRY__ = {
    vitest: { passed: 0, failed: 0, total: 0 },
    playwright: { passed: 0, failed: 0, flaky: 0, skipped: 0, total: 0, shards: {} },
    lighthouse: {
        performance: 0,
        accessibility: 0,
        bestPractices: 0,
        seo: 0
    },
    coverage: 0,
    sqm: { score: 0 }
};

// Phase 5: Initialize Wall-Clock global timings
global.__CI_TIMINGS__ = [];

/**
 * Canonical audit model
 */
function buildAuditModel(ciTelemetry) {
    const stages = ciTelemetry.stages || [];
    const hasFatalFailure = stages.some(s => s.status === 'FAILED' || s.status === 'ABORTED');

    const pw = ciTelemetry.tests.playwright;
    const vi = ciTelemetry.tests.vitest;

    // Consumer-side normalization
    pw.total = pw.total ?? (
        (pw.passed || 0) +
        (pw.failed || 0) +
        (pw.flaky || 0) +
        (pw.skipped || 0)
    );

    const unitRan = (vi?.total || 0) > 0;
    const e2eRan = (pw?.total || 0) > 0;

    // Truthful Gating
    const unitFailed = (vi?.failed || 0) > 0;
    const e2eFailed = (pw?.failed || 0) > 0;

    const testsRan = process.argv.includes('--skip-test') || (unitRan && e2eRan);
    const testsPassed = !unitFailed && !e2eFailed;

    const pipelineSuccess = !hasFatalFailure && testsRan && testsPassed;
    const status = pipelineSuccess ? 'PASSED' : 'FAILED';

    return {
        status,
        runtime: ciTelemetry.totalDuration || 0,
        unit: {
            passed: vi?.passed || 0,
            failed: vi?.failed || 0,
            total: vi?.total || 0,
            ran: unitRan
        },
        e2e: {
            passed: pw?.passed || 0,
            failed: pw?.failed || 0,
            total: pw?.total || 0,
            flaky: pw?.flaky || 0,
            ran: e2eRan
        },
        lighthouse: ciTelemetry.lighthouse,
        sqm: ciTelemetry.sqm
    };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
function getFlagValue(flagName, defaultValue = false) {
    const explicitValue = process.argv.find(arg => arg.startsWith(`${flagName}=`));
    if (!explicitValue) {
        return process.argv.includes(flagName) ? true : defaultValue;
    }

    const value = explicitValue.slice(flagName.length + 1).trim().toLowerCase();
    if (['1', 'true', 'yes'].includes(value)) return true;
    if (['0', 'false', 'no'].includes(value)) return false;

    throw new Error(`Invalid ${flagName} value: ${explicitValue}. Use ${flagName}=true or ${flagName}=false.`);
}

const shouldWriteOperationalPrdMetrics = getFlagValue('--write-prd-metrics', false);

if (shouldWriteOperationalPrdMetrics && process.env.GITHUB_ACTIONS !== 'true') {
    console.error('--write-prd-metrics=true is reserved for the GitHub Actions cloud pipeline. Use --write-prd-metrics=false for local runs.');
    process.exit(1);
}

let devServer = null;
process.on('exit', () => {
    if (devServer) {
        try {
            // Using execSync with || true to prevent non-zero exit codes from pkill
            execSync('pkill -9 -f vite || true', { stdio: 'ignore' });
        } catch (e) { }
    }
});

const ALWAYS_RUN_SPECS = [
    'tests/e2e/auth.e2e.spec.ts',
    'tests/e2e/diag-private-stt.e2e.spec.ts'
];

class Stage {
    constructor(id, label) {
        this.id = id;
        this.label = label;
        this.status = 'PENDING'; // PENDING, RUNNING, SUCCESS, FAILED, SKIPPED, ABORTED
        this.startTime = null;
        this.duration = 0;
        this.metrics = null;
        this.subtasks = [];
    }

    start() {
        console.log(`\n${ANSI.CYAN}${ANSI.BOLD}[${this.id}/5] ${this.label}${ANSI.RESET}`);
        this.startTime = Date.now();
        this.status = 'RUNNING';
    }

    addSubTask(name, duration) {
        this.subtasks.push({ name, duration });
    }

    finish(status = 'SUCCESS', metrics = null) {
        if (this.startTime) {
            this.duration = Date.now() - this.startTime;
        }
        this.status = status;
        this.metrics = metrics;

        let icon = `${ANSI.GREEN}✔${ANSI.RESET}`;
        if (status === 'FAILED') icon = `${ANSI.RED}✖${ANSI.RESET}`;
        if (status === 'ABORTED') icon = `${ANSI.RED}🚫${ANSI.RESET}`;
        if (status === 'SKIPPED') icon = `${ANSI.YELLOW}⏩${ANSI.RESET}`;

        const timing = this.duration > 0 ? ` in ${formatDuration(this.duration)}` : '';
        console.log(`${icon} ${this.label} ${status.toLowerCase()}${timing}`);
    }
}

const isCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
const CI_MODE = process.env.CI_MODE || (isCI ? 'ci' : 'local');

// Colors & stdio.
// Just handle carriage returns.
function cleanLog(line) {
    return line.replace(/\r/g, '');
}

let lastLog = 0;
function throttledLog(msg) {
    const now = Date.now();
    if (now - lastLog >= 5) {
        console.log(msg);
        lastLog = now;
    }
}

async function waitForHTTP(url, timeout = 120000) {
    const start = Date.now();
    console.log(`[CI] Waiting for ${url} (timeout: ${timeout / 1000}s)...`);

    while (Date.now() - start < timeout) {
        try {
            // Using global fetch (Node 18+)
            const res = await fetch(url);
            if (res.ok) {
                console.log(`[CI] Service at ${url} is READY`);
                return;
            }
        } catch (e) {
            // Service not up yet
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    throw new Error(`HTTP service not ready after ${timeout / 1000}s: ${url}`);
}

export { CI_MODE };

/**
 * GitHub-specific summary renderer
 */
function generateGitHubSummary(auditModel) {
    if (!process.env.GITHUB_STEP_SUMMARY) return;

    const output = `
## SpeakSharp CI Summary 🧪🏆
- **Status**: ${auditModel.status === 'PASSED' ? '✅ PASSED' : '❌ FAILED'}
- **SQM Score**: ${auditModel.sqm?.score || 0} / 100
- **Unit Tests**: ${auditModel.unit.passed} / ${auditModel.unit.total}
- **E2E Tests**: ${auditModel.e2e.passed} / ${auditModel.e2e.total}
- **Runtime**: ${auditModel.runtime}s
`;

    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
}

async function runCommand(command, args, options = {}) {
    const { label = 'CMD', timeout = 600000, env = {} } = options;
    const controller = new AbortController();
    const { signal } = controller;
    let timer;

    // Suppress noise in CI by default
    const logLevel = process.env.LOG_LEVEL || 'error';

    return new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            console.error(`[${label}] ⏱️  Timed out after ${timeout / 1000}s. Aborting...`);
            controller.abort();
        }, timeout);

        const child = spawn(command, args, {
            cwd: rootDir,
            shell: false, // Use direct spawn
            signal,
            maxBuffer: 10 * 1024 * 1024,
            env: {
                ...process.env,
                ...env,
                FORCE_COLOR: '1',
                COLORTERM: 'truecolor',
                TERM: 'xterm-256color',
                LOG_LEVEL: logLevel,
                DEBUG: '-pw:webserver'
            },
            // Enable IPC for direct telemetry emission
            stdio: ['inherit', 'pipe', 'pipe', 'ipc']
        });

        child.on('message', (message) => {
            if (message && message.type === 'TELEMETRY') {
                const { tool, data } = message;
                console.log(`[CI TELEMETRY] Caught IPC message from ${tool}`);
                if (tool === 'vitest') {
                    global.__CI_TELEMETRY__.vitest = {
                        passed: data.passed || 0,
                        failed: data.failed || 0,
                        total: (data.passed || 0) + (data.failed || 0)
                    };
                } else if (tool === 'playwright') {
                    const stats = data.stats || data;
                    global.__CI_TELEMETRY__.playwright = {
                        passed: stats.expected || stats.passed || 0,
                        failed: stats.unexpected || stats.failed || 0,
                        flaky: stats.flaky || 0,
                        skipped: stats.skipped || 0,
                        total: (stats.expected || stats.passed || 0) + (stats.unexpected || stats.failed || 0) + (stats.flaky || 0) + (stats.skipped || 0)
                    };
                }
            }
        });

        let stdoutBuffer = '';
        child.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop(); // save the partial line

            for (let line of lines) {
                line = cleanLog(line);
                if (!line) continue;

                if (label === 'E2E') {
                    const signal = /fail|error|flaky|retry|timeout|passed|summary|Diagnostic|🔴|\[PW\]|\[BROWSER/i;
                    if (signal.test(line)) {
                        throttledLog(`${ANSI.DIM}[${label}]${ANSI.RESET} ${line}`);
                    }
                    continue;
                }

                if (label === 'LINT') {
                    // Never suppress OR throttle ESLint output
                    console.log(`${ANSI.DIM}[${label}]${ANSI.RESET} ${line}`);
                    continue;
                }

                if (logLevel === 'error' && (line.includes('[info]') || line.includes('[warn]') || line.includes('"level":30') || line.includes('"level":40'))) continue;
                throttledLog(`${ANSI.DIM}[${label}]${ANSI.RESET} ${line}`);
            }
        });

        let stderrBuffer = '';
        child.stderr.on('data', (data) => {
            stderrBuffer += data.toString();
            const lines = stderrBuffer.split('\n');
            stderrBuffer = lines.pop();

            for (const line of lines) {
                const clean = cleanLog(line);
                if (clean) {
                    console.error(`${ANSI.RED}[${label}][ERR]${ANSI.RESET} ${clean}`);
                }
            }
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            // Flush remaining buffers
            if (stdoutBuffer) {
                const line = cleanLog(stdoutBuffer);
                if (line) throttledLog(`${ANSI.DIM}[${label}]${ANSI.RESET} ${line}`);
            }
            if (stderrBuffer) {
                const line = cleanLog(stderrBuffer);
                if (line) console.error(`${ANSI.RED}[${label}][ERR]${ANSI.RESET} ${line}`);
            }
            if (code === 0) resolve();
            else reject(new Error(`[${label}] Exited with code ${code}`));
        });

        child.on('error', (err) => {
            clearTimeout(timer);
            if (err.name === 'AbortError') reject(new Error(`[${label}] Aborted due to timeout`));
            else reject(err);
        });
    });
}

const ciTelemetry = {
    stages: [],
    tests: {
        vitest: { passed: 0, failed: 0, total: 0 },
        playwright: { passed: 0, failed: 0, flaky: 0, skipped: 0, total: 0 }
    },
    lighthouse: {
        performance: 0,
        accessibility: 0,
        bestPractices: 0,
        seo: 0
    },
    sqm: { score: 0 }
};

let pipelineAborted = false;
let stagesList = [];

async function runStage(id, name, fn, { critical = false } = {}) {
    const stage = new Stage(id, name);
    stagesList.push(stage);

    if (pipelineAborted) {
        stage.finish('SKIPPED');
        ciTelemetry.stages.push({ name, status: 'SKIPPED', duration: 0 });
        return;
    }

    stage.start();

    try {
        await fn(stage);
        stage.finish('SUCCESS');
        ciTelemetry.stages.push({ name, status: 'SUCCESS', duration: (stage.duration / 1000).toFixed(2) });

        // Phase 5: Push wall-clock duration
        global.__CI_TIMINGS__.push({
            stage: name,
            duration: stage.duration,
            subtasks: stage.subtasks
        });
    } catch (err) {
        // Semantic Correctness
        // Stage FAILED because it ran and errored. 
        // Only mark ABORTED if it's a critical dependency failing.
        stage.finish('FAILED');
        ciTelemetry.stages.push({ name, status: 'FAILED', duration: (stage.duration / 1000).toFixed(2) });
        console.error(`${ANSI.RED}[STAGE FAIL]${ANSI.RESET} ${name}: ${err.message}`);

        // Phase 5: Still push wall-clock duration on failure
        global.__CI_TIMINGS__.push({
            stage: name,
            duration: stage.duration,
            subtasks: stage.subtasks
        });

        if (critical) {
            pipelineAborted = true;
            console.error(`${ANSI.BOLD}${ANSI.RED}🔴 FATAL: Critical stage '${name}' failed. Aborting pipeline.${ANSI.RESET}`);
        }
    }
}

async function main() {
    const summaryPath = path.join(rootDir, 'summary.json');
    const telemetryPath = path.join(rootDir, 'ci-results.json');
    const isInfraMode = process.argv.includes('infra');
    const isFullMode = process.argv.includes('--full') || process.argv.includes('ci-simulate');

    const startTime = Date.now();
    let unitFailed = false;

    // Converge all paths to auditModel
    try {
        if (process.argv.includes('--only-report')) {
            await runReport(startTime);
            return;
        }

        console.log(renderBox("SpeakSharp CI Orchestrator"));

        // Stage 1: Preflight (CRITICAL)
        await runStage(1, "Preflight Checks", async () => {
            await runCommand('./scripts/preflight.sh', [], { label: 'PRE' });
        }, { critical: true });

        // Stage 2: Quality (CRITICAL)
        if (!isInfraMode && !process.argv.includes('--skip-quality')) {
            await runStage(2, "Code Quality", async () => {
                const runAll = !process.argv.includes('--lint') &&
                    !process.argv.includes('--typecheck') &&
                    !process.argv.includes('--ban-disable');

                const tasks = [];
                if (runAll || process.argv.includes('--lint')) {
                    tasks.push(runCommand('pnpm', ['lint', '--quiet'], { label: 'LINT' }));
                }
                if (runAll || process.argv.includes('--typecheck')) {
                    tasks.push(runCommand('pnpm', ['typecheck'], { label: 'TYPES' }));
                }
                if (runAll || process.argv.includes('--ban-disable')) {
                    tasks.push(runCommand('pnpm', ['eslint-disable'], { label: 'CHECK-ESLINT' }));
                }

                await Promise.all(tasks);
            }, { critical: true });
        }

        // Stage 3: Testing
        if (!process.argv.includes('--skip-test')) {
            await runStage(3, "Test Execution", async (stage) => {
                let unitFailed = false;
                let e2eFailed = false;
                try {
                    const { execSync } = await import('child_process');
                    const impactOutput = execSync('node scripts/detect-impact-automation.mjs', { cwd: rootDir }).toString().trim();

                    // Run Unit Tests first (Independent of server)
                    try {
                        if (isInfraMode) {
                            console.log("[CI] Core Mode: Skipping individual unit tests for fast probe...");
                        } else if (impactOutput === 'ALL' || isFullMode) {
                            const s1 = Date.now();
                            fs.mkdirSync(path.join(rootDir, 'frontend', 'coverage'), { recursive: true });
                            await runCommand('pnpm', [
                                'exec',
                                'vitest',
                                'run',
                                '--config', 'frontend/vitest.config.mjs',
                                '--coverage',
                                '--coverage.reporter=json-summary',
                                '--reporter=./scripts/vitest-ci-reporter.mjs'
                            ], { label: 'UNIT' });
                            stage.addSubTask('unit-tests', Date.now() - s1);
                        } else if (impactOutput !== 'NONE') {
                            const s1 = Date.now();
                            const testFiles = impactOutput.split(' ').filter(Boolean);
                            const vitestFiles = testFiles.filter(f => f.includes('.test.ts') || f.includes('.test.tsx'));
                            if (vitestFiles.length > 0) {
                                fs.mkdirSync(path.join(rootDir, 'frontend', 'coverage'), { recursive: true });
                                await runCommand('pnpm', ['run', 'test:unit', '--coverage', '--reporter=./scripts/vitest-ci-reporter.mjs', ...vitestFiles], { label: 'UNIT' });
                            }
                            stage.addSubTask('unit-tests', Date.now() - s1);
                        }

                        const coveragePath = path.join(rootDir, 'artifacts/coverage/coverage-summary.json');
                        if (!fs.existsSync(coveragePath)) {
                          throw new Error('[CI TELEMETRY] coverage-summary.json NOT GENERATED');
                        }

                        // Parse results even if they partially ran
                        ciTelemetry.tests.vitest = parseVitestResults(rootDir);
                    } catch (err) {
                        if (!isInfraMode) {
                            console.error(`${ANSI.RED}[UNIT] Unit tests failed, but proceeding to E2E...${ANSI.RESET}`);
                            unitFailed = true;
                        }
                    }

                    // Build once, then let Playwright's canonical webServer serve the
                    // production-like E2E bundle on the same path as pnpm test:full.
                    const s2 = Date.now();
                    console.log("[CI] Building test bundle for E2E...");
                    await runCommand('pnpm', ['build:test'], { label: 'BUILD' });
                    stage.addSubTask('build-test', Date.now() - s2);

                    const workerCount = Math.min(Math.max(1, Math.floor(os.cpus().length * CI_CONFIG.WORKER_SCALING_RATIO)), CI_CONFIG.MAX_WORKERS);

                    // Run E2E Tests
                    const s3 = Date.now();
                    if (isInfraMode) {
                        console.log("[CI] Running Infrastructure Probe (E2E)...");
                        await runCommand('pnpm', [
                            'run', 'test:e2e',
                            '--workers=1',
                            'tests/e2e/infra.probe.e2e.spec.ts'
                        ], { label: 'INFRA-PROBE' });
                    } else if (impactOutput === 'ALL' || isFullMode) {
                        console.log("[CI] Running Infrastructure Probe once before sharded app journeys...");
                        const sInfra = Date.now();
                        await runCommand('pnpm', [
                            'exec',
                            'playwright',
                            'test',
                            '--project=infra-probe',
                            '--workers=1',
                            '--reporter=./scripts/playwright-telemetry-reporter.mjs',
                            '--output=test-results/playwright-infra'
                        ], {
                            label: 'INFRA-PROBE',
                            env: {
                                ...process.env,
                                PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(rootDir, 'test-results/playwright/infra-results.json')
                            }
                        });
                        stage.addSubTask('infra-probe', Date.now() - sInfra);

                        const totalShards = 4;
                        for (let i = 1; i <= totalShards; i++) {
                            console.log(`${ANSI.CYAN}[CI] Executing Shard ${i}/${totalShards}...${ANSI.RESET}`);
                            const sShard = Date.now();
                            try {
                                await runCommand('pnpm', [
                                    'exec',
                                    'playwright',
                                    'test',
                                    '--project=full-suite',
                                    '--no-deps',
                                    `--workers=${workerCount}`,
                                    `--shard=${i}/${totalShards}`,
                                    '--reporter=./scripts/playwright-telemetry-reporter.mjs',
                                    '--reporter=json',
                                    '--output=test-results/playwright-artifacts'
                                ], { 
                                    label: `E2E-SHARD-${i}`,
                                    env: {
                                        ...process.env,
                                        PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(rootDir, `test-results/playwright/results-${i}.json`)
                                    }
                                });
                            } catch (err) {
                                console.error(`${ANSI.RED}[SHARD ${i}] FAILED${ANSI.RESET}`);
                                e2eFailed = true;
                            } finally {
                                stage.addSubTask(`app-shard-${i}`, Date.now() - sShard);
                            }
                        }

                        const shardFiles = fs.readdirSync(path.join(rootDir, 'test-results/playwright'))
                          .filter(f => f.startsWith('results-'));

                        if (shardFiles.length < totalShards) {
                          throw new Error(`[CI TELEMETRY] Missing shard results: ${shardFiles.length}/${totalShards}`);
                        }
                    } else if (impactOutput !== 'NONE') {
                        const testFiles = impactOutput.split(' ').filter(Boolean);
                        const playwrightFiles = [...new Set([...testFiles.filter(f => f.includes('.spec.ts')), ...ALWAYS_RUN_SPECS])];
                        if (playwrightFiles.length > 0) {
                            await runCommand('pnpm', [
                                'run', 'test:e2e',
                                `--workers=${workerCount}`,
                                '--reporter=./scripts/playwright-telemetry-reporter.mjs',
                                '--reporter=json',
                                '--output=test-results/playwright-artifacts',
                                ...playwrightFiles
                            ], {
                                label: 'E2E',
                                env: {
                                    ...process.env,
                                    PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(rootDir, 'test-results/playwright/results.json')
                                }
                            });
                        }
                    }
                    stage.addSubTask('e2e-execution', Date.now() - s3);

                    // Parse Results
                    ciTelemetry.tests.vitest = parseVitestResults(rootDir);
                    ciTelemetry.tests.playwright = parsePlaywrightResults(rootDir);

                    // Sync Global Telemetry for Summary
                    global.__CI_TELEMETRY__.vitest = ciTelemetry.tests.vitest;
                    global.__CI_TELEMETRY__.playwright = ciTelemetry.tests.playwright;
                } finally {
                    // Cleanup
                    // Sync Global Telemetry for Summary (Fallback to files)
                    if (global.__CI_TELEMETRY__.vitest.total === 0) {
                        try {
                            const vitestResults = JSON.parse(fs.readFileSync(path.join(rootDir, 'test-results/unit/results.json'), 'utf8'));
                            global.__CI_TELEMETRY__.vitest = {
                                passed: vitestResults.numPassedTests || 0,
                                failed: vitestResults.numFailedTests || 0,
                                total: vitestResults.numTotalTests || 0
                            };
                            ciTelemetry.tests.vitest = global.__CI_TELEMETRY__.vitest;
                        } catch (e) { /* No-op */ }
                    }

                    if (global.__CI_TELEMETRY__.playwright.total === 0) {
                        ciTelemetry.tests.playwright = parsePlaywrightResults(rootDir);
                        global.__CI_TELEMETRY__.playwright = {
                            passed: ciTelemetry.tests.playwright.passed,
                            failed: ciTelemetry.tests.playwright.failed,
                            flaky: ciTelemetry.tests.playwright.flaky,
                            skipped: ciTelemetry.tests.playwright.skipped,
                            total: ciTelemetry.tests.playwright.total
                        };
                    }

                    if (e2eFailed) {
                      throw new Error('[CI] One or more E2E shards failed');
                    }

                    if (global.__CI_TELEMETRY__.vitest.failed > 0 || global.__CI_TELEMETRY__.playwright.failed > 0) {
                        // Fail the stage but continue if not critical or if we want full audit
                        // In this script, Stage 3 is critical, so this will abort if we don't catch it.
                    }
                }
            });
        }

        // Stage 4: Lighthouse (Requires Production Build)
        if (!isInfraMode && !process.argv.includes('--skip-lighthouse')) {
            await runStage(4, "Lighthouse Audit", async () => {
                // Ensure fresh production-ready build for accurate performance metrics
                await runCommand('pnpm', ['build:test'], { label: 'BUILD' });

                await runCommand('pnpm', ['exec', 'node', 'scripts/generate-lhci-config.js'], { label: 'LH-CFG' });
                await runCommand('pnpm', ['exec', 'lhci', 'autorun', '--config=lighthouserc.json'], { label: 'LH-RUN' });
                const resultsDir = path.join(rootDir, 'lighthouse-results');
                if (!fs.existsSync(resultsDir) || fs.readdirSync(resultsDir).filter(f => f.endsWith('-report.json')).length === 0) {
                    throw new Error(`Lighthouse audit reports not found in ${resultsDir}`);
                }
                await runCommand('node', ['scripts/process-lighthouse-report.js'], { label: 'LH-PRC' });
                ciTelemetry.lighthouse = parseLighthouse(rootDir);
            });
        }

        // Stage 5: Metrics
        await runStage(5, "Metrics & SQM", async (stage) => {
            if (fs.existsSync(path.join(rootDir, 'scripts/run-metrics.sh'))) {
                const s1 = Date.now();
                await runCommand('./scripts/run-metrics.sh', [], { label: 'METRIC', env: { TOTAL_RUNTIME_SECONDS: Math.floor((Date.now() - startTime) / 1000) } });
                stage.addSubTask('run-metrics-sh', Date.now() - s1);

                const artifact = path.join(rootDir, 'test-results', 'metrics.json');
                if (!fs.existsSync(artifact)) throw new Error(`Metrics artifact not found: ${artifact}`);
            }
            const s2 = Date.now();
            ciTelemetry.sqm = getSQMResults(rootDir, ciTelemetry);
            stage.addSubTask('get-sqm-results', Date.now() - s2);
        });

        // Compute runtime before summary
        ciTelemetry.totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

        // Unify rendering
        const auditModel = buildAuditModel(ciTelemetry);
        printFinalSummary(auditModel);
        generateMarkdownReport(rootDir, auditModel);
        generateGitHubSummary(auditModel);

    } catch (error) {
        console.error(`\n${ANSI.RED}${ANSI.BOLD}❌ CI Pipeline Failed: ${error.message}${ANSI.RESET}`);

        // Compute duration even on failure
        ciTelemetry.totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

        // Final attempt at parsing results before summary
        if (global.__CI_TELEMETRY__.playwright.total === 0) {
            try {
                const pwPath = path.join(rootDir, 'test-results', 'playwright', 'results.json');
                if (fs.existsSync(pwPath)) {
                    const data = JSON.parse(fs.readFileSync(pwPath));
                    global.__CI_TELEMETRY__.playwright = {
                        passed: data.stats.expected || 0,
                        failed: data.stats.unexpected || 0,
                        flaky: data.stats.flaky || 0,
                        skipped: data.stats.skipped || 0,
                        total: (data.stats.expected || 0) + (data.stats.unexpected || 0) + (data.stats.flaky || 0) + (data.stats.skipped || 0)
                    };
                    ciTelemetry.tests.playwright = global.__CI_TELEMETRY__.playwright;
                }
            } catch (e) { }
        }

        // Ensure vitest is synced too
        ciTelemetry.tests.vitest = global.__CI_TELEMETRY__.vitest;

        ciTelemetry.sqm = getSQMResults(rootDir, ciTelemetry);

        const auditModel = buildAuditModel(ciTelemetry);
        printFinalSummary(auditModel);
        generateMarkdownReport(rootDir, auditModel);
        if (shouldWriteOperationalPrdMetrics) {
            await runCommand('node', ['scripts/update-prd-metrics.mjs'], { label: 'PRD-METRICS' });
        }
        generateGitHubSummary(auditModel);

        process.exitCode = 1;
    } finally {
        // Write machine-readable telemetry
        const telemetryData = {
            ...ciTelemetry,
            status: stagesList.some(s => s.status === 'FAILED') ? 'failed' : 'success',
            totalDuration: ((Date.now() - startTime) / 1000).toFixed(2)
        };
        fs.writeFileSync(telemetryPath, JSON.stringify(telemetryData, null, 2));
        fs.writeFileSync(summaryPath, JSON.stringify(telemetryData, null, 2));

        // Phase 5.2: Emit Wall-Clock File
        const shardArg = process.argv.find(arg => !arg.startsWith('-') && !isNaN(parseInt(arg)));
        const shardSuffix = shardArg ? `-shard-${shardArg}` : '';
        const wallClockPath = path.join(rootDir, 'artifacts', `ci-wall-clock${shardSuffix}.json`);

        if (!fs.existsSync(path.join(rootDir, 'artifacts'))) {
            fs.mkdirSync(path.join(rootDir, 'artifacts'), { recursive: true });
        }

        const totalDurationMs = global.__CI_TIMINGS__.reduce((sum, t) => sum + t.duration, 0);
        const actualWallClockMs = Date.now() - startTime;

        fs.writeFileSync(wallClockPath, JSON.stringify({
            stages: global.__CI_TIMINGS__,
            totalDurationMs: totalDurationMs,
            actualWallClockMs: actualWallClockMs
        }, null, 2));

        // Phase 5.3: Console Wall-Clock Summary
        if (global.__CI_TIMINGS__.length > 0) {
            console.log('\n╔════════════════════════════════════════════════════════════╗');
            console.log('║                   CI WALL-CLOCK SUMMARY                    ║');
            console.log('╚════════════════════════════════════════════════════════════╝');
            for (const t of global.__CI_TIMINGS__) {
                console.log(`  ${t.stage.padEnd(20)} : ${(t.duration / 1000).toFixed(2)}s`);
                for (const sub of t.subtasks) {
                    console.log(`    └─ ${sub.name.padEnd(16)} : ${(sub.duration / 1000).toFixed(2)}s`);
                }
            }
            console.log('  ────────────────────────────────────────────────────────────');
            console.log(`  ACTUAL WALL-CLOCK    : ${(actualWallClockMs / 1000).toFixed(2)}s`);
            console.log('  ────────────────────────────────────────────────────────────\n');
        }

        // Manual cleanup via --clean or --nuclear flag
        if (process.argv.includes('--clean') || process.argv.includes('--nuclear')) {
            cleanupArtifacts(rootDir);
        }
    }
}

function cleanupArtifacts(rootDir) {
    const isNuclear = process.argv.includes('--nuclear');
    const DEBUG = process.env.LOG_LEVEL === 'debug';

    // Special case: Keep the audit report we just generated
    // It's inside test-results, but we want it persistent.
    const rPath = path.join(rootDir, 'test-results', 'ci-audit.md');
    const pReport = path.join(rootDir, 'ci-audit.md');
    if (fs.existsSync(rPath)) {
        try {
            fs.renameSync(rPath, pReport);
            if (DEBUG) console.log('📄 [CI] Audit report moved to root for persistence.');
        } catch (e) {
            console.warn('⚠️ [CI] Failed to move audit report:', e.message);
        }
    }

    const targets = [
        'test-results',
        'merged-reports',
        'blob-report',
        'playwright-report',
        'lighthouse-results',
        '.lighthouseci',
        'screenshots',
        'coverage',
        'html'
    ];

    if (isNuclear) {
        console.log(`\n${ANSI.RED}☢️  NUCLEAR CLEAN - Wiping all caches and killing processes...${ANSI.RESET}`);
        try {
            execSync('pkill -f vite || true', { stdio: 'ignore' });
            execSync('pkill -f playwright || true', { stdio: 'ignore' });
        } catch (e) { }

        targets.push(
            'frontend/dist',
            'frontend/node_modules/.vite',
            'frontend/.vite',
            'node_modules/.cache'
        );
    }

    if (DEBUG) console.log(`\n🧹 [CI] Cleaning ${isNuclear ? 'NUCLEAR' : 'simple'} artifacts...`);

    targets.forEach(target => {
        const p = path.join(rootDir, target);
        if (fs.existsSync(p)) {
            try {
                fs.rmSync(p, { recursive: true, force: true });
                if (DEBUG) console.log(`   - Deleted: ${target}`);
            } catch (err) {
                console.warn(`⚠️ [CI] Failed to delete ${target}:`, err.message);
            }
        }
    });
}

function printFinalSummary(auditModel) {
    const p = auditModel.e2e;
    const v = auditModel.unit;
    const lh = auditModel.lighthouse;
    const sqm = auditModel.sqm;
    const runtime = auditModel.runtime;
    const success = auditModel.status === 'PASSED';

    console.log('\n' + renderBox("SpeakSharp CI Audit", 44));
    console.log('────────────────────────\n');

    // Build
    console.log(`${ANSI.BOLD}Status${ANSI.RESET}`);
    console.log(`  Value:  ${success ? ANSI.GREEN + 'PASSED' : ANSI.RED + 'FAILED'}${ANSI.RESET}\n`);

    // Unit Tests
    console.log(`${ANSI.BOLD}Unit Tests${ANSI.RESET}`);
    if (!v.ran) {
        console.log(`  Status:  ${ANSI.YELLOW}SKIPPED${ANSI.RESET}\n`);
    } else {
        console.log(`  Passed:  ${ANSI.GREEN}${v.passed} / ${v.total}${ANSI.RESET}\n`);
    }

    // E2E Tests (Playwright)
    console.log(`${ANSI.BOLD}E2E Tests${ANSI.RESET}`);
    if (!p.ran) {
        console.log(`  Status:  ${ANSI.YELLOW}SKIPPED${ANSI.RESET}\n`);
    } else {
        console.log(`  Passed:  ${ANSI.GREEN}${p.passed} / ${p.total}${ANSI.RESET}`);
        if (p.flaky > 0) console.log(`  Flaky:   ${ANSI.YELLOW}${p.flaky}${ANSI.RESET}`);
        console.log('');
    }

    // ... rest of the function ...

    // Coverage
    if (sqm && sqm.coverage !== undefined) {
        console.log(`${ANSI.BOLD}Coverage${ANSI.RESET}`);
        console.log(`  Lines:    ${ANSI.CYAN}${sqm.coverage}%${ANSI.RESET}\n`);
    }

    // Lighthouse
    if (lh && lh.performance !== undefined) {
        console.log(`${ANSI.BOLD}Lighthouse${ANSI.RESET}`);
        console.log(`  Performance:     ${lh.performance}`);
        console.log(`  Accessibility:   ${lh.accessibility}`);
        console.log(`  Best Practices:  ${lh.bestPractices}`);
        console.log(`  SEO:             ${lh.seo}\n`);
    }

    // SQM Score
    if (sqm && sqm.score !== undefined) {
        console.log(`${ANSI.BOLD}SQM Score${ANSI.RESET}`);
        console.log(`  Score:    ${ANSI.CYAN}${sqm.score} / 100${ANSI.RESET}\n`);
    }

    console.log(`${ANSI.BOLD}Pipeline${ANSI.RESET}`);
    console.log(`  Runtime:  ${runtime}s`);

    console.log('\n' + renderBox(`FINAL STATUS: ${auditModel.status}`, 44));
}

function generateMarkdownReport(rootDir, auditModel) {
    const reportPath = path.join(rootDir, 'test-results', 'ci-audit.md');
    const p = auditModel.e2e;
    const v = auditModel.unit;
    const lh = auditModel.lighthouse;
    const sqm = auditModel.sqm;
    const success = auditModel.status === 'PASSED';

    const content = `# SpeakSharp CI Audit
> Generated at: ${new Date().toISOString()}

## 📊 Summary
**Status**: ${success ? '✅ PASSED' : '❌ FAILED'}
**SQM Score**: ${sqm?.score || 0} / 100
**Pipeline Runtime**: ${auditModel.runtime}s

## 🧪 Test Results
### Unit Tests
- **Passed**: ${v.passed} / ${v.total}

### E2E Tests (Playwright)
- **Passed**: ${p.passed} / ${p.total}
- **Flaky**: ${p.flaky}

## ⚡ Performance (Lighthouse)
- **Performance**: ${lh.performance || 'N/A'}
- **Accessibility**: ${lh.accessibility || 'N/A'}
- **Best Practices**: ${lh.bestPractices || 'N/A'}
- **SEO**: ${lh.seo || 'N/A'}

## 📉 Quality Metrics
- **Code Coverage**: ${sqm?.coverage || 0}%
- **Passing Rate**: ${sqm?.passingRate?.toFixed(1) || 0}%
`;

    try {
        if (!fs.existsSync(path.dirname(reportPath))) {
            fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        }
        fs.writeFileSync(reportPath, content);
        console.log(`\n📄 [CI] Audit report generated at: ${reportPath}`);
    } catch (err) {
        console.warn('⚠️ [CI] Failed to generate markdown report:', err.message);
    }
}

/**
 * Pure aggregation function for CI environments
 */
async function runReport(startTime) {
    console.log(renderBox("SpeakSharp CI Aggregator (CI MODE)"));
    const summaryPath = path.join(rootDir, 'summary.json');
    const telemetryPath = path.join(rootDir, 'ci-results.json');

    try {
        // Parse distributed results
        console.log(`${ANSI.CYAN}📥 [CI] Parsing results from job artifacts...${ANSI.RESET}`);

        ciTelemetry.tests.playwright = parsePlaywrightResults(rootDir);
        ciTelemetry.tests.vitest = parseVitestResults(rootDir);
        ciTelemetry.lighthouse = parseLighthouse(rootDir);

        // Stage 5: Metrics & SQM (Always run in CI)
        await runStage(5, "Metrics & SQM", async () => {
            if (fs.existsSync(path.join(rootDir, 'scripts/run-metrics.sh'))) {
                await runCommand('./scripts/run-metrics.sh', [], {
                    label: 'METRIC',
                    env: { TOTAL_RUNTIME_SECONDS: Math.floor((Date.now() - startTime) / 1000) }
                });
            }
            ciTelemetry.sqm = getSQMResults(rootDir, ciTelemetry);
        });

        const auditModel = buildAuditModel(ciTelemetry);
        printFinalSummary(auditModel);
        generateMarkdownReport(rootDir, auditModel);
        if (shouldWriteOperationalPrdMetrics) {
            await runCommand('node', ['scripts/update-prd-metrics.mjs'], { label: 'PRD-METRICS' });
        }
        generateGitHubSummary(auditModel);

        // Write machine-readable telemetry
        const telemetryData = {
            ...ciTelemetry,
            status: auditModel.status.toLowerCase(),
            totalDuration: ((Date.now() - startTime) / 1000).toFixed(2)
        };
        fs.writeFileSync(telemetryPath, JSON.stringify(telemetryData, null, 2));
        fs.writeFileSync(summaryPath, JSON.stringify(telemetryData, null, 2));

        console.log(`\n${ANSI.GREEN}${ANSI.BOLD}✅ CI Aggregation Complete${ANSI.RESET}`);

    } catch (error) {
        console.error(`\n${ANSI.RED}${ANSI.BOLD}❌ CI Aggregator Failed: ${error.message}${ANSI.RESET}`);
        process.exitCode = 1;
    }
}

main();
