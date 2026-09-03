// @vitest-environment node
//
// #1408 — the DATABASE enforces that a Comment has no defect severity.
//
// Permitting `not_applicable` is not the same as enforcing it. A widened vocabulary alone would still
// allow an Issue stored as `not_applicable` — invisible to severity triage — and a Comment stored as
// `critical`, ranked beside real defects. Both are the failure this contract exists to prevent, and the
// database is the only place that can insist.
//
// These EXECUTE the actual prior schema and then the additive migration, so the legacy rows written
// under the old constraint are real rows, not a description of them.
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const read = (f: string) => readFileSync(resolve(MIGRATIONS, f), 'utf8');

const USER = '11111111-1111-4111-8111-111111111111';
let db: PGlite;

/** Stand up the PRIOR schema, seed legacy rows under it, then apply the additive migration. */
async function withPriorSchemaAndLegacyRows() {
    const d = new PGlite();
    await d.exec(`
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
        INSERT INTO auth.users (id) VALUES ('${USER}') ON CONFLICT DO NOTHING;
        -- The reports table references sessions; only the identity column matters here.
        CREATE TABLE IF NOT EXISTS public.sessions (
            id uuid PRIMARY KEY,
            user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE
        );
        -- Supabase supplies auth.uid() for the table's RLS policies. The policies are not what is under
        -- test here; the CHECK constraint is. A stub keeps the real migration applicable verbatim.
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
            LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-4000-8000-000000000000'::uuid $$;
        CREATE OR REPLACE FUNCTION auth.role() RETURNS text
            LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;
    `);
    // The real prior table definition, including its defect-only severity constraint.
    await d.exec(read('20260605080000_user_issue_reports.sql'));
    return d;
}

const insert = (d: PGlite, id: string, severity: string, metadata: unknown) =>
    d.query(
        `INSERT INTO public.user_issue_reports
           (id, user_id, title, description, severity, page_url, metadata)
         VALUES ($1,$2,'A clear enough title','A description with enough length to satisfy the contract.',$3,'/session',$4)`,
        [id, USER, severity, JSON.stringify(metadata)],
    );

const rid = (n: number) => `7777777${n}-7777-4777-8777-777777777777`;

beforeEach(async () => { db = await withPriorSchemaAndLegacyRows(); });

describe('#1408 legacy rows survive the constraint change', () => {
    it('CASUALTY: rows written under the PRIOR schema remain valid afterwards', async () => {
        // Written before the migration, with no feedback_kind — exactly the pre-Share-Feedback shape.
        await insert(db, rid(1), 'critical', { canonicalRoute: '/session' });
        await insert(db, rid(2), 'low', { canonicalRoute: '/analytics' });

        // Applying the migration must not reject data that is already there.
        await expect(db.exec(read('20260903140000_feedback_kind_severity_contract.sql'))).resolves.toBeDefined();

        const rows = (await db.query('SELECT id, severity FROM public.user_issue_reports ORDER BY id')).rows as
            Array<{ severity: string }>;
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.severity), 'historical severities are preserved as written')
            .toEqual(['critical', 'low']);
    });

    it('a NEW legacy-shaped row (no kind) may still carry a historical severity', async () => {
        await db.exec(read('20260903140000_feedback_kind_severity_contract.sql'));
        await expect(insert(db, rid(3), 'high', { canonicalRoute: '/session' })).resolves.toBeDefined();
    });
});

describe('#1408 the constraint enforces kind/severity agreement', () => {
    beforeEach(async () => { await db.exec(read('20260903140000_feedback_kind_severity_contract.sql')); });

    it('an explicit Issue REQUIRES a ranked severity', async () => {
        await expect(insert(db, rid(4), 'critical', { feedback_kind: 'issue' })).resolves.toBeDefined();
    });

    it('CASUALTY: an Issue may NOT be stored as not_applicable', async () => {
        // It would vanish from severity triage while still being a defect report.
        await expect(insert(db, rid(5), 'not_applicable', { feedback_kind: 'issue' })).rejects.toThrow();
    });

    it('an explicit Comment REQUIRES not_applicable', async () => {
        await expect(insert(db, rid(6), 'not_applicable', { feedback_kind: 'comment' })).resolves.toBeDefined();
    });

    it.each(['low', 'medium', 'high', 'critical'])(
        'CASUALTY: a Comment may NOT be stored with the ranked severity %s', async (sev) => {
            // This is the defect: a compliment carrying a real severity is rankable beside real defects.
            await expect(insert(db, rid(7), sev, { feedback_kind: 'comment' })).rejects.toThrow();
        });

    it('CASUALTY: not_applicable is refused for a legacy row too', async () => {
        // Legacy rows come from the Issue-only journey; a non-defect severity there would be a value the
        // old product could never have produced.
        await expect(insert(db, rid(8), 'not_applicable', { canonicalRoute: '/session' })).rejects.toThrow();
    });

    it('a consumer cannot mistake not_applicable for a ranked severity', async () => {
        await insert(db, rid(9), 'not_applicable', { feedback_kind: 'comment' });
        await insert(db, rid(1), 'critical', { feedback_kind: 'issue' });
        // The defect ordering contains only ranked values; the Comment is not in it at all.
        const ranked = (await db.query(
            `SELECT id FROM public.user_issue_reports
             WHERE severity IN ('low','medium','high','critical')`,
        )).rows;
        expect(ranked, 'only the Issue is severity-rankable').toHaveLength(1);
    });
});
