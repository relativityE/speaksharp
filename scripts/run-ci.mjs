import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { CI_CONFIG } from './ci.config.js';
import {
    parseVitestResults,
    ANSI,
    renderBox,
    formatDuration,
    parseLighthouse,
    getSQMResults
} from './ci-telemetry-utils.mjs';

// Structural Simplification - Direct Telemetry
global.__CI_TELEMETRY__ = {
    vitest: { passed: 0, failed: 0, total: 0 },
    playwright: { passed: 0, failed: 0, flaky: 0, skipped: 0, shards: {} },
    lighthouse: {
        performance: 0,
        accessibility: 0,
        bestPractices: 0,
        seo: 0
    },
    coverage: 0,
    sqm: {}
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let devServer = null;
process.on('exit', () => {
    if (devServer) {
        try {
            // Using spawnSync/execSync for synchronous exit cleanup
            spawn('pkill', ['-9', '-f', 'vite'], { stdio: 'ignore' });
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
        this.status = 'PENDING';
        this.startTime = null;
        this.duration = 0;
        this.metrics = null;
    }

    start() {
        console.log(`\n${ANSI.CYAN}${ANSI.BOLD}[${this.id}/5] ${this.label}${ANSI.RESET}`);
        this.startTime = Date.now();
        this.status = 'RUNNING';
    }

    finish(success = true, metrics = null) {
        this.duration = Date.now() - this.startTime;
        this.status = success ? 'SUCCESS' : 'FAILED';
        this.metrics = metrics;
        const icon = success ? `${ANSI.GREEN}✔${ANSI.RESET}` : `${ANSI.RED}✖${ANSI.RESET}`;
        console.log(`${icon} ${this.label} completed in ${formatDuration(this.duration)}`);
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
    if (now - lastLog > 20) {
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
                    global.__CI_TELEMETRY__.vitest = data;
                } else if (tool === 'playwright') {
                    global.__CI_TELEMETRY__.playwright = data;
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
        playwright: { passed: 0, failed: 0, flaky: 0, skipped: 0 }
    },
    lighthouse: {},
    sqm: {}
};

let stagesList = [];

// Collect status but do NOT throw.
async function runStage(id, name, fn) {
    const stage = new Stage(id, name);
    stagesList.push(stage);
    stage.start();
    try {
        await fn();
        stage.finish(true);
        ciTelemetry.stages.push({ name, status: 'passed', duration: (stage.duration / 1000).toFixed(2) });
    } catch (err) {
        stage.finish(false);
        ciTelemetry.stages.push({ name, status: 'failed', duration: (stage.duration / 1000).toFixed(2) });
        console.error(`${ANSI.RED}[STAGE FAIL]${ANSI.RESET} ${name}: ${err.message}`);
        // DO NOT throw
    }
}

async function main() {
    const summaryPath = path.join(rootDir, 'summary.json');
    const telemetryPath = path.join(rootDir, 'ci-results.json');

    const startTime = Date.now();
    let unitFailed = false;

    try {
        if (CI_MODE === 'ci') {
            await runReport(startTime);
            return;
        }

        console.log(renderBox("SpeakSharp CI Orchestrator"));

        // Stage 1: Preflight
        await runStage(1, "Preflight Checks", async () => {
            await runCommand('./scripts/preflight.sh', [], { label: 'PRE' });
        });

        // Stage 2: Quality
        if (!process.argv.includes('--skip-quality')) {
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
                    tasks.push(runCommand('pnpm', ['lint:ban-disable'], { label: 'BAN-DISABLE' }));
                }
                
                await Promise.all(tasks);
            });
        }

        // Stage 3: Testing
        if (!process.argv.includes('--skip-test')) {
            await runStage(3, "Test Execution", async () => {
                try {
                    const { execSync } = await import('child_process');
                    const impactOutput = execSync('node scripts/detect-impact-automation.mjs', { cwd: rootDir }).toString().trim();

                    // Run Unit Tests first (Independent of server)
                    try {
                        if (impactOutput === 'ALL' || process.argv.includes('ci-simulate')) {
                            fs.mkdirSync(path.join(rootDir, 'frontend', 'coverage'), { recursive: true });
                            // Leverage canonical package script
                            await runCommand('pnpm', ['run', 'test:unit:local'], { label: 'UNIT' });
                        } else if (impactOutput !== 'NONE') {
                            const testFiles = impactOutput.split(' ').filter(Boolean);
                            const vitestFiles = testFiles.filter(f => f.includes('.test.ts') || f.includes('.test.tsx'));
                            if (vitestFiles.length > 0) {
                                fs.mkdirSync(path.join(rootDir, 'frontend', 'coverage'), { recursive: true });
                                await runCommand('pnpm', ['run', 'test:unit:local', ...vitestFiles], { label: 'UNIT' });
                            }
                        }

                        // Guard: Check for unit test results
                        if (impactOutput !== 'NONE') {
                            const unitArtifact = path.join(rootDir, 'test-results', 'unit', 'results.json');
                            if (!fs.existsSync(unitArtifact)) {
                                throw new Error(`Unit test artifact not found: ${unitArtifact}`);
                            }
                        }
                    } catch (err) {
                        console.error(`${ANSI.RED}[UNIT] Unit tests failed, but proceeding to E2E...${ANSI.RESET}`);
                        unitFailed = true;
                    }

                    // Start Dev Server for E2E
                    console.log("[CI] Starting dev server for E2E...");
                    devServer = spawn('pnpm', ['dev'], {
                        cwd: rootDir,
                        shell: true,
                        env: { ...process.env, FORCE_COLOR: '1' }
                    });

                    devServer.stdout.on('data', (data) => {
                        data.toString().split('\n').forEach(line => {
                            if (line.trim()) {
                                const clean = line.replace(/\r/g, '');
                                if (clean.includes('error') || clean.includes('Error') || clean.includes('Ready in')) {
                                    console.log(`${ANSI.DIM}[VITE]${ANSI.RESET} ${clean}`);
                                }
                            }
                        });
                    });

                    devServer.stderr.on('data', (data) => {
                        data.toString().split('\n').forEach(line => {
                            if (line.trim()) {
                                const clean = line.replace(/\r/g, '');
                                console.error(`${ANSI.RED}[VITE][ERR]${ANSI.RESET} ${clean}`);
                            }
                        });
                    });

                    // Readiness Barrier
                    await waitForHTTP('http://localhost:5173');

                    // Compute workers for E2E
                    const workerCount = Math.min(Math.max(1, Math.floor(os.cpus().length * CI_CONFIG.WORKER_SCALING_RATIO)), CI_CONFIG.MAX_WORKERS);

                    // Run E2E Tests
                    if (impactOutput === 'ALL' || process.argv.includes('ci-simulate')) {
                        await runCommand('pnpm', [
                            'run', 'test:e2e:mock:headless',
                            `--workers=${workerCount}`,
                            '--reporter=./scripts/playwright-telemetry-reporter.mjs,json',
                            '--output=test-results/playwright-artifacts'
                        ], { label: 'E2E' });
                    } else if (impactOutput !== 'NONE') {
                        const testFiles = impactOutput.split(' ').filter(Boolean);
                        const playwrightFiles = [...new Set([...testFiles.filter(f => f.includes('.spec.ts')), ...ALWAYS_RUN_SPECS])];
                        if (playwrightFiles.length > 0) {
                            await runCommand('pnpm', [
                                'run', 'test:e2e:mock:headless',
                                `--workers=${workerCount}`,
                                '--reporter=./scripts/playwright-telemetry-reporter.mjs,json',
                                '--output=test-results/playwright-artifacts',
                                ...playwrightFiles
                            ], { label: 'E2E' });
                        }
                    }

                    // Guard: Check for E2E results
                    if (impactOutput !== 'NONE') {
                        const pwArtifact = path.join(rootDir, 'test-results', 'playwright-results.json');
                        if (!fs.existsSync(pwArtifact)) {
                            throw new Error(`E2E results artifact not found: ${pwArtifact}`);
                        }
                    }
                } finally {
                    // Cleanup Server
                    if (devServer) {
                        console.log("[CI] Stopping dev server...");
                        devServer.kill('SIGTERM');
                        devServer = null;
                    }

                    // Aggregate Telemetry: IPC first, then Artifact fallback (Required for 'pnpm run' compatibility)
                    if (!global.__CI_TELEMETRY__.playwright.passed && !global.__CI_TELEMETRY__.playwright.failed) {
                        try {
                            const pwPath = path.join(rootDir, 'test-results', 'playwright-results.json');
                            if (fs.existsSync(pwPath)) {
                                console.log('[CI TELEMETRY] Falling back to Playwright artifact parsing...');
                                const data = JSON.parse(fs.readFileSync(pwPath, 'utf8'));
                                // Simplistic mapping for the summary box
                                global.__CI_TELEMETRY__.playwright = {
                                    passed: data.stats?.expected || 0,
                                    failed: data.stats?.unexpected || 0,
                                    flaky: data.stats?.flaky || 0,
                                    skipped: data.stats?.skipped || 0
                                };
                            }
                        } catch (e) { }
                    }

                    if (!global.__CI_TELEMETRY__.vitest.passed && !global.__CI_TELEMETRY__.vitest.failed) {
                        try {
                            const vitestPath = path.join(rootDir, 'test-results', 'unit', 'results.json');
                            if (fs.existsSync(vitestPath)) {
                                console.log('[CI TELEMETRY] Falling back to Vitest artifact parsing...');
                                const data = JSON.parse(fs.readFileSync(vitestPath, 'utf8'));
                                global.__CI_TELEMETRY__.vitest = {
                                    passed: data.numPassedTests || 0,
                                    failed: data.numFailedTests || 0,
                                    total: data.numTotalTests || 0
                                };
                            }
                        } catch (e) { }
                    }

                    // Copy IPC telemetry (or fallback) to the legacy object
                    ciTelemetry.tests.playwright = global.__CI_TELEMETRY__.playwright;
                    ciTelemetry.tests.vitest = global.__CI_TELEMETRY__.vitest;
                }
            });
        }

        // Stage 4: Lighthouse (Requires Production Build)
        if (!process.argv.includes('--skip-lighthouse')) {
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
        await runStage(5, "Metrics & SQM", async () => {
            if (fs.existsSync(path.join(rootDir, 'scripts/run-metrics.sh'))) {
                await runCommand('./scripts/run-metrics.sh', [], { label: 'METRIC', env: { TOTAL_RUNTIME_SECONDS: Math.floor((Date.now() - startTime) / 1000) } });
                const artifact = path.join(rootDir, 'test-results', 'metrics.json');
                if (!fs.existsSync(artifact)) throw new Error(`Metrics artifact not found: ${artifact}`);
            }
            ciTelemetry.sqm = getSQMResults(rootDir, ciTelemetry);
        });

        // Compute runtime before summary
        ciTelemetry.totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

        const pipelineSuccess = !stagesList.some(s => s.status === 'FAILED');
        printFinalSummary(stagesList, ciTelemetry, pipelineSuccess);
        generateMarkdownReport(rootDir, ciTelemetry, pipelineSuccess);

    } catch (error) {
        console.error(`\n${ANSI.RED}${ANSI.BOLD}❌ CI Pipeline Failed: ${error.message}${ANSI.RESET}`);

        // Compute duration even on failure
        ciTelemetry.totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

        // Ensure test results are parsed if we failed during Test Execution stage but before parsing
        if (!ciTelemetry.tests.playwright.passed && !ciTelemetry.tests.playwright.failed) {
            const pwPath = path.join(rootDir, 'test-results', 'playwright-results.json');
            if (fs.existsSync(pwPath)) {
                try {
                    ciTelemetry.tests.playwright = JSON.parse(fs.readFileSync(pwPath));
                } catch (e) { }
            }
        }

        const vitestPath = path.join(rootDir, 'test-results', 'unit', 'results.json');
        if (fs.existsSync(vitestPath)) {
            ciTelemetry.tests.vitest = parseVitestResults(rootDir);
        }

        ciTelemetry.sqm = getSQMResults(rootDir, ciTelemetry);
        const pipelineSuccess = !stagesList.some(s => s.status === 'FAILED');
        printFinalSummary(stagesList, ciTelemetry, pipelineSuccess);
        generateMarkdownReport(rootDir, ciTelemetry, pipelineSuccess);

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

function printFinalSummary(stages, ciTelemetry, success = true) {
    const p = ciTelemetry.tests.playwright;
    const v = ciTelemetry.tests.vitest;
    const lh = ciTelemetry.lighthouse;
    const sqm = ciTelemetry.sqm;
    const runtime = ciTelemetry.totalDuration || '0';

    console.log('\n' + renderBox("SpeakSharp CI Audit", 44));
    console.log('────────────────────────\n');

    // Build
    console.log(`${ANSI.BOLD}Build${ANSI.RESET}`);
    console.log(`  Status:  ${success ? ANSI.GREEN + 'PASS' : ANSI.RED + 'FAIL'}${ANSI.RESET}\n`);

    // Unit Tests
    console.log(`${ANSI.BOLD}Unit Tests${ANSI.RESET}`);
    console.log(`  Passed:  ${ANSI.GREEN}${v.passed} / ${v.total}${ANSI.RESET}\n`);

    // E2E Tests (Playwright)
    console.log(`${ANSI.BOLD}E2E Tests${ANSI.RESET}`);
    if (p.shards && Object.keys(p.shards).length > 0) {
        Object.entries(p.shards).forEach(([id, data]) => {
            console.log(`  Shard ${id}: ${data.passed} / ${data.total}`);
        });
    }
    console.log(`  TOTAL:   ${ANSI.BOLD}${p.passed} / ${p.passed + p.failed}${ANSI.RESET}\n`);

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

    console.log('\n' + renderBox(`STATUS: ${success ? 'PASSED' : 'FAILED'}`, 44));
}

function generateMarkdownReport(rootDir, ciTelemetry, success) {
    const reportPath = path.join(rootDir, 'test-results', 'ci-audit.md');
    const p = ciTelemetry.tests.playwright;
    const v = ciTelemetry.tests.vitest;
    const lh = ciTelemetry.lighthouse;
    const sqm = ciTelemetry.sqm;

    const content = `# SpeakSharp CI Audit
> Generated at: ${new Date().toISOString()}

## 📊 Summary
**Status**: ${success ? '✅ PASSED' : '❌ FAILED'}
**SQM Score**: ${sqm?.score || 0} / 100
**Pipeline Runtime**: ${ciTelemetry.totalDuration || 0}s

## 🧪 Test Results
### Unit Tests
- **Passed**: ${v.passed} / ${v.total}

### E2E Tests (Playwright)
${p.shards && Object.keys(p.shards).length > 0 ? Object.entries(p.shards).map(([id, d]) => `- **Shard ${id}**: ${d.passed} / ${d.total}`).join('\n') : ''}
- **TOTAL**: ${p.passed} / ${p.passed + p.failed}

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

        printFinalSummary(stagesList, ciTelemetry, true);
        generateMarkdownReport(rootDir, ciTelemetry, true);

        // Write machine-readable telemetry
        const telemetryData = {
            ...ciTelemetry,
            status: ciTelemetry.tests.playwright.failed === 0 ? 'success' : 'failed',
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
