/**
 * Soak Test Technical Bridge: Workflow Dispatch Utility
 * 
 * Purpose: Architect-level bridge to trigger GitHub Actions Soak Test workflows
 * from the local environment.
 * 
 * DESIGN RATIONALE:
 * 1. Remote Execution: Offloads heavy concurrency/load testing to GitHub infrastructure.
 * 2. Secret Access: Leverages GitHub Secrets (SOAK_TEST_PASSWORD) securely.
 * 3. Observability: Automatically fetches and returns the GitHub Actions run URL.
 * 
 * Usage:
 *   node scripts/trigger-soak.mjs [free_count] [pro_count]
 *   Example: node scripts/trigger-soak.mjs 7 3
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// --- Configuration ---
const WORKFLOW_NAME = "Soak Test";
const REPO_ROOT = process.cwd();

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
 * Main execution
 */
async function main() {
    log("🚀 Triggering Soak Test Infrastructure Bridge...", COLORS.bright);

    // 1. Parse Arguments
    const args = process.argv.slice(2);
    // Filter out flags to find numeric arguments
    const numericArgs = args.filter(arg => !arg.startsWith('--'));

    // Default to 7 Free / 3 Pro (Matching constants.ts defaults)
    const freeCount = numericArgs[0] || '7';
    const proCount = numericArgs[1] || '3';

    log(`   Config: ${freeCount} Free Users, ${proCount} Pro Users`, COLORS.cyan);

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
        // Construct inputs
        const inputs = `-f num_free_users=${freeCount} -f num_pro_users=${proCount}`;
        execSync(`gh workflow run "${WORKFLOW_NAME}" --ref main ${inputs}`, { stdio: 'inherit' });
        log("✅ Workflow dispatch successful.", COLORS.green);
    } catch (e) {
        log("❌ Failed to trigger workflow. Ensure you have the necessary permissions.", COLORS.red);
        process.exit(1);
    }

    // 4. Observability: Get the Run URL
    log("⏳ Fetching run details...", COLORS.reset);
    let runId;
    try {
        // Wait a moment for the run to be registered
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Get the latest run ID for this workflow
        runId = execSync(`gh run list --workflow=soak-test.yml --limit 1 --json databaseId --jq '.[0].databaseId'`, { encoding: 'utf8' }).trim();

        if (!runId) {
            throw new Error("Could not retrieve run ID");
        }

        log(`\n🔗 View progress here:`, COLORS.bright);
        const url = `https://github.com/relativityE/speaksharp/actions/runs/${runId}`;
        log(url, COLORS.cyan);

        // Try to open in browser if on macOS
        try {
            execSync(`open ${url}`);
        } catch (e) {
            // Ignore if open fails
        }

    } catch (e) {
        log("⚠️  Workflow triggered but failed to fetch run URL. Check GitHub Actions manually.", COLORS.yellow);
        return;
    }

    // 5. Poll for completion if --wait is requested
    if (process.argv.includes('--wait')) {
        log(`\n⏳ Waiting for run #${runId} to complete...`, COLORS.yellow);

        let status = 'queued';
        let conclusion = '';

        while (status !== 'completed') {
            await new Promise(r => setTimeout(r, 10000)); // Poll every 10s

            try {
                const res = execSync(`gh run view ${runId} --json status,conclusion`, { encoding: 'utf8' });
                const data = JSON.parse(res);
                status = data.status;
                conclusion = data.conclusion;

                process.stdout.write(`\r📌 Status: ${status} ${conclusion ? `(${conclusion})` : ''}   `);
            } catch (e) {
                // Ignore transient network errors
            }
        }

        process.stdout.write('\n');

        if (conclusion === 'success') {
            log("\n✅ Soak test PASSED", COLORS.green);
        } else {
            log(`\n❌ Soak test FAILED (Conclusion: ${conclusion})`, COLORS.red);
            process.exit(1);
        }
    } else {
        log("\n💡 Tip: Use --wait flag to monitor completion", COLORS.reset);
    }

    log("\n🎯 Bridge execution complete.", COLORS.bright);
}

main();
