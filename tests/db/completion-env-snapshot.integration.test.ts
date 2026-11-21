// @vitest-environment node
//
// The shared completion environment hands each test a clone of one migrated template instead of rebuilding the schema.
// These checks keep that safe:
//   - isolation: a clone never sees another clone's rows, auth context, role or session settings;
//   - fidelity: a clone carries the real schema, so a constraint the suites rely on still refuses, and the same steps
//     with that constraint removed accept the forbidden write (the planted break a cloned suite must still catch).
// Content-free: synthetic strings only.
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  U, OTHER, BOOTSTRAP, STAGE_A, ATOMIC, PRODUCT_MARKER_TABLE, db0, buildCompletionDb, actingAs, newSession, complete,
  closeCompletionDbs,
} from './helpers/completionEnv';

afterEach(() => closeCompletionDbs());
afterAll(() => closeCompletionDbs({ template: true }));

const EXPIRED_NULL_CHECK = `  ALTER TABLE public.sessions ADD CONSTRAINT sessions_expired_transcript_null_check
    CHECK (transcript_state <> 'expired' OR transcript IS NULL);`;

/** Try the forbidden pair (expired state with text kept) the only way it can be reached: with the trigger suppressed. */
async function forceExpiredWithText(db: Awaited<ReturnType<typeof db0>>) {
  const s = await newSession(db);
  await complete(db, s, { transcript: 'synthetic body' });
  await db.exec("SET session_replication_role = 'replica'");
  try {
    return await db.query(`UPDATE public.sessions SET transcript_state = 'expired' WHERE id = $1`, [s]);
  } finally {
    await db.exec("SET session_replication_role = 'origin'");
  }
}

describe('completion environment: each db0() is an isolated clone of one migrated template', () => {
  it('rows, auth context, role and settings set in one clone are absent from the next, and stay in the first', async () => {
    const a = await db0();
    await actingAs(a, OTHER);
    await newSession(a, OTHER);
    await a.exec("SET ROLE authenticated; SET statement_timeout = '1234ms'");

    const b = await db0();
    expect((await b.query<{ uid: string }>('SELECT auth.uid()::text AS uid')).rows[0].uid).toBe(U);
    expect((await b.query<{ n: number }>('SELECT count(*)::int AS n FROM public.sessions')).rows[0].n).toBe(0);
    expect((await b.query<{ r: string }>('SELECT current_user::text AS r')).rows[0].r).not.toBe('authenticated');
    expect((await b.query<{ t: string }>('SHOW statement_timeout')).rows[0].t).not.toBe('1234ms');

    await a.exec('RESET ROLE');
    expect((await a.query<{ uid: string }>('SELECT auth.uid()::text AS uid')).rows[0].uid).toBe(OTHER);
    expect((await a.query<{ n: number }>('SELECT count(*)::int AS n FROM public.sessions')).rows[0].n).toBe(1);
  });

  it('a clone carries the real schema: the expired-means-no-text constraint refuses the forbidden write', async () => {
    await expect(forceExpiredWithText(await db0())).rejects.toThrow(/sessions_expired_transcript_null_check/);
  });

  it('planted break: the same steps without that constraint accept the write, so a suite on the clone would go red', async () => {
    expect(BOOTSTRAP.split(EXPIRED_NULL_CHECK).length).toBe(2); // the break targets exactly the real constraint text
    const broken = await buildCompletionDb([BOOTSTRAP.replace(EXPIRED_NULL_CHECK, ''), STAGE_A, ATOMIC, PRODUCT_MARKER_TABLE]);
    try {
      await expect(forceExpiredWithText(broken)).resolves.toMatchObject({ affectedRows: 1 });
    } finally { await broken.close(); }
  });

  it('a setup step that throws closes its own handle and surfaces the original setup error', async () => {
    let created: PGlite | null = null;
    await expect(buildCompletionDb([BOOTSTRAP, 'PLANTED SETUP FAILURE'], () => (created = new PGlite())))
      .rejects.toThrow(/syntax error at or near "PLANTED"/);
    expect(created).not.toBeNull();
    expect(created!.closed).toBe(true);
  });

  it('a clone that fails to close does not stop the others from closing, and the failure is reported', async () => {
    const a = await db0();
    const b = await db0();
    const failing = vi.spyOn(a, 'close').mockRejectedValueOnce(new Error('planted close failure'));
    await expect(closeCompletionDbs()).rejects.toThrow('planted close failure');
    expect(b.closed).toBe(true);
    failing.mockRestore();
    await a.close();
  });
});
