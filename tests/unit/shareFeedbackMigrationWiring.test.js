import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    EXACT_MIGRATION_ALLOWLIST,
    TARGET_POSTFLIGHT_GATES,
    assertTerminalOutcome,
} from '../../scripts/lib/exactMigrationGate.mjs';

/**
 * #1416 finding 3 — the Share Feedback schema must be APPLICABLE through the exact allowlisted path.
 *
 * A migration file that exists in the tree is not an applyable migration. Until it carries a byte
 * hash in the allowlist, a target choice on the dispatch, and a postflight the terminal authority
 * knows to demand, the only way to land it is a route this repository does not permit — and the
 * frontend change that depends on the schema would merge with nothing behind it.
 */
const VERSION = '20260904150000';
const FILE = `${VERSION}_share_feedback_redesign.sql`;
const ROOT = resolve(import.meta.dirname, '..', '..');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/apply-exact-allowlisted-migration.yml'), 'utf8');

describe('#1416 Share Feedback migration is wired into the exact allowlisted apply path', () => {
    const entry = EXACT_MIGRATION_ALLOWLIST.find((item) => item.version === VERSION);

    it('is allowlisted', () => {
        expect(entry).toBeDefined();
        expect(entry.file).toBe(FILE);
        expect(entry.classification).toBe('staged');
    });

    it('pins the FINAL byte hash of the file actually in the tree', () => {
        // A hash recorded from a draft is worse than no hash: it fails the run at apply time, after
        // the authorization phrase has already been derived and issued.
        const bytes = readFileSync(resolve(ROOT, 'backend/supabase/migrations', FILE));
        expect(entry.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    });

    it('is not placed after the held commercial-activation entry', () => {
        const index = EXACT_MIGRATION_ALLOWLIST.indexOf(entry);
        const activation = EXACT_MIGRATION_ALLOWLIST.findIndex(
            (item) => item.classification === 'commercial-activation',
        );
        expect(index).toBeLessThan(activation);
    });

    it('is selectable as a dispatch target', () => {
        expect(WORKFLOW).toContain(`- '${VERSION}'`);
    });

    it('is inside the shared pre-apply reachability proof, not merely somewhere before the apply', () => {
        // Every target verified through raw psql must be named by the ONE step that resolves and
        // proves the pooler, or the apply lands and only THEN discovers its postflight cannot
        // connect — stranding a change that cannot be confirmed.
        //
        // Scoped to that step's own `if:` condition. Slicing the file at the apply step instead would
        // also match this target's own preflight step, which sits in the same region and names the
        // same file, so removing it from the reachability proof would go unnoticed.
        const marker = 'id: connectivity_preflight';
        const start = WORKFLOW.indexOf(marker);
        expect(start).toBeGreaterThan(-1);
        const condition = WORKFLOW.slice(start, WORKFLOW.indexOf('run: |', start));
        expect(condition).toContain(`${VERSION}_share_feedback_redesign`);
    });

    it('has a postflight the terminal authority demands for this target', () => {
        expect(TARGET_POSTFLIGHT_GATES.some((gate) => gate.targetFile === `${VERSION}_share_feedback_redesign`)).toBe(true);

        const base = { apply: 'success', verify: 'success', lint: 'success', targetFile: FILE };
        expect(() => assertTerminalOutcome({ ...base, postflights: { postflight_1416: 'skipped' } }))
            .toThrow(/postflight_1416/);
        expect(() => assertTerminalOutcome({ ...base, postflights: {} })).toThrow(/postflight_1416/);
        expect(assertTerminalOutcome({ ...base, postflights: { postflight_1416: 'success' } }).terminal)
            .toBe('success');
    });

    it('passes that postflight outcome to the terminal step by name', () => {
        // The defect this shape exists to prevent: an outcome computed by a step and then dropped on
        // the way to the authority that reports the run's verdict.
        expect(WORKFLOW).toContain('"postflight_1416=${{ steps.postflight_1416.outcome }}"');
    });
});
