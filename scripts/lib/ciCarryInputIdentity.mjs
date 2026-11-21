// Verification-only input facts for a base refresh, never authority to post a status.
// The caller must acquire immutable Git objects independently on trusted reviewed bytes,
// bind the real previous run/attempt and the live Code/Security state, and recheck PR refs.
import { spawnSync } from 'node:child_process';

const SHA = /^(?!0{40}$)[0-9a-f]{40}$/;
const MAX_DIFF_BYTES = 4 * 1024 * 1024;
const CLEANUP_INPUTS = new Set([
    'tests/live/helpers/runOwnedCleanup.ts',
    'tests/live/helpers/proofAuthority.ts',
    'tests/live/helpers/runBinding.ts',
]);

function git(root, args) {
    const result = spawnSync('git', ['--no-replace-objects', ...args], { cwd: root, timeout: 10_000, maxBuffer: MAX_DIFF_BYTES });
    if (result.error || result.status !== 0) throw new Error('git-input-unproven');
    return result.stdout;
}
const assertAncestor = (root, ancestor, head) => git(root, ['merge-base', '--is-ancestor', ancestor, head]);
const rawDiff = (root, a, b) => git(root, ['diff-tree', '--no-commit-id', '--raw', '-r', '--no-renames', '--no-abbrev', '-z', a, b]);

function paths(raw) {
    const fields = new TextDecoder('utf-8', { fatal: true }).decode(raw).split('\0');
    if (fields.pop() !== '' || fields.length % 2 !== 0) throw new Error('git-diff-unproven');
    const files = [];
    for (let i = 0; i < fields.length; i += 2) {
        // No rename folding. Preserve the deleted source as well as the added destination.
        if (!/^:[0-7]{6} [0-7]{6} [a-f0-9]{40} [a-f0-9]{40} [ADMT]$/.test(fields[i])
            || !fields[i + 1] || /[\r\n\\]/.test(fields[i + 1])) throw new Error('git-diff-unproven');
        files.push(fields[i + 1]);
    }
    if (new Set(files).size !== files.length) throw new Error('git-diff-unproven');
    return files;
}

function engineeringClass(file) {
    if (/^tests\/live\/helpers\//.test(file)) return 'live-helper-source';
    if (/^tests\/unit\//.test(file)) return 'unit-test-source';
    if (/^tools\/cloud-test\//.test(file)) return 'cloud-runner-source';
    return 'possible-engineering-input';
}

function smokeReviewClass(file) {
    // This is only a product-execution footprint triage, not lineage or coverage.
    // The smoke reporter itself binds the whole tree; never transform its prior receipt
    // into current-run evidence, even when these paths do not directly enter the app.
    if (/^tests\/unit\//.test(file)) return 'outside-direct-smoke-footprint';
    if (/^tests\/live\/helpers\//.test(file) && !CLEANUP_INPUTS.has(file)) return 'outside-direct-smoke-footprint';
    if (/^tools\/cloud-test\//.test(file)) return 'outside-direct-smoke-footprint';
    // New/unknown paths are not declared unrelated. This includes CI, imports, app,
    // database, build inputs, dependencies, smoke tests, cleanup, and runner scripts.
    return 'possible-smoke-input';
}

/** Compare exact raw file path/mode/before/after Git object identities, not textual patch IDs. */
export function inspectBaseOnlyCiInputs({ root, oldBase, oldHead, newBase, newHead } = {}) {
    const hold = (reason) => ({ status: 'HOLD', reason });
    const identities = [oldBase, oldHead, newBase, newHead];
    if (!identities.every(value => typeof value === 'string' && SHA.test(value))
        || oldBase === newBase || oldHead === newHead) return hold('invalid-base-refresh-identity');
    try {
        for (const sha of new Set(identities)) {
            if (git(root, ['cat-file', '-t', sha]).toString().trim() !== 'commit') return hold('non-commit-input');
        }
        assertAncestor(root, oldBase, oldHead);
        assertAncestor(root, oldBase, newBase);
        assertAncestor(root, newBase, newHead);
        const original = rawDiff(root, oldBase, oldHead);
        const candidate = rawDiff(root, newBase, newHead);
        if (!original.length || !original.equals(candidate)) return hold('candidate-patch-changed');
        const baseDelta = rawDiff(root, oldBase, newBase);
        if (!baseDelta.equals(rawDiff(root, oldHead, newHead))) return hold('base-delta-not-exactly-carried');
        const changed = paths(baseDelta).map(file => ({ file, engineering: engineeringClass(file), smoke: smokeReviewClass(file) }));
        return {
            status: changed.length ? 'HOLD' : 'INPUT_MATCH',
            reason: changed.length ? 'engineering-inputs-changed-or-unproven' : 'tree-and-patch-identical',
            oldBase, oldHead, newBase, newHead, changed,
            smokeFootprint: changed.some(entry => entry.smoke === 'possible-smoke-input') ? 'POSSIBLE_CHANGE' : 'NO_DIRECT_OVERLAP',
            scope: 'source inputs only; no CI qualification, review carry or same-attempt credit',
        };
    } catch {
        return hold('git-input-unproven');
    }
}
