export const TARGET_VERSION = '20260812002000';
export const TARGET_FILE = `${TARGET_VERSION}_webhook_lifecycle_completeness_1282.sql`;
export const TARGET_SHA256 = 'e2e77217547100158d4324c29feafaa2d6ecd3462b96add3b0e9002b0d923a13';
export const HELD_VERSION = '20260811143000';
export const HELD_FILE = `${HELD_VERSION}_harden_exposed_security_definer_acl.sql`;

const LIST_ROW = /^\s*(\d{8,14})?\s*\|\s*(\d{8,14})?\s*\|/;
const MIGRATION_FILE = /\b(\d{8,14}_[A-Za-z0-9_.-]+\.sql)\b/g;

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

export function assertAfterApply(output) {
    const rows = parseMigrationList(output);
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
    return { pending };
}
