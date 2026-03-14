import fs from 'fs';
import path from 'path';

/**
 * Vitest CI Reporter
 * Emits telemetry directly to the orchestrator via IPC.
 */
export default class VitestCIReporter {
    onFinished(files) {
        const stats = files.reduce((acc, f) => {
            const state = f.result?.state;
            if (state === 'pass') acc.passed++;
            else if (state === 'fail') acc.failed++;
            acc.total++;
            return acc;
        }, { passed: 0, failed: 0, total: 0 });

        // Fix: Another Small Telemetry Bug (IPC Discriminator)
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
