// @vitest-environment node
//
// #1047 PR-U1 — sessions.transcript_state migration/behavior proof against a REAL Postgres row
// (PGlite = Postgres compiled to WASM: real planner, constraints, defaults, TRIGGERS — not a mock),
// loading the ACTUAL shipped migration file. Test-only: no product code, no migration apply, no deploy.
// Content-free: synthetic UUIDs and text.
//
// Proven HERE, at the schema/migration layer, on public.sessions:
//   1. closed value set — the CHECK rejects out-of-set values and is scoped to public.sessions (conrelid).
//   2. legacy classification — a pre-migration row with real transcript backfills to `available`; a
//      blank/null one to `not_captured`; NEVER `expired`. The migration deletes no transcript content.
//   3. server-owned derivation — INSERT/UPDATE derive available/not_captured from the transcript actually
//      persisted, ignoring any client-supplied transcript_state.
//   4. an authenticated client CANNOT self-assert `expired` — neither by writing the state nor by clearing
//      text; the trigger overwrites it. `expired` is never inferred from emptiness (empty = not_captured).
//   5. `expired` stickiness — once a privileged retention op (#1117, simulated by disabling the trigger)
//      sets `expired`, a later ordinary re-save cannot silently downgrade it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(HERE, '../../backend/supabase/migrations/20260801000000_sessions_transcript_state.sql');

// Faithful minimal bootstrap: public.sessions WITHOUT transcript_state — the shipped migration adds it,
// exactly as in production.
const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  transcript text,
  duration integer,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- A second table with a same-named CHECK would prove nothing about scoping unless the sessions CHECK is
-- conrelid-scoped; we assert the constraint exists specifically on public.sessions below.
`;

const USER = '11111111-1111-4111-8111-111111111111';
let db;
let legacyWithText;   // pre-migration row WITH a real transcript
let legacyBlank;      // pre-migration row with a blank (spaces) transcript
let legacyWhitespace; // pre-migration row with a TAB/NEWLINE-only transcript (btrim-spaces-only would miss it)

async function insert(transcript, extra = '') {
  const res = await db.query(
    `INSERT INTO public.sessions (user_id, transcript, status ${extra ? ', transcript_state' : ''})
     VALUES ($1, $2, 'completed' ${extra ? `, '${extra}'` : ''})
     RETURNING id, transcript, transcript_state`,
    [USER, transcript],
  );
  return res.rows[0];
}
async function stateOf(id) {
  const r = await db.query('SELECT transcript, transcript_state FROM public.sessions WHERE id=$1', [id]);
  return r.rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.query('INSERT INTO auth.users (id) VALUES ($1)', [USER]);
  legacyWithText = (await db.query(
    `INSERT INTO public.sessions (user_id, transcript, status) VALUES ($1, 'the birch canoe slid', 'completed') RETURNING id`, [USER],
  )).rows[0].id;
  legacyBlank = (await db.query(
    `INSERT INTO public.sessions (user_id, transcript, status) VALUES ($1, '   ', 'completed') RETURNING id`, [USER],
  )).rows[0].id;
  legacyWhitespace = (await db.query(
    `INSERT INTO public.sessions (user_id, transcript, status) VALUES ($1, E'\\t\\n \\r', 'completed') RETURNING id`, [USER],
  )).rows[0].id;
  await db.exec(readFileSync(MIGRATION, 'utf8')); // apply the ACTUAL shipped migration
});
afterAll(async () => { await db?.close?.(); });

describe('#1047 sessions.transcript_state — real DB-row behavior (PGlite)', () => {
  it('1. the CHECK admits only the closed set and is scoped to public.sessions', async () => {
    const scoped = await db.query(
      `SELECT 1 FROM pg_constraint WHERE conname='sessions_transcript_state_check'
         AND conrelid='public.sessions'::regclass AND contype='c'`,
    );
    expect(scoped.rows.length).toBe(1);
    // The trigger normally sanitizes transcript_state before the CHECK sees it (a client can't even land an
    // out-of-set value). With the trigger disabled, the CHECK is the backstop and rejects an out-of-set literal.
    await db.exec('ALTER TABLE public.sessions DISABLE TRIGGER trg_sessions_set_transcript_state');
    await expect(
      db.query(`INSERT INTO public.sessions (user_id, transcript, status, transcript_state)
                VALUES ($1,'x','completed','bogus_state')`, [USER]),
    ).rejects.toThrow();
    await db.exec('ALTER TABLE public.sessions ENABLE TRIGGER trg_sessions_set_transcript_state');
  });

  it('2. legacy rows backfill from transcript presence (never expired) and no transcript text is deleted', async () => {
    const withText = await stateOf(legacyWithText);
    const blank = await stateOf(legacyBlank);
    expect(withText.transcript_state).toBe('available');
    expect(withText.transcript).toBe('the birch canoe slid'); // migration deleted no content
    expect(blank.transcript_state).toBe('not_captured');
    expect(blank.transcript).toBe('   ');                     // untouched, just classified
    expect([withText.transcript_state, blank.transcript_state]).not.toContain('expired');
  });

  it('2b. (#1131) whitespace-only transcripts (tabs/newlines) classify as not_captured on backfill AND write', async () => {
    // btrim(transcript) with one arg strips only SPACES, so a tab/newline-only transcript would wrongly
    // backfill/derive to `available`. The whitespace-robust check (~ non-whitespace) must classify it as
    // not_captured — matching the frontend's `.trim()` semantics.
    const legacyWs = await stateOf(legacyWhitespace);
    expect(legacyWs.transcript_state).toBe('not_captured'); // backfill path
    const insertedWs = await insert('\t\n \r\f');           // trigger path (INSERT)
    expect(insertedWs.transcript_state).toBe('not_captured');
    const realWithPadding = await insert('  actual spoken words  ');
    expect(realWithPadding.transcript_state).toBe('available'); // surrounding whitespace + real text = available
  });

  it('3. INSERT derives state from the persisted transcript, ignoring a client-supplied value', async () => {
    const real = await insert('hello world');
    expect(real.transcript_state).toBe('available');
    const empty = await insert('   ');
    expect(empty.transcript_state).toBe('not_captured');
    // A client that TRIES to seed available on an empty transcript is overridden to not_captured.
    const lying = await insert('   ', 'available');
    expect(lying.transcript_state).toBe('not_captured');
  });

  it('4. an authenticated client cannot self-assert expired — by state OR by clearing text', async () => {
    const row = await insert('a real transcript');
    expect(row.transcript_state).toBe('available');
    // (a) write transcript_state='expired' directly → trigger overwrites from the (still present) text.
    await db.query(`UPDATE public.sessions SET transcript_state='expired' WHERE id=$1`, [row.id]);
    expect((await stateOf(row.id)).transcript_state).toBe('available');
    // (b) clear the text AND claim expired → derives not_captured, never expired.
    await db.query(`UPDATE public.sessions SET transcript='', transcript_state='expired' WHERE id=$1`, [row.id]);
    const after = await stateOf(row.id);
    expect(after.transcript_state).toBe('not_captured');
    expect(after.transcript_state).not.toBe('expired');
  });

  it('5. expired is sticky AND text stays NULL; an ordinary re-save cannot resurrect the transcript', async () => {
    const row = await insert('doomed transcript');
    // Simulate #1117: a privileged retention path (here: trigger disabled) removes the text and marks expired.
    await db.exec('ALTER TABLE public.sessions DISABLE TRIGGER trg_sessions_set_transcript_state');
    await db.query(`UPDATE public.sessions SET transcript=NULL, transcript_state='expired' WHERE id=$1`, [row.id]);
    await db.exec('ALTER TABLE public.sessions ENABLE TRIGGER trg_sessions_set_transcript_state');
    const expired = await stateOf(row.id);
    expect(expired.transcript_state).toBe('expired');
    expect(expired.transcript).toBeNull();
    // RESURRECTION ATTEMPT: an ordinary later re-save keeps state expired AND forces the text back to NULL —
    // retention-removed text can never be silently reintroduced.
    await db.query(`UPDATE public.sessions SET title='renamed', transcript='someone re-saved text' WHERE id=$1`, [row.id]);
    const after = await stateOf(row.id);
    expect(after.transcript_state).toBe('expired');
    expect(after.transcript).toBeNull();
  });

  it('6. the CHECK backstop rejects an expired row that carries transcript text (even with the trigger off)', async () => {
    // The DB boundary — not just the trigger or UI — forbids expired-with-text. With the trigger disabled
    // (the privileged retention path), a contradictory insert/update is REJECTED, never silently accepted.
    await db.exec('ALTER TABLE public.sessions DISABLE TRIGGER trg_sessions_set_transcript_state');
    try {
      await expect(
        db.query(`INSERT INTO public.sessions (user_id, transcript, status, transcript_state)
                  VALUES ($1, 'still here', 'completed', 'expired')`, [USER]),
      ).rejects.toThrow();
      const ok = (await db.query(
        `INSERT INTO public.sessions (user_id, transcript, status, transcript_state) VALUES ($1, 'kept', 'completed', 'available') RETURNING id`, [USER],
      )).rows[0].id;
      await expect(
        db.query(`UPDATE public.sessions SET transcript_state='expired' WHERE id=$1`, [ok]), // text still present
      ).rejects.toThrow();
    } finally {
      await db.exec('ALTER TABLE public.sessions ENABLE TRIGGER trg_sessions_set_transcript_state');
    }
  });
});
