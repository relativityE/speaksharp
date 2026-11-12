import fs from 'fs';
import path from 'path';

/**
 * Vitest CI Reporter
 * Emits telemetry directly to the orchestrator via IPC.
 */
export default class VitestCIReporter {
    onFinished(files) {
        const taskFile = (task) =>
            task.file?.filepath || task.file?.name || task.filepath || task.name || '';

        const taskErrorMessage = (task) => {
            const errors = [
                ...(task.result?.errors || []),
                ...(task.result?.error ? [task.result.error] : []),
            ];

            return errors
                .map(error => error?.message || error?.stack || String(error))
                .filter(Boolean)
                .join('\n')
                .slice(0, 1000);
        };

        const recordFailure = (task, stats, titlePath, type = 'test') => {
            stats.failed++;
            if (type !== 'test') stats.failedSuites++;
            stats.failures.push({
                title: titlePath.join(' > '),
                file: taskFile(task),
                type,
                error: taskErrorMessage(task),
            });
        };

        const countTests = (tasks, stats, ancestors = []) => {
            tasks.forEach(task => {
                const titlePath = [...ancestors, task.name].filter(Boolean);
                if (task.type === 'test') {
                    if (task.result?.state === 'pass') {
                        stats.passed++;
                        if (Number(task.meta?.assertionCalls) > 0) stats.asserted++;
                    }
                    else if (task.result?.state === 'fail') recordFailure(task, stats, titlePath);
                    else stats.pending++;
                    stats.total++;
                    stats.totalDuration += (task.result?.duration || 0);
                } else {
                    const failuresBeforeChildren = stats.failed;
                    countTests(task.tasks || [], stats, titlePath);
                    const hasChildFailure = stats.failed > failuresBeforeChildren;

                    if (task.result?.state === 'fail' && !hasChildFailure) {
                        recordFailure(task, stats, titlePath, task.type || 'suite');
                        stats.total++;
                        stats.totalDuration += (task.result?.duration || 0);
                    }
                }
            });
        };

        const stats = { passed: 0, asserted: 0, failed: 0, pending: 0, failedSuites: 0, total: 0, totalDuration: 0, failures: [] };
        const passedFiles = new Set();
        /**
         * #1430 P1 — WHICH FILES SKIPPED SOMETHING, so a release path cannot be signed off on a
         * neighbour's passing test.
         *
         * `passedFiles` admits a file as soon as ONE test in it asserted. A manifest-listed
         * release-path file could therefore contain one passing test and a SKIPPED casualty, land in
         * `testFiles`, and satisfy the meaningful-coverage requirement without the acceptance criterion
         * ever having run. Recording the skip per file lets the validator reject that precisely,
         * instead of rejecting every skip in the suite — most of which are not on a release path.
         */
        const skippedFiles = new Set();
        files.forEach((f) => {
            const assertedBefore = stats.asserted;
            const pendingBefore = stats.pending;
            if (f.tasks) {
                const failuresBeforeChildren = stats.failed;
                countTests(f.tasks, stats, [f.name || f.filepath].filter(Boolean));

                if (f.result?.state === 'fail' && stats.failed === failuresBeforeChildren) {
                    recordFailure(f, stats, [f.name || f.filepath].filter(Boolean), f.type || 'suite');
                    stats.total++;
                    stats.totalDuration += (f.result?.duration || 0);
                }
            } else if (f.result?.state === 'fail') {
                recordFailure(f, stats, [f.name || f.filepath].filter(Boolean), f.type || 'suite');
                stats.total++;
                stats.totalDuration += (f.result?.duration || 0);
            }
            if (stats.asserted > assertedBefore) passedFiles.add(f);
            if (stats.pending > pendingBefore) skippedFiles.add(f);
        });

        // Ensure correct IPC discriminator handling
        if (process.send) {
            process.send({
                type: 'TELEMETRY',
                tool: 'vitest',
                data: stats
            });
        }

        // Fix 1: Restore artifact outputs for Stage 5 compatibility
        const rootDir = process.cwd();
        const resultsDir = path.join(rootDir, 'test-results', 'unit');
        if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

        const normalizePath = (file) => {
            const raw = file.filepath || file.name || file.file?.filepath || file.file?.name;
            if (typeof raw !== 'string' || raw.trim() === '') return null;
            const normalized = path.isAbsolute(raw) ? path.relative(rootDir, raw) : raw;
            return normalized.replaceAll(path.sep, '/').replace(/^\.\//, '');
        };
        const skippedTestFiles = [...new Set([...skippedFiles]
            .map(normalizePath)
            .filter((file) => file && !file.startsWith('../')))];

        const testFiles = [...new Set([...passedFiles].map((file) => {
            const raw = file.filepath || file.name || file.file?.filepath || file.file?.name;
            if (typeof raw !== 'string' || raw.trim() === '') return null;
            const normalized = path.isAbsolute(raw) ? path.relative(rootDir, raw) : raw;
            return normalized.replaceAll(path.sep, '/').replace(/^\.\//, '');
        }).filter((file) => file && !file.startsWith('../')))];

        const bridge = {
            numPassedTests: stats.passed,
            numAssertedTests: stats.asserted,
            numFailedTests: stats.failed,
            numFailedSuites: stats.failedSuites,
            numTotalTests: stats.total,
            totalDuration: stats.totalDuration,
            numPendingTests: stats.pending,
            testFiles,
            skippedTestFiles,
            failures: stats.failures,
        };
        fs.writeFileSync(path.join(resultsDir, 'results.json'), JSON.stringify(bridge, null, 2));

        // Also write to the legacy unit-metrics.json if expected by other tools
        fs.writeFileSync(path.join(rootDir, 'unit-metrics.json'), JSON.stringify(bridge, null, 2));

        /*
         * #1837 — EVERY FILE THIS RUN EXECUTED, WITH ITS MEASURED COST. A separate file, not a field of
         * unit-metrics.json, so the evidence schema above is unchanged.
         *
         * Two consumers. `scripts/ci-unit-partition-check.mjs` proves the four shards together executed
         * every discovered test file exactly once, which is what makes a custom shard sequencer safe.
         * `scripts/ci-unit-durations-refresh.mjs` turns these costs into the scheduling hints the
         * sequencer reads. The cost is the whole per-file wall in its fork (prepare, environment, setup,
         * import/collect and tests), not just the tests, because that is what a shard actually spends.
         */
        const finiteMs = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
        const executedFiles = files.map((f) => ({
            path: normalizePath(f),
            projectName: typeof f.projectName === 'string' ? f.projectName : '',
            state: f.result?.state ?? 'unknown',
            durationMs: Math.round(finiteMs(f.prepareDuration) + finiteMs(f.environmentLoad)
                + finiteMs(f.setupDuration) + finiteMs(f.collectDuration) + finiteMs(f.result?.duration)),
        })).filter((entry) => entry.path && !entry.path.startsWith('../'));
        fs.writeFileSync(path.join(rootDir, 'unit-file-timings.json'), JSON.stringify({
            schemaVersion: 1,
            kind: 'vitest-executed-files',
            files: executedFiles,
        }, null, 2));
    }
}
