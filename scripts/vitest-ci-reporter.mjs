import fs from 'fs';
import path from 'path';

/**
 * Vitest CI Reporter
 * Emits telemetry directly to the orchestrator via IPC.
 */
export default class VitestCIReporter {
    onFinished(files) {
        const countTests = (tasks, stats, ancestors = []) => {
            tasks.forEach(task => {
                const titlePath = [...ancestors, task.name].filter(Boolean);
                if (task.type === 'test') {
                    if (task.result?.state === 'pass') stats.passed++;
                    else if (task.result?.state === 'fail') {
                        stats.failed++;
                        const errors = task.result?.errors || [];
                        stats.failures.push({
                            title: titlePath.join(' > '),
                            file: task.file?.filepath || task.file?.name || '',
                            error: errors
                                .map(error => error?.message || String(error))
                                .filter(Boolean)
                                .join('\n')
                                .slice(0, 1000),
                        });
                    }
                    stats.total++;
                    stats.totalDuration += (task.result?.duration || 0);
                } else if (task.tasks) {
                    countTests(task.tasks, stats, titlePath);
                }
            });
        };

        const stats = { passed: 0, failed: 0, total: 0, totalDuration: 0, failures: [] };
        files.forEach((f) => {
            if (f.tasks) countTests(f.tasks, stats, [f.name || f.filepath].filter(Boolean));
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
