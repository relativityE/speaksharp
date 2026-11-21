// Read-only CI adapter. Only a platform push event plus independently fetched
// predecessor and GitHub authority may turn this comparison into an empty diff.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAIN = 'refs/heads/main';
const SHA = /^(?!0{40}$)[a-f0-9]{40}$/;
const REPO = 'relativityE/speaksharp';

export async function acquireVerifiedSquash(root, env = process.env) {
    if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== MAIN || env.GITHUB_REPOSITORY !== REPO) return null;
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    if (event.forced !== true) return null;
    const { before, after } = event;
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 120_000 }).trim();
    if (event.ref !== MAIN || event.repository?.full_name !== REPO || event.created !== false || event.deleted !== false
        || !SHA.test(before ?? '') || !SHA.test(after ?? '') || before === after
        || before !== env.TEST_EFFICACY_EVENT_BASE || after !== env.GITHUB_SHA
        || git('rev-parse', 'HEAD') !== after) throw new Error('Unbound forced-main push');
    // Preserve existing comparison on a forced event that is still an ancestor.
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', before, after], { cwd: root });
    if (ancestor.status === 0) return null;
    // After a force push checkout(fetch-depth:0) need not contain the displaced
    // main tip. Fetch that exact object through the configured GitHub origin.
    if (ancestor.status !== 1) {
        git('fetch', '--no-tags', '--no-write-fetch-head', 'origin', before);
        const older = spawnSync('git', ['merge-base', '--is-ancestor', before, after], { cwd: root });
        if (older.status === 0) return null;
        if (older.status !== 1) throw new Error('Displaced main unavailable');
    }
    const tree = git('rev-parse', `${before}^{tree}`);
    if (tree !== git('rev-parse', `${after}^{tree}`)) throw new Error('Forced main tree differs');

    const isolated = mkdtempSync(join(tmpdir(), 'trusted-main-squash-'));
    try {
        // Run the reviewed predecessor bytes, not the candidate checkout.
        const archive = execFileSync('git', ['archive', before, 'scripts'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
        execFileSync('tar', ['-xf', '-', '-C', isolated], { input: archive });
        const verifier = join(isolated, 'scripts/lib/releaseSquashTrust.mjs');
        const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', `
            import {readFileSync} from 'node:fs';
            import {pathToFileURL} from 'node:url';
            const {acquireManualSquashTrust} = await import(pathToFileURL(process.argv[1]).href);
            const event = JSON.parse(readFileSync(0, 'utf8'));
            const result = await acquireManualSquashTrust({eventName:'push', event, token:process.env.SQUASH_TRUST_TOKEN});
            process.stdout.write(JSON.stringify(result));
        `, verifier], { cwd: isolated, input: JSON.stringify(event), encoding:'utf8', timeout:65_000,
            env: { SQUASH_TRUST_TOKEN: env.SQUASH_TRUST_TOKEN ?? '' } }));
        if (!result.ok) throw new Error(`Manual squash verification HOLD: ${result.reason}`);
        if (result.beforeSha !== before || result.afterSha !== after || result.treeSha !== tree) throw new Error('Manual squash Git identity differs');
        return result;
    } finally {
        rmSync(isolated, { recursive: true, force: true });
    }
}


export async function resolveVerifiedSquashComparison(root, env = process.env) {
    const verified = await acquireVerifiedSquash(root, env);
    return verified ? { base: verified.afterSha, head: verified.afterSha } : null;
}

export function manualSquashAuditReceipt(verified, env = process.env) {
    const positive = n => Number.isSafeInteger(n) && n > 0;
    if (!verified?.ok || !SHA.test(verified.beforeSha ?? '') || !SHA.test(verified.afterSha ?? '')
        || verified.beforeSha === verified.afterSha || !SHA.test(verified.treeSha ?? '')
        || verified.afterSha !== env.GITHUB_SHA || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '')
        || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? '') || !positive(verified.priorCiRunId)
        || !positive(verified.priorCiAttempt) || !positive(verified.pushActivityId)
        || typeof verified.approvalCommentId !== 'string' || !verified.approvalCommentId
        || !/^refs\/tags\/v/.test(verified.baselineRef ?? '') || !SHA.test(verified.baselineSha ?? '')) {
        throw new Error('Manual squash audit identity incomplete');
    }
    return {
        schemaVersion: 1, kind: 'manual-unchanged-tree-squash-verification',
        from: { commit: verified.beforeSha, runId: verified.priorCiRunId, attempt: verified.priorCiAttempt,
            review: 'previous-main-independent-review-job-verified' },
        to: { commit: verified.afterSha, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
            review: 'no-new-pr-review-claimed' },
        tree: verified.treeSha, approvalCommentId: verified.approvalCommentId, pushActivityId: verified.pushActivityId,
        baseline: { ref: verified.baselineRef, commit: verified.baselineSha },
    };
}
