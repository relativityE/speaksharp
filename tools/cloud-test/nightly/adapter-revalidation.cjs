"use strict";
// Nightly AHT suite: may the selected harness adapters, inspected at `sourceSha`, be reused against a newer served release?
// (Sam, 16 Nov.) Only when EVERY inspected input in adapter-inputs.json (the files defining the adapters' selectors, data
// attributes and copy, their transitive imports, the build configuration and the lockfile) is byte-identical at the served
// sha. A changed, missing or unreadable input refuses it and names the input; an unresolved dependency in the manifest refuses
// every case. Refusal only: an admissible verdict re-qualifies the inspection, it never establishes a product PASS. Nothing
// here edits or re-pins the sealed adapters; a later reviewed change would consume this verdict.
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const MANIFEST = require('./adapter-inputs.json');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FULL_SHA = /^[0-9a-f]{40}$/;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
/** Git blob bytes of `file` at full commit `sha` in the repository at `root` (this checkout by default); throws when absent. */
const gitBlob = (sha, file, root = REPO_ROOT) => execFileSync('git', ['show', `${sha}:${file}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });

/** `{ admissible, refused: [{ path, reason }] }` for reusing the inspection at `servedSha`. */
function revalidate({ servedSha, readBlob = gitBlob, manifest = MANIFEST }) {
    if (typeof servedSha !== 'string' || !FULL_SHA.test(servedSha))
        return { admissible: false, refused: [{ path: null, reason: 'the served release is not an exact full lowercase SHA' }] };
    if (!manifest || !Array.isArray(manifest.inputs) || manifest.inputs.length === 0 || !FULL_SHA.test(manifest.sourceSha ?? ''))
        return { admissible: false, refused: [{ path: null, reason: 'the inspected-input manifest is missing or malformed' }] };
    if (!Array.isArray(manifest.unresolved) || manifest.unresolved.length > 0)
        return { admissible: false, refused: (manifest.unresolved ?? [null]).map((u) => ({ path: u?.file ?? null, reason: `unresolved dependency: ${u?.kind ?? 'unknown'} ${u?.token ?? u?.detail ?? ''}`.trim() })) };
    if (servedSha === manifest.sourceSha)
        return { admissible: true, refused: [], detail: 'the served release is the inspected source itself' };
    const refused = [];
    for (const input of manifest.inputs) {
        let bytes;
        try {
            bytes = readBlob(servedSha, input.path);
        }
        catch {
            refused.push({ path: input.path, reason: 'missing or unreadable at the served release' });
            continue;
        }
        if (bytes === null || bytes === undefined)
            refused.push({ path: input.path, reason: 'missing at the served release' });
        else if (sha256(bytes) !== input.sha256)
            refused.push({ path: input.path, reason: 'changed since the inspected source' });
    }
    return { admissible: refused.length === 0, refused };
}

/** The case-level outcome: NOT RUN (naming the first refused inputs) unless the inspection is reusable. */
function caseAdmission(caseId, verdict) {
    if (verdict.admissible) return { caseId, outcome: 'ADMISSIBLE', detail: verdict.detail ?? 'every inspected input is unchanged at the served release' };
    const named = verdict.refused.slice(0, 5).map((r) => `${r.path ?? '(manifest)'}: ${r.reason}`).join('; ');
    return { caseId, outcome: 'NOT RUN', detail: `the adapter inspection cannot be reused: ${verdict.refused.length} input(s) refused (${named})` };
}

module.exports = { caseAdmission, gitBlob, revalidate };
