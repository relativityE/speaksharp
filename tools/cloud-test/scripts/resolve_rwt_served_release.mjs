// Runtime identity only: this adapter grants no authority to run a live test or delete data.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import { pathToFileURL } from 'node:url';
import { discoverServedRelease, verifyServedRelease } from '../../../scripts/production-release-policy.mjs';
import { CANONICAL_PRODUCTION_ORIGIN } from '../../../scripts/lib/releaseEvidenceEligibility.mjs';
import binding from './validate_rwt_release_binding.cjs';

const SHA = /^[0-9a-f]{40}$/;
const ID = /^[1-9][0-9]*$/;
function selection(env) {
    if (env.BASE_URL !== `${CANONICAL_PRODUCTION_ORIGIN}/` && env.BASE_URL !== CANONICAL_PRODUCTION_ORIGIN) throw Error('CANONICAL_PRODUCTION_REQUIRED');
    if (env.GITHUB_REPOSITORY !== 'relativityE/speaksharp' || env.GITHUB_REF !== 'refs/heads/main'
        || !SHA.test(env.GITHUB_SHA || '') || !ID.test(env.GITHUB_RUN_ID || '') || !ID.test(env.GITHUB_RUN_ATTEMPT || '')) throw Error('TRUSTED_RUN_BINDING_REQUIRED');
    if (!binding.SPECS.includes(env.DIAGNOSTIC_SPEC) || !env.DIAGNOSTIC_GREP?.trim()
        || env.SELECTED_GATE !== 'gate-3-dast' || (env.COMPARISON_CELL || 'none') !== 'none' || env.PAID_LAUNCH) throw Error('BOUNDED_RWT_SELECTION_REQUIRED');
    return { sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
        spec: env.DIAGNOSTIC_SPEC, grep: env.DIAGNOSTIC_GREP };
}

export async function resolveRwtServedRelease(env = process.env, options = {}) {
    const selected = selection(env);
    const served = await discoverServedRelease(options.fetchImpl, options.readGithubImpl);
    if (!served.allowed) throw Error(`SERVED_RELEASE_${served.reason}`);
    // A legacy explicit pin is an assertion, never a fallback when discovery fails.
    if (env.DIAGNOSTIC_RELEASE && env.DIAGNOSTIC_RELEASE !== served.releaseSha) throw Error('EXPLICIT_RELEASE_DIFFERS');
    const compatibility = binding.verify({ ...env, DIAGNOSTIC_RELEASE: served.releaseSha }, options.cwd);
    return Object.freeze({ schemaVersion: 1, kind: 'rwt-observed-release-not-run-authorization',
        ...selected, servedSha: served.releaseSha, compatibility: compatibility.kind });
}

// Invoke again immediately before the first live write. A changed deployment is a HOLD,
// never a reason to silently rebind an already-authorized attempt to a different product.
export async function verifyRwtServedRelease(receipt, env = process.env, options = {}) {
    const selected = selection(env);
    if (!receipt || receipt.schemaVersion !== 1 || receipt.kind !== 'rwt-observed-release-not-run-authorization'
        || !SHA.test(receipt.servedSha || '') || Object.entries(selected).some(([key, value]) => receipt[key] !== value)) throw Error('RWT_RELEASE_RECEIPT_DIFFERS');
    if (env.DIAGNOSTIC_RELEASE && env.DIAGNOSTIC_RELEASE !== receipt.servedSha) throw Error('EXPLICIT_RELEASE_DIFFERS');
    binding.verify({ ...env, DIAGNOSTIC_RELEASE: receipt.servedSha }, options.cwd);
    const served = await verifyServedRelease(receipt.servedSha, options.fetchImpl);
    if (!served.allowed) throw Error(`SERVED_RELEASE_${served.reason}`);
    return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const file = process.env.RWT_RELEASE_BINDING_FILE;
        if (!file) throw Error('RWT_RELEASE_RECEIPT_PATH_REQUIRED');
        let receipt;
        if (process.argv[2] === 'resolve') {
            receipt = await resolveRwtServedRelease();
            writeFileSync(file, `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: 'wx' });
            if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `release_sha=${receipt.servedSha}\n`);
        } else if (process.argv[2] === 'verify') {
            receipt = await verifyRwtServedRelease(JSON.parse(readFileSync(file, 'utf8')));
        } else throw Error('RWT_RELEASE_COMMAND_REQUIRED');
        console.log(JSON.stringify(receipt));
    } catch (error) {
        console.error(`HOLD: ${error.message}`);
        process.exitCode = 1;
    }
}
