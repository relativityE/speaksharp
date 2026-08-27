// @vitest-environment node
//
// #1360 — the DATABASE layer of abandonment, and the delete path nobody has exercised.
//
// A user who closes the tab mid-recording leaves a session row that was never completed, plus the
// `usage_checkpoints` row the recording wrote. No `complete_session_v2` call ever happens, so no
// teardown runs. Cancelling a proof run is not this: cancellation runs a deliberate authenticated
// teardown, which is why nine cancelled runs proved the harness cleans up and proved nothing here.
//
// THE FK ASYMMETRY THIS PINS (verified in 20260309000000_phase2_integration.sql:44-54):
//     session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE   -- cascades
//     user_id    UUID REFERENCES auth.users(id)                          -- NO ON DELETE => RESTRICT
//
// An inline FK with no `ON DELETE` is RESTRICT, and `usage_checkpoints.user_id` has previously burned a
// partial delete. The ordering was fixed for the COMPLETED-session case; the abandoned case — an
// in-progress row still holding a checkpoint — has never run.
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const U = '11111111-1111-4111-8111-111111111111';

/** Minimum real-shaped schema: the two FKs under test are declared exactly as shipped. */
const SCHEMA = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    status text,
    transcript text
  );
  CREATE TABLE public.usage_checkpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id),
    incremental_seconds int NOT NULL,
    engine_type text NOT NULL,
    created_at timestamptz DEFAULT now()
  );
`;

async function abandonedState(): Promise<{ db: PGlite; sessionId: string }> {
    const db = new PGlite();
    await db.exec(SCHEMA);
    await db.query('INSERT INTO auth.users (id) VALUES ($1)', [U]);
    // The state abandonment produces: an IN-PROGRESS session, never completed, holding a checkpoint.
    const s = await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id, status, transcript) VALUES ($1, 'in_progress', NULL) RETURNING id`, [U],
    );
    const sessionId = s.rows[0].id;
    await db.query(
        `INSERT INTO public.usage_checkpoints (session_id, user_id, incremental_seconds, engine_type)
         VALUES ($1, $2, 20, 'private')`, [sessionId, U],
    );
    return { db, sessionId };
}

const count = async (db: PGlite, table: string) =>
    (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

describe('#1360 abandonment leaves an orphan row holding a checkpoint', () => {
    let db: PGlite;

    beforeEach(async () => { ({ db } = await abandonedState()); });

    it('the session is left IN PROGRESS and is never completed', async () => {
        const rows = await db.query<{ status: string; transcript: string | null }>(
            'SELECT status, transcript FROM public.sessions WHERE user_id = $1', [U],
        );
        expect(rows.rows[0]).toMatchObject({ status: 'in_progress', transcript: null });
        expect(await count(db, 'public.usage_checkpoints')).toBe(1);
    });

    it('NOTHING reaps it — the orphan persists and accumulates per abandonment', async () => {
        // There is no reaper in the shipped schema. Each abandonment adds a row that no code path
        // removes. Recorded as a finding, not fixed here: this PR is diagnosis.
        const { db: db2 } = await abandonedState();
        await db2.query(
            `INSERT INTO public.sessions (user_id, status) VALUES ($1, 'in_progress')`, [U],
        );
        expect(await count(db2, 'public.sessions'), 'orphans accumulate').toBe(2);
    });
});

describe('#1360 THE DELETE PATH THAT HAS NEVER RUN', () => {
    let db: PGlite;
    beforeEach(async () => { ({ db } = await abandonedState()); });

    it('deleting the USER first is REFUSED — usage_checkpoints.user_id is RESTRICT', async () => {
        // The inline FK carries no `ON DELETE`, so it is RESTRICT. This is the exact shape that burned
        // a partial delete before, now reproduced on the state abandonment produces.
        await expect(db.query('DELETE FROM auth.users WHERE id = $1', [U]))
            .rejects.toThrow(/foreign key|violates/i);
        expect(await count(db, 'auth.users'), 'the user must still be there').toBe(1);
        expect(await count(db, 'public.usage_checkpoints')).toBe(1);
    });

    it('deleting the SESSION first cascades the checkpoint, and the user then deletes cleanly', async () => {
        // The correct ordering. `session_id` cascades, which clears the RESTRICT on `user_id`.
        await db.query('DELETE FROM public.sessions WHERE user_id = $1', [U]);
        expect(await count(db, 'public.usage_checkpoints'), 'cascaded via session_id').toBe(0);

        await db.query('DELETE FROM auth.users WHERE id = $1', [U]);
        expect(await count(db, 'auth.users')).toBe(0);
        expect(await count(db, 'public.sessions')).toBe(0);
    });

    it('deleting the checkpoint explicitly also works — order, not magic', async () => {
        await db.query('DELETE FROM public.usage_checkpoints WHERE user_id = $1', [U]);
        await db.query('DELETE FROM public.sessions WHERE user_id = $1', [U]);
        await db.query('DELETE FROM auth.users WHERE id = $1', [U]);
        for (const t of ['auth.users', 'public.sessions', 'public.usage_checkpoints']) {
            expect(await count(db, t), `${t} must be empty`).toBe(0);
        }
    });
});
