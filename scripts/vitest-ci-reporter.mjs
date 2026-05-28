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
                    if (task.result?.state === 'pass') stats.passed++;
                    else if (task.result?.state === 'fail') recordFailure(task, stats, titlePath);
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

        const stats = { passed: 0, failed: 0, failedSuites: 0, total: 0, totalDuration: 0, failures: [] };
        files.forEach((f) => {
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

        const bridge = {
            numPassedTests: stats.passed,
            numFailedTests: stats.failed,
            numFailedSuites: stats.failedSuites,
            numTotalTests: stats.total,
            totalDuration: stats.totalDuration,
            numPendingTests: 0,
            failures: stats.failures,
        };
        fs.writeFileSync(path.join(resultsDir, 'results.json'), JSON.stringify(bridge, null, 2));

        // Also write to the legacy unit-metrics.json if expected by other tools
        fs.writeFileSync(path.join(rootDir, 'unit-metrics.json'), JSON.stringify(bridge, null, 2));
    }
}
