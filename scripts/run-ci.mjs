import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const ALWAYS_RUN_SPECS = [
    'tests/e2e/auth.e2e.spec.ts',
    'tests/e2e/diag-private-stt.e2e.spec.ts'
];

async function runCommand(command, args, options = {}) {
    const { label = 'CMD', timeout = 600000, env = {} } = options;
    const controller = new AbortController();
    const { signal } = controller;

    const timer = setTimeout(() => {
        console.error(`[${label}] ⏱️  Timed out after ${timeout / 1000}s. Aborting...`);
        controller.abort();
    }, timeout);

    return new Promise((resolve, reject) => {
        console.log(`[${label}] 🚀 Executing: ${command} ${args.join(' ')}`);
        const child = spawn(command, args, {
            cwd: rootDir,
            shell: true,
            signal,
            env: { ...process.env, ...env, FORCE_COLOR: '1' }
        });

        child.stdout.on('data', (data) => {
            data.toString().split('\n').filter(Boolean).forEach(line => {
                console.log(`[${label}] ${line}`);
            });
        });

        child.stderr.on('data', (data) => {
            data.toString().split('\n').filter(Boolean).forEach(line => {
                console.error(`[${label}][ERR] ${line}`);
            });
        });

        child.on('close', (code) => {
            clearTimeout(timer);
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

async function main() {
    const summaryPath = path.join(rootDir, 'summary.json');
    const results = {
        status: "in-progress",
        timestamp: new Date().toISOString(),
        vitestFilesRun: 0,
        playwrightFilesRun: 0
    };

    try {
        console.log("🛠️ Starting Canonical CI Migration Pipeline...");

        // Stage 1: Preflight
        console.log("\n✅ [1/5] Running Preflight Checks...");
        await runCommand('./scripts/preflight.sh', [], { label: 'PREFLIGHT' });

        // Stage 2: Quality (TIA-VAL, Lint, Typecheck)
        console.log("\n✅ [2/5] Running Code Quality Checks...");
        await runCommand('node', ['scripts/ci/impact-validator.mjs'], { label: 'TIA-VAL' });
        await Promise.all([
            runCommand('pnpm', ['lint', '--quiet'], { label: 'LINT' }),
            runCommand('pnpm', ['typecheck'], { label: 'TYPECHECK' })
        ]);

        // Stage 3: Test Impact Analysis & Execution
        console.log("\n✅ [3/5] Running Test Impact Analysis & Execution...");
        const { execSync } = await import('child_process');
        const impactOutput = execSync('node scripts/detect-impact.mjs', { cwd: rootDir }).toString().trim();

        if (impactOutput === 'NONE') {
            console.log("✅ No impact detected. Skipping targeted test runs.");
        } else if (impactOutput === 'ALL') {
            console.log("🚨 Core configuration changes detected. Running full CI suite.");
            // Run all unit tests
            await runCommand('pnpm', ['test:unit:local'], { label: 'VITEST-ALL', timeout: 300000 });
            // Run all E2E tests
            await runCommand('pnpm', ['test:e2e:mock:headless'], { label: 'PLAYWRIGHT-ALL', timeout: 600000 });
            results.fullRun = true;
        } else {
            const testFiles = impactOutput.split(' ').filter(Boolean);
            const vitestFiles = testFiles.filter(f => f.includes('.test.ts') || f.includes('.test.tsx'));
            const playwrightFiles = [...new Set([...testFiles.filter(f => f.includes('.spec.ts')), ...ALWAYS_RUN_SPECS])];

            if (vitestFiles.length > 0) {
                await runCommand('npx', ['vitest', 'run', ...vitestFiles, '--config', 'frontend/vitest.config.mjs'], { label: 'VITEST' });
                results.vitestFilesRun = vitestFiles.length;
            }

            if (playwrightFiles.length > 0) {
                await runCommand('pnpm', ['build:test'], { label: 'BUILD-TEST' });
                await runCommand('npx', ['playwright', 'test', ...playwrightFiles], { label: 'PLAYWRIGHT' });
                results.playwrightFilesRun = playwrightFiles.length;
            }
        }

        // Stage 4: Lighthouse CI
        console.log("\n✅ [4/5] Running Lighthouse CI...");
        await runCommand('node', ['scripts/generate-lhci-config.js'], { label: 'LHCI-CFG' });
        await runCommand('npx', ['lhci', 'autorun', '--config=lighthouserc.json'], { label: 'LHCI', env: { NODE_NO_WARNINGS: '1' } });
        await runCommand('node', ['scripts/process-lighthouse-report.js'], { label: 'LHCI-PROC' });

        // Stage 5: Metrics
        console.log("\n✅ [5/5] Generating SQM Metrics...");
        if (fs.existsSync(path.join(rootDir, 'scripts/run-metrics.sh'))) {
            await runCommand('./scripts/run-metrics.sh', [], { label: 'METRICS-GEN' });
        }
        await runCommand('node', ['scripts/print-metrics.mjs'], { label: 'METRICS-PRT' });

        results.status = "success";
        fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
        console.log("\n🎊 CI Orchestrator Execution finalized successfully!");

    } catch (error) {
        console.error(`\n❌ CI Orchestrator Failed: ${error.message}`);
        results.status = "failed";
        results.error = error.message;
        fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
        process.exit(1);
    }
}

main();
