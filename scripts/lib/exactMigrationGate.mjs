import { cpSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const TARGET_VERSION = '20260812002000';
export const TARGET_FILE = `${TARGET_VERSION}_webhook_lifecycle_completeness_1282.sql`;
export const TARGET_SHA256 = 'e2e77217547100158d4324c29feafaa2d6ecd3462b96add3b0e9002b0d923a13';
export const HELD_VERSION = '20260811143000';
export const HELD_FILE = `${HELD_VERSION}_harden_exposed_security_definer_acl.sql`;

const LIST_ROW = /^\s*(\d{8,14})?\s*\|\s*(\d{8,14})?\s*\|/;
const MIGRATION_FILE = /\b(\d{8,14}_[A-Za-z0-9_.-]+\.sql)\b/g;

/** Preserve the CLI-required <workdir>/supabase/migrations shape while holding one migration. */
export function prepareExactMigrationWorkspace(sourceSupabaseDir, tempRoot) {
    const source = resolve(sourceSupabaseDir);
    const root = resolve(tempRoot);
    const workdir = join(root, 'exact-backend');
    const supabaseDir = join(workdir, 'supabase');
    const migrationsDir = join(supabaseDir, 'migrations');
    const heldDir = join(root, 'held-migrations');

    if (existsSync(workdir) || existsSync(heldDir)) {
        throw new Error('isolated migration workspace already exists');
    }

    mkdirSync(workdir);
    cpSync(source, supabaseDir, { recursive: true, errorOnExist: true, force: false });
    mkdirSync(heldDir);
    renameSync(join(migrationsDir, HELD_FILE), join(heldDir, HELD_FILE));

    if (!existsSync(join(migrationsDir, TARGET_FILE))) {
        throw new Error('target migration is missing from isolated workspace');
    }
    if (existsSync(join(migrationsDir, HELD_FILE))) {
        throw new Error('held migration remains in isolated workspace');
    }

    return { workdir, supabaseDir, heldDir };
}

export function parseMigrationList(output) {
    const rows = [];
    for (const line of output.split(/\r?\n/)) {
        const match = line.match(LIST_ROW);
        if (!match) continue;
        const local = match[1] ?? null;
        const remote = match[2] ?? null;
        if (!local && !remote) continue;
        rows.push({ local, remote });
    }
    if (rows.length === 0) throw new Error('migration list contained no parseable rows');
    return rows;
}

function rowFor(rows, version) {
    const row = rows.find((candidate) => candidate.local === version || candidate.remote === version);
    if (!row) throw new Error(`migration ${version} is absent from migration list`);
    return row;
}

function historyMap(rows) {
    const history = new Map();
    for (const row of rows) {
        if (row.local && row.remote && row.local !== row.remote) {
            throw new Error('migration list contains a mismatched local/remote row');
        }
        const version = row.local ?? row.remote;
        if (history.has(version)) throw new Error(`migration list contains duplicate version ${version}`);
        history.set(version, row);
    }
    return history;
}

export function assertBeforeApply(output) {
    const rows = parseMigrationList(output);
    const pending = rows.filter((row) => row.local && !row.remote).map((row) => row.local);
    const expected = [HELD_VERSION, TARGET_VERSION];
    if (pending.length !== expected.length || expected.some((version, index) => pending[index] !== version)) {
        throw new Error(`unexpected pending migration set: ${pending.join(',') || 'none'}`);
    }
    const remoteOnly = rows.filter((row) => !row.local && row.remote);
    if (remoteOnly.length > 0) throw new Error('remote migration history is missing from the checked-out source');
    return { pending };
}

export function assertExactDryRun(output) {
    const files = [...output.matchAll(MIGRATION_FILE)].map((match) => match[1]);
    const unique = [...new Set(files)];
    if (!output.includes('Would push these migrations:')) {
        throw new Error('dry-run did not advertise a migration apply set');
    }
    if (unique.length !== 1 || unique[0] !== TARGET_FILE) {
        throw new Error(`dry-run was not target-only: ${unique.join(',') || 'none'}`);
    }
    return { files: unique };
}

export function assertAfterApply(beforeOutput, afterOutput) {
    const beforeRows = parseMigrationList(beforeOutput);
    const rows = parseMigrationList(afterOutput);
    const remoteOnly = rows.filter((row) => !row.local && row.remote);
    if (remoteOnly.length > 0) throw new Error('post-apply remote migration history is missing from the checked-out source');

    const before = historyMap(beforeRows);
    const after = historyMap(rows);
    if (before.size !== after.size || [...before.keys()].some((version) => !after.has(version))) {
        throw new Error('post-apply migration history contains added, removed, or replaced rows');
    }
    for (const [version, beforeRow] of before) {
        const afterRow = after.get(version);
        const expectedRemote = version === TARGET_VERSION ? TARGET_VERSION : beforeRow.remote;
        if (afterRow.local !== beforeRow.local || afterRow.remote !== expectedRemote) {
            throw new Error(`unexpected migration history delta at ${version}`);
        }
    }

    const target = rowFor(rows, TARGET_VERSION);
    if (target.local !== TARGET_VERSION || target.remote !== TARGET_VERSION) {
        throw new Error('target migration is not recorded as applied');
    }
    const held = rows.find((row) => row.local === HELD_VERSION || row.remote === HELD_VERSION);
    if (!held) throw new Error('held migration is absent from migration list');
    if (held.local !== HELD_VERSION || held.remote !== null) {
        throw new Error('held migration was unexpectedly applied or disappeared');
    }
    const pending = rows.filter((row) => row.local && !row.remote).map((row) => row.local);
    if (pending.length !== 1 || pending[0] !== HELD_VERSION) {
        throw new Error(`unexpected post-apply pending set: ${pending.join(',') || 'none'}`);
    }
    return { pending, appliedDelta: `${TARGET_VERSION}:pending->applied` };
}

const IGNORED_LINT_LINE = /^(Connecting to (?:remote|local) database|No schema errors found)/i;

function normalizedLintFindings(output) {
    return output.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !IGNORED_LINT_LINE.test(line))
        .sort();
}

/** Whole-schema lint is baseline-relative: no new or changed warning/error may appear after apply. */
export function assertNoNewLint(beforeOutput, afterOutput) {
    const before = normalizedLintFindings(beforeOutput);
    const after = normalizedLintFindings(afterOutput);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error('post-apply production lint differs from the read-only pre-apply baseline');
    }
    return { baselineFindings: before.length, postFindings: after.length };
}

/** The irreversible operation is successful only when command, history delta, and lint proof all pass. */
export function assertTerminalOutcome(applyOutcome, verifyOutcome, lintOutcome) {
    if (applyOutcome !== 'success') throw new Error(`migration apply command outcome is ${applyOutcome || 'missing'}`);
    if (verifyOutcome !== 'success') throw new Error(`post-apply history verification outcome is ${verifyOutcome || 'missing'}`);
    if (lintOutcome !== 'success') throw new Error(`post-apply lint verification outcome is ${lintOutcome || 'missing'}`);
    return { terminal: 'success' };
}
