// @vitest-environment node
/**
 * #1532 Codex P2 r4122079960 (PM loop-5 exception 5869882100): the zero-residue proof must cover every row the RWT
 * journeys create. A saved Focus take inserts `objective_action` (objective_finalize_evidence_v1), so a cleanup that
 * stops at `objective_evidence` could report `cleanup_verified` with an action row orphaned.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '../live/helpers/runOwnedCleanup.ts'), 'utf8');
const list = src.slice(src.indexOf('const RESIDUE_CHECKS'), src.indexOf(']);', src.indexOf('const RESIDUE_CHECKS')));
const tables = [...list.matchAll(/table: '([a-z_]+)'/g)].map((m) => m[1]);

describe('run-owned cleanup residue inventory', () => {
    it('CASUALTY: every Focus Points table a saved take writes is residue-checked, including objective_action', () => {
        for (const t of ['objective_project', 'objective_brief', 'objective_brief_point', 'objective_session',
            'objective_source_recording', 'objective_evidence', 'objective_action']) {
            expect(tables).toContain(t);
        }
    });

    // #1532 Codex P2 r4127146515 (PM RETURN 5878931605): the transcript-retention tables a transcript-bearing save writes
    // (arming) and a later save fills with the earlier take's transcript (tombstones) are residue-checked by user_id.
    it('CASUALTY: transcript_retention_arming and transcript_retention_tombstones are residue-checked by user_id', () => {
        const entries = [...list.matchAll(/\{ table: '([a-z_]+)', column: '([a-z_]+)' \}/g)].map((m) => [m[1], m[2]]);
        for (const t of ['transcript_retention_arming', 'transcript_retention_tombstones']) {
            expect(entries).toContainEqual([t, 'user_id']);
        }
    });

    // PM loop-5 widening 5869933493: the inventory names only CURRENT tables. custom_vocabulary was renamed to
    // user_filler_words (20260103170500); querying the old name errors, and the loop fails closed on any error, so every
    // run-owned cleanup would throw and the renamed table would go unchecked.
    it('CASUALTY: the inventory uses current table names — user_filler_words, never the renamed custom_vocabulary', () => {
        expect(tables).toContain('user_filler_words');
        expect(tables).not.toContain('custom_vocabulary');
    });

    it('every residue-checked table exists under that name in the migration chain (after renames)', () => {
        const dir = resolve(__dirname, '../../backend/supabase/migrations');
        const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(resolve(dir, f), 'utf8')).join('\n');
        const created = new Set([...sql.matchAll(/create table (?:if not exists )?(?:public\.)?"?(\w+)"?/gi)].map((m) => m[1].toLowerCase()));
        for (const m of sql.matchAll(/alter table (?:if exists )?(?:public\.)?(\w+) rename to (\w+)/gi)) {
            created.delete(m[1].toLowerCase());
            created.add(m[2].toLowerCase());
        }
        for (const t of tables) expect([t, created.has(t)]).toEqual([t, true]);
    });
});
