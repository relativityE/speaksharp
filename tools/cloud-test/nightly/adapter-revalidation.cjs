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

/** The dependency graph the deriver produces at `sha` with the sealed adapters (this checkout's history). */
const deriveAtSha = (sha) => require('./derive-adapter-inputs.cjs').derive({ sha });
/**
 * `{ admissible, refused: [{ path, reason }] }` for reusing the inspection at `servedSha`. Byte-identical inputs are not
 * enough (Codex P2 on ed4af854): a file added at the served release can take an unchanged import's place, so the graph is
 * re-derived there (`deriveAt`) and must contain exactly the inspected inputs, with nothing unresolved.
 */
function revalidate({ servedSha, readBlob = gitBlob, manifest = MANIFEST, deriveAt = deriveAtSha }) {
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
    let served;
    try {
        served = deriveAt(servedSha);
    }
    catch {
        refused.push({ path: null, reason: 'the dependency graph could not be derived at the served release' });
        return { admissible: false, refused };
    }
    const inspected = new Set(manifest.inputs.map((i) => i.path));
    const now = new Set((served?.inputs ?? []).map((i) => i.path));
    for (const p of [...now].filter((x) => !inspected.has(x)).sort())
        refused.push({ path: p, reason: 'added to the dependency graph at the served release' });
    for (const p of [...inspected].filter((x) => !now.has(x)).sort())
        if (!refused.some((r) => r.path === p)) refused.push({ path: p, reason: 'no longer in the dependency graph at the served release' });
    for (const u of served?.unresolved ?? [])
        refused.push({ path: u.file ?? null, reason: `unresolved at the served release: ${u.kind} ${u.token ?? u.detail ?? ''}`.trim() });
    return { admissible: refused.length === 0, refused };
}

/** The case-level outcome: NOT RUN (naming the first refused inputs) unless the inspection is reusable. */
function caseAdmission(caseId, verdict) {
    if (verdict.admissible) return { caseId, outcome: 'ADMISSIBLE', detail: verdict.detail ?? 'every inspected input is unchanged at the served release' };
    const named = verdict.refused.slice(0, 5).map((r) => `${r.path ?? '(manifest)'}: ${r.reason}`).join('; ');
    return { caseId, outcome: 'NOT RUN', detail: `the adapter inspection cannot be reused: ${verdict.refused.length} input(s) refused (${named})` };
}

module.exports = { caseAdmission, gitBlob, revalidate };
