import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

try {
    console.log("🔍 Running Test Impact Analysis...");
    const impactOutput = execSync('node scripts/detect-impact.mjs', { cwd: rootDir }).toString().trim();

    if (impactOutput === 'NONE') {
        console.log("✅ No impact detected on testable code. Skipping E2E test runs.");
        console.log("   (Unit tests should still be run separately for component-level changes if required)");
        process.exit(0);
    }

    if (impactOutput === 'ALL') {
        console.log("🚨 Core configuration changes detected. Running full CI suite.");
        execSync('pnpm ci:full:local', { cwd: rootDir, stdio: 'inherit' });
        process.exit(0);
    }

    console.log(`🎯 Impact detected! Reserving specifically targeted test files:`);

    // Separate into vitest and playwright
    const files = impactOutput.split(' ').filter(Boolean);
    const vitestFiles = files.filter(f => f.includes('.test.ts') || f.includes('.test.tsx'));
    const playwrightFiles = files.filter(f => f.includes('.e2e.spec.ts') || f.includes('.live.spec.ts') || f.includes('.canary.spec.ts'));

    if (vitestFiles.length > 0) {
        console.log("\n🧪 Running Vitest Impact Suite:");
        console.log(vitestFiles.map(f => `  - ${f}`).join('\n'));
        execSync(`npx vitest run ${vitestFiles.join(' ')} --config frontend/vitest.config.mjs`, { cwd: rootDir, stdio: 'inherit' });
    }

    if (playwrightFiles.length > 0) {
        console.log("\n🎭 Running Playwright Impact Suite (HEADLESS MOCK MODE):");
        console.log(playwrightFiles.map(f => `  - ${f}`).join('\n'));
        // Make sure we run these specifically in the E2E mock context
        execSync(`pnpm build:test && npx playwright test ${playwrightFiles.join(' ')}`, { cwd: rootDir, stdio: 'inherit' });
    }

    console.log("\n✅ Impact Test Execution finalized securely!");

    // Output a summary.json for Agent parsing
    import('fs').then(fs => {
        fs.writeFileSync(path.join(rootDir, 'summary.json'), JSON.stringify({
            status: "success",
            vitestFilesRun: vitestFiles.length,
            playwrightFilesRun: playwrightFiles.length,
            timestamp: new Date().toISOString()
        }, null, 2));
    });

} catch (error) {
    console.error("❌ Test Impact Execution Failed! One or more tests did not pass.");
    import('fs').then(fs => {
        fs.writeFileSync(path.join(rootDir, 'summary.json'), JSON.stringify({
            status: "failed",
            error: error.message,
            timestamp: new Date().toISOString()
        }, null, 2));
    });
    process.exit(1);
}
