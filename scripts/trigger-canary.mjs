/**
 * Canary Technical Bridge: Workflow Dispatch Utility
 * 
 * Purpose: Architect-level bridge to trigger GitHub Actions Canary workflows
 * from the local environment, ensuring secret awareness and providing
 * observability into the remote execution.
 * 
 * DESIGN RATIONALE:
 * 1. Logic Parity: Mirrored after ARCHITECTURE.md manual steps but automated for speed.
 * 2. Secret Awareness: Checks for CANARY_PASSWORD in .env.development to ensure
 *    the user is prepared before triggering.
 * 3. Observability: Automatically fetches and returns the GitHub Actions run URL.
 * 
 * Usage:
 *   node scripts/trigger-canary.mjs
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

// --- Configuration ---
const WORKFLOW_NAME = "Production Canary Smoke Test";
const REPO_ROOT = process.cwd();
const ENV_PATH = path.join(REPO_ROOT, '.env.development');

/**
 * ANSI colors for professional logging
 */
const COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m"
};

function log(msg, color = COLORS.reset) {
    console.log(`${color}${msg}${COLORS.reset}`);
}

/**
 * Check for secret in .env.development
 */
function checkSecrets() {
    if (!existsSync(ENV_PATH)) {
        log(`⚠️  Warning: .env.development not found at ${ENV_PATH}`, COLORS.yellow);
        return false;
    }

    const content = readFileSync(ENV_PATH, 'utf8');
    const hasPassword = content.includes('CANARY_PASSWORD=');

    if (!hasPassword) {
        log("⚠️  Warning: CANARY_PASSWORD not found in .env.development.", COLORS.yellow);
        log("   Canary tests depend on this secret being synced in the remote DB.", COLORS.cyan);
    } else {
        log("✅ CANARY_PASSWORD detected in .env.development.", COLORS.green);
    }
    return true;
}

/**
 * Main execution
 */
async function main() {
    log("🚀 Triggering Canary Infrastructure Bridge...", COLORS.bright);

    // 1. Secret Check
    checkSecrets();

    // 2. GH CLI Check
    try {
        execSync('gh --version', { stdio: 'ignore' });
    } catch (e) {
        log("❌ Error: GitHub CLI (gh) is not installed. Please install it to use this bridge.", COLORS.red);
        process.exit(1);
    }

    // 3. Trigger Workflow
    log(`📡 Dispatching workflow: "${WORKFLOW_NAME}"...`, COLORS.cyan);
    try {
        execSync(`gh workflow run "${WORKFLOW_NAME}" --ref main`, { stdio: 'inherit' });
        log("✅ Workflow dispatch successful.", COLORS.green);
    } catch (e) {
        log("❌ Failed to trigger workflow. Ensure you have the necessary permissions.", COLORS.red);
        process.exit(1);
    }

    // 4. Observability: Get the Run URL
    log("⏳ Fetching run details...", COLORS.reset);
    try {
        // Wait a moment for the run to be registered
        await new Promise(resolve => setTimeout(resolve, 3000));

        const runId = execSync(`gh run list --workflow=canary.yml --limit 1 --json databaseId --jq '.[0].databaseId'`, { encoding: 'utf8' }).trim();
        const runUrl = execSync(`gh run view ${runId} --web`, { stdio: 'ignore' });

        log(`\n🔗 View progress here:`, COLORS.bright);
        log(`https://github.com/relativityE/speaksharp/actions/runs/${runId}`, COLORS.cyan);
    } catch (e) {
        log("⚠️  Workflow triggered but failed to fetch run URL. Check GitHub Actions manually.", COLORS.yellow);
    }

    log("\n🎯 Bridge execution complete.", COLORS.bright);
}

main();
