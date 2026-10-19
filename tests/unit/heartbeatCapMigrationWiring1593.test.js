import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    EXACT_MIGRATION_ALLOWLIST,
    TARGET_POSTFLIGHT_GATES,
    assertExactDryRun,
    expectedAuthorizationPhrase,
    resolveExactMigrationConfig,
} from '../../scripts/lib/exactMigrationGate.mjs';

/**
 * #1593 (live RWT case 12) — 20261019010000 makes heartbeat_session keep a take open at the 600 s cap (billing still capped)
 * so the device's own completion saves it. It is applied through the exact allowlisted path, directly after the
 * checkout-rejection recovery (the last staged entry already applied in Production), before the held commercial activation.
 * Its pre-apply gate refuses anything but the deployed 20260812041500 heartbeat_session; its postflight proves the reviewed
 * body and ACL. Allowlisting is implementation, not authorization. Read-only: no database, no network.
 */
const VERSION = '20261019010000';
const FILE = `${VERSION}_heartbeat_session_cap_keeps_take_open_1593.sql`;
const TARGET = FILE.replace(/\.sql$/, '');
const PREVIOUS = '20261017200000';
const GATE = `postflight_${VERSION}`;
const ROOT = resolve(import.meta.dirname, '..', '..');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/apply-exact-allowlisted-migration.yml'), 'utf8');
const SCRIPT = readFileSync(resolve(ROOT, `scripts/postflight-gate-${VERSION}.sh`), 'utf8');
const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: VERSION });
const ACTIVATION = EXACT_MIGRATION_ALLOWLIST.find((e) => e.classification === 'commercial-activation');
const step = (marker) => {
    const start = WORKFLOW.indexOf(marker);
    if (start === -1) throw new Error(`workflow step not found: ${marker}`);
    const next = WORKFLOW.indexOf('\n      - name:', start + 1);
    return WORKFLOW.slice(start, next === -1 ? undefined : next);
};

describe('#1593 heartbeat cap migration is wired into the exact allowlisted apply path', () => {
    const entry = EXACT_MIGRATION_ALLOWLIST.find((item) => item.version === VERSION);

    it('is allowlisted as staged, directly after the checkout-rejection recovery, before the held commercial activation', () => {
        expect(entry).toMatchObject({ file: FILE, classification: 'staged' });
        const order = EXACT_MIGRATION_ALLOWLIST.map((e) => e.version);
        expect(order.indexOf(VERSION)).toBe(order.indexOf(PREVIOUS) + 1);
        expect(EXACT_MIGRATION_ALLOWLIST.indexOf(entry)).toBe(EXACT_MIGRATION_ALLOWLIST.indexOf(ACTIVATION) - 1);
    });

    it('pins the FINAL byte hash of the file in the tree', () => {
        const bytes = readFileSync(resolve(ROOT, 'backend/supabase/migrations', FILE));
        expect(entry.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    });

    it('is selectable, every earlier entry is a prerequisite, and only the held activation stays excluded', () => {
        expect(WORKFLOW).toContain(`- '${VERSION}'`);
        const head = 'e'.repeat(40);
        expect(expectedAuthorizationPhrase(head, config)).toBe(`APPLY ${VERSION} ${FILE} SHA256 ${entry.sha256} AT ${head}`);
        expect(config.requiredAppliedVersions).toEqual(expect.arrayContaining([PREVIOUS]));
        expect(config.excludedMigrations.map(({ version }) => version)).toEqual([ACTIVATION.version]);
    });

    it('a dry-run is accepted only when it would push this target alone', () => {
        expect(assertExactDryRun(`Would push these migrations:\n • ${FILE}\nFinished supabase db push.`, config).files).toEqual([FILE]);
        expect(() => assertExactDryRun(`Would push these migrations:\n • ${FILE}\n • ${ACTIVATION.file}\n`, config)).toThrow(/target-only/);
    });

    it('has a named postflight that the terminal authority requires, and the workflow runs before/after gates for this target only', () => {
        expect(TARGET_POSTFLIGHT_GATES).toContainEqual({ id: GATE, targetFile: TARGET });
        // The pooler parameters the pre/postflight read are proven reachable (TLS) for THIS target before the apply.
        expect(step('id: connectivity_preflight')).toContain(`contains(steps.contract.outputs.target_file, '${TARGET}')`);
        const pre = step('Preflight 20261019010000 heartbeat cap credentials');
        expect(pre).toContain(`contains(steps.contract.outputs.target_file, '${TARGET}')`);
        expect(pre).toContain(`bash scripts/postflight-gate-${VERSION}.sh before`);
        const post = step('Enforce reviewed 20261019010000 heartbeat cap definition');
        expect(post).toContain(`id: ${GATE}`);
        expect(post).toContain(`bash scripts/postflight-gate-${VERSION}.sh after`);
        expect(post).toContain('exact-migration-gate.mjs" after');
        expect(step('Require 20261019010000 heartbeat cap postflight')).toContain(`steps.${GATE}.outcome`);
        expect(step('Require unambiguous exact-operation success')).toContain(`"${GATE}=\${{ steps.${GATE}.outcome }}"`);
    });

    it('the gate script is read-only and checks function identity plus the ACL', () => {
        expect(SCRIPT).toMatch(/HEARTBEAT_BEFORE_MD5=[0-9a-f]{32}/);
        expect(SCRIPT).toMatch(/HEARTBEAT_AFTER_MD5=[0-9a-f]{32}/);
        expect(SCRIPT).toContain("has_function_privilege('anon', $FN, 'EXECUTE')");
        expect(SCRIPT).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE)\b\s+(INTO|public\.|TABLE|FUNCTION|ON)/);
        expect(SCRIPT).not.toMatch(/heartbeat_session\s*\(\s*'/); // never calls the function
    });
});
