import fs from 'fs';
import path from 'path';

/**
 * Vitest CI Reporter
 * Emits telemetry directly to the orchestrator via IPC.
 */
export default class VitestCIReporter {
    onFinished(files) {
        const countTests = (tasks, stats) => {
            tasks.forEach(task => {
                if (task.type === 'test') {
                    if (task.result?.state === 'pass') stats.passed++;
                    else if (task.result?.state === 'fail') stats.failed++;
                    stats.total++;
                } else if (task.tasks) {
                    countTests(task.tasks, stats);
                }
            });
        };

        const stats = { passed: 0, failed: 0, total: 0 };
        files.forEach((f) => {
            if (f.tasks) countTests(f.tasks, stats);
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
            numPendingTests: 0
        };
        fs.writeFileSync(path.join(resultsDir, 'results.json'), JSON.stringify(bridge, null, 2));

        // Also write to the legacy unit-metrics.json if expected by other tools
        fs.writeFileSync(path.join(rootDir, 'unit-metrics.json'), JSON.stringify(bridge, null, 2));
    }
}
