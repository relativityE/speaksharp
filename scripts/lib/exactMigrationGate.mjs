import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

const DEFAULT_CONFIG = Object.freeze({
    targetVersion: '20260812002000',
    targetFile: '20260812002000_webhook_lifecycle_completeness_1282.sql',
    targetSha256: 'e2e77217547100158d4324c29feafaa2d6ecd3462b96add3b0e9002b0d923a13',
    heldVersion: '20260811143000',
    heldFile: '20260811143000_harden_exposed_security_definer_acl.sql',
});

const APPLIED_WEBHOOK_PREREQUISITE = '20260812002000';

export const EXACT_MIGRATION_ALLOWLIST = Object.freeze([
    Object.freeze({
        version: '20260811143000',
        file: '20260811143000_harden_exposed_security_definer_acl.sql',
        sha256: 'fd5eaa15dc27f66aa488da76a48bd00e3f1156a2759a3355609f1fa6eef79d2f',
        classification: 'staged',
    }),
    Object.freeze({
        version: '20260812030000',
        file: '20260812030000_progress_cohort_mode_separation_1265.sql',
        sha256: 'deeb6845ff26a1bafbfdb3751727eea723625a00ff29d4829618e4b58106f5fa',
        classification: 'staged',
    }),
    Object.freeze({
        version: '20260812039500',
        file: '20260812039500_webhook_duplicate_snapshot_convergence_1282.sql',
        sha256: '149bc20af04573c4ee48d1f9bf272a824e47b7d6b6c4d3582c10bfb2bedd7045',
        classification: 'staged',
    }),
    Object.freeze({
        version: '20260812040000',
        file: '20260812040000_thirty_day_trial_lifecycle_1282.sql',
        sha256: '4377bcb2f899e106e977ed49baffc9eae77cec0bdec1e2167e003bad260c70ef',
        classification: 'staged',
    }),
    Object.freeze({
        version: '20260812041000',
        file: '20260812041000_trial_expiry_fail_closed_1282.sql',
        sha256: '695a9384b33f564c4318360daceb5b7d06a6eb6da96d1e7feedb3256fc647753',
        classification: 'staged',
    }),
    Object.freeze({
        version: '20260812042000',
        file: '20260812042000_trial_activation_stamp_1282.sql',
        sha256: '41f10614d396769f49236cb355205e80122a969d1784f803d5b127ab8e5cb181',
        classification: 'commercial-activation',
    }),
]);

export function validateExactMigrationAllowlist(entries = EXACT_MIGRATION_ALLOWLIST) {
    if (!Array.isArray(entries) || entries.length === 0) throw new Error('exact migration allowlist is empty');
    const versions = new Set();
    const files = new Set();
    let priorVersion = '';
    let activationCount = 0;
    entries.forEach((entry, index) => {
        if (!/^\d{14}$/.test(entry.version)) throw new Error('allowlisted migration version must be 14 digits');
        if (!entry.file.startsWith(`${entry.version}_`) || !entry.file.endsWith('.sql')) {
            throw new Error(`allowlisted migration filename/version mismatch: ${entry.file}`);
        }
        if (!/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error(`allowlisted migration hash is invalid: ${entry.file}`);
        if (!['staged', 'commercial-activation'].includes(entry.classification)) {
            throw new Error(`allowlisted migration classification is invalid: ${entry.file}`);
        }
        if (priorVersion && entry.version <= priorVersion) throw new Error('exact migration allowlist is not strictly ordered');
        if (versions.has(entry.version) || files.has(entry.file)) throw new Error('exact migration allowlist contains a duplicate');
        if (entry.classification === 'commercial-activation') {
            activationCount += 1;
            if (index !== entries.length - 1) throw new Error('commercial activation must be the final allowlisted migration');
        }
        versions.add(entry.version);
        files.add(entry.file);
        priorVersion = entry.version;
    });
    if (activationCount !== 1) throw new Error('exact migration allowlist must contain one commercial activation target');
    return entries;
}

validateExactMigrationAllowlist();

function parseExcludedMigrations(env) {
    const versions = (env.EXCLUDED_VERSIONS || env.HELD_VERSION || DEFAULT_CONFIG.heldVersion)
        .trim().split(/\s+/).filter(Boolean);
    const files = (env.EXCLUDED_FILES || env.HELD_FILE || DEFAULT_CONFIG.heldFile)
        .trim().split(/\s+/).filter(Boolean);
    if (versions.length === 0 || versions.length !== files.length) {
        throw new Error('excluded migration versions/files must be non-empty, paired lists');
    }
    const migrations = versions.map((version, index) => ({ version, file: files[index] }));
    if (new Set(versions).size !== versions.length || new Set(files).size !== files.length) {
        throw new Error('excluded migration versions/files must be unique');
    }
    return migrations;
}

/** Resolve the workflow-pinned exact-migration contract, retaining the webhook gate as the default. */
export function resolveExactMigrationConfig(env = process.env) {
    if (env.SELECTED_TARGET_VERSION) {
        const targetIndex = EXACT_MIGRATION_ALLOWLIST.findIndex(({ version }) => version === env.SELECTED_TARGET_VERSION);
        if (targetIndex < 0) throw new Error('selected migration is not in the checked-in allowlist');
        const target = EXACT_MIGRATION_ALLOWLIST[targetIndex];
        return {
            targetVersion: target.version,
            targetFile: target.file,
            targetSha256: target.sha256,
            classification: target.classification,
            requiresIncludeAll: targetIndex === 0,
            requiredAppliedVersions: [
                APPLIED_WEBHOOK_PREREQUISITE,
                ...EXACT_MIGRATION_ALLOWLIST.slice(0, targetIndex).map(({ version }) => version),
            ],
            excludedMigrations: EXACT_MIGRATION_ALLOWLIST.slice(targetIndex + 1)
                .map(({ version, file }) => ({ version, file })),
            allowlisted: true,
        };
    }
    const config = {
        targetVersion: env.TARGET_VERSION || DEFAULT_CONFIG.targetVersion,
        targetFile: env.TARGET_FILE || DEFAULT_CONFIG.targetFile,
        targetSha256: env.TARGET_SHA256 || DEFAULT_CONFIG.targetSha256,
        classification: 'legacy-webhook-prerequisite',
        requiresIncludeAll: false,
        requiredAppliedVersions: [],
        excludedMigrations: parseExcludedMigrations(env),
        allowlisted: false,
    };
    if (config.excludedMigrations.some(({ version, file }) => version === config.targetVersion || file === config.targetFile)) {
        throw new Error('target migration cannot also be excluded');
    }
    return config;
}

const CONFIG = resolveExactMigrationConfig();
export const TARGET_VERSION = CONFIG.targetVersion;
export const TARGET_FILE = CONFIG.targetFile;
export const TARGET_SHA256 = CONFIG.targetSha256;
export const EXCLUDED_MIGRATIONS = CONFIG.excludedMigrations;
// Backward-compatible names for the original webhook gate and its focused tests.
export const HELD_VERSION = EXCLUDED_MIGRATIONS[0]?.version ?? '';
export const HELD_FILE = EXCLUDED_MIGRATIONS[0]?.file ?? '';

const LIST_ROW = /^\s*(\d{8,14})?\s*\|\s*(\d{8,14})?\s*\|/;
const MIGRATION_FILE = /\b(\d{8,14}_[A-Za-z0-9_.-]+\.sql)\b/g;

function assertRegularFile(path, label) {
    if (!existsSync(path) || !lstatSync(path).isFile()) {
        throw new Error(`${label} is missing`);
    }
}

function assertDirectory(path, label) {
    if (!existsSync(path) || !lstatSync(path).isDirectory()) {
        throw new Error(`${label} is missing`);
    }
}

function fileHash(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function verifyMigrationSourceIdentity(sourceSupabaseDir, config = CONFIG) {
    const migrations = join(resolve(sourceSupabaseDir), 'migrations');
    const entries = config.allowlisted
        ? EXACT_MIGRATION_ALLOWLIST
        : [{ version: config.targetVersion, file: config.targetFile, sha256: config.targetSha256 }];
    for (const { version, file, sha256 } of entries) {
        if (!file.startsWith(`${version}_`)) throw new Error(`migration filename/version mismatch: ${file}`);
        const path = join(migrations, file);
        assertRegularFile(path, `allowlisted migration ${file}`);
        if (fileHash(path) !== sha256) throw new Error(`migration hash differs from allowlist: ${file}`);
    }
    return {
        targetVersion: config.targetVersion,
        targetFile: config.targetFile,
        targetSha256: config.targetSha256,
        classification: config.classification,
        requiresIncludeAll: config.requiresIncludeAll,
        excludedVersions: config.excludedMigrations.map(({ version }) => version),
    };
}

export function expectedAuthorizationPhrase(expectedHeadSha, config = CONFIG) {
    if (!/^[0-9a-f]{40}$/.test(expectedHeadSha)) throw new Error('expected head SHA must be full lowercase hex');
    const prefix = config.classification === 'commercial-activation'
        ? 'ACTIVATE COMMERCIAL TRIAL WITH'
        : 'APPLY';
    const outOfOrderDisclosure = config.requiresIncludeAll ? ' USING ISOLATED --include-all' : '';
    return `${prefix} ${config.targetVersion} ${config.targetFile} SHA256 ${config.targetSha256}${outOfOrderDisclosure} AT ${expectedHeadSha}`;
}

/** Return a stable relative-path and SHA-256 inventory, rejecting non-file tree entries. */
export function snapshotFileInventory(rootDir) {
    const root = resolve(rootDir);
    assertDirectory(root, 'Supabase source directory');
    const inventory = [];

    function visit(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const path = join(directory, entry.name);
            if (entry.isSymbolicLink()) throw new Error('Supabase file inventory contains a symbolic link');
            if (entry.isDirectory()) {
                visit(path);
            } else if (entry.isFile()) {
                inventory.push({
                    path: relative(root, path).split(sep).join('/'),
                    sha256: fileHash(path),
                });
            } else {
                throw new Error('Supabase file inventory contains an unsupported entry');
            }
        }
    }

    visit(root);
    return inventory;
}

export function assertFileInventory(actual, expected, label) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${label} inventory or bytes differ`);
    }
}

export function verifyExactMigrationWorkspace(sourceSupabaseDir, workdir, sourceInventory, config = CONFIG) {
    const source = resolve(sourceSupabaseDir);
    const isolatedWorkdir = resolve(workdir);
    if (basename(isolatedWorkdir) !== 'exact-backend') {
        throw new Error('isolated workdir must be named exact-backend');
    }

    const supabaseDir = join(isolatedWorkdir, 'supabase');
    const migrationsDir = join(supabaseDir, 'migrations');
    assertRegularFile(join(supabaseDir, 'config.toml'), 'isolated supabase/config.toml');
    assertDirectory(migrationsDir, 'isolated supabase/migrations directory');

    const excludedRelativePaths = new Set(config.excludedMigrations.map(({ file }) => `migrations/${file}`));
    const expectedInventory = sourceInventory.filter(({ path }) => !excludedRelativePaths.has(path));
    const isolatedInventory = snapshotFileInventory(supabaseDir);
    assertFileInventory(isolatedInventory, expectedInventory, 'isolated Supabase');

    const sourceAfter = snapshotFileInventory(source);
    assertFileInventory(sourceAfter, sourceInventory, 'source Supabase');
    return { isolatedInventory, sourceAfter };
}

/** Preserve the CLI-required layout while excluding every unselected pending migration. */
export function prepareExactMigrationWorkspace(sourceSupabaseDir, tempRoot, config = CONFIG) {
    const source = resolve(sourceSupabaseDir);
    const root = resolve(tempRoot);
    const workdir = join(root, 'exact-backend');
    const supabaseDir = join(workdir, 'supabase');
    const migrationsDir = join(supabaseDir, 'migrations');
    const heldDir = join(root, 'held-migrations');

    if (existsSync(workdir) || existsSync(heldDir)) {
        throw new Error('isolated migration workspace already exists');
    }

    assertRegularFile(join(source, 'config.toml'), 'source supabase/config.toml');
    assertDirectory(join(source, 'migrations'), 'source supabase/migrations directory');
    assertRegularFile(join(source, 'migrations', config.targetFile), 'source target migration');
    for (const { file } of config.excludedMigrations) {
        assertRegularFile(join(source, 'migrations', file), `source excluded migration ${file}`);
    }
    const sourceInventory = snapshotFileInventory(source);
    const excludedSourceEntries = new Map(config.excludedMigrations.map(({ file }) => {
        const relativePath = `migrations/${file}`;
        return [file, sourceInventory.find(({ path }) => path === relativePath)];
    }));

    mkdirSync(workdir);
    cpSync(source, supabaseDir, { recursive: true, errorOnExist: true, force: false });
    mkdirSync(heldDir);
    for (const { file } of config.excludedMigrations) {
        renameSync(join(migrationsDir, file), join(heldDir, file));
    }

    const verification = verifyExactMigrationWorkspace(source, workdir, sourceInventory, config);
    for (const { file } of config.excludedMigrations) {
        const sourceEntry = excludedSourceEntries.get(file);
        if (!sourceEntry || fileHash(join(heldDir, file)) !== sourceEntry.sha256) {
            throw new Error(`excluded migration bytes differ from source: ${file}`);
        }
    }

    return { workdir, supabaseDir, heldDir, sourceInventory, ...verification };
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

export function assertBeforeApply(output, config = CONFIG) {
    const rows = parseMigrationList(output);
    const pending = rows.filter((row) => row.local && !row.remote).map((row) => row.local);
    const expected = new Set([...config.excludedMigrations.map(({ version }) => version), config.targetVersion]);
    if (pending.length !== expected.size || pending.some((version) => !expected.has(version))) {
        throw new Error(`unexpected pending migration set: ${pending.join(',') || 'none'}`);
    }
    const remoteOnly = rows.filter((row) => !row.local && row.remote);
    if (remoteOnly.length > 0) throw new Error('remote migration history is missing from the checked-out source');
    const history = historyMap(rows);
    for (const version of config.requiredAppliedVersions) {
        const prerequisite = history.get(version);
        if (!prerequisite || prerequisite.local !== version || prerequisite.remote !== version) {
            throw new Error(`required prerequisite migration ${version} is not applied`);
        }
    }
    return { pending };
}

export function assertExactDryRun(output, config = CONFIG) {
    const files = [...output.matchAll(MIGRATION_FILE)].map((match) => match[1]);
    const unique = [...new Set(files)];
    if (!output.includes('Would push these migrations:')) {
        throw new Error('dry-run did not advertise a migration apply set');
    }
    if (unique.length !== 1 || unique[0] !== config.targetFile) {
        throw new Error(`dry-run was not target-only: ${unique.join(',') || 'none'}`);
    }
    return { files: unique };
}

export function assertAfterApply(beforeOutput, afterOutput, config = CONFIG) {
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
        const expectedRemote = version === config.targetVersion ? config.targetVersion : beforeRow.remote;
        if (afterRow.local !== beforeRow.local || afterRow.remote !== expectedRemote) {
            throw new Error(`unexpected migration history delta at ${version}`);
        }
    }

    const target = rowFor(rows, config.targetVersion);
    if (target.local !== config.targetVersion || target.remote !== config.targetVersion) {
        throw new Error('target migration is not recorded as applied');
    }
    for (const { version } of config.excludedMigrations) {
        const excluded = rows.find((row) => row.local === version || row.remote === version);
        if (!excluded) throw new Error(`excluded migration ${version} is absent from migration list`);
        if (excluded.local !== version || excluded.remote !== null) {
            throw new Error(`excluded migration ${version} was unexpectedly applied or disappeared`);
        }
    }
    const pending = rows.filter((row) => row.local && !row.remote).map((row) => row.local);
    const expectedPending = new Set(config.excludedMigrations.map(({ version }) => version));
    if (pending.length !== expectedPending.size || pending.some((version) => !expectedPending.has(version))) {
        throw new Error(`unexpected post-apply pending set: ${pending.join(',') || 'none'}`);
    }
    return { pending, appliedDelta: `${config.targetVersion}:pending->applied` };
}

const IGNORED_LINT_LINE = /^(Connecting to (?:remote|local) database|No schema errors found)/i;

function normalizedLintFindings(output) {
    return output.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !IGNORED_LINT_LINE.test(line))
        .sort();
}

function findingCounts(findings) {
    const counts = new Map();
    for (const finding of findings) counts.set(finding, (counts.get(finding) ?? 0) + 1);
    return counts;
}

/** Whole-schema lint is baseline-relative: findings may disappear, but none may be added or increase. */
export function assertNoNewLint(beforeOutput, afterOutput) {
    const before = normalizedLintFindings(beforeOutput);
    const after = normalizedLintFindings(afterOutput);
    const baselineCounts = findingCounts(before);
    for (const [finding, count] of findingCounts(after)) {
        if (count > (baselineCounts.get(finding) ?? 0)) {
            throw new Error('post-apply production lint adds or increases a finding relative to the read-only baseline');
        }
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
