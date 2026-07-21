// @vitest-environment node
//
// REAL behavioral proof for the report→session ownership guard, against genuine PostgreSQL compiled
// to WASM (PGlite): real planner/plpgsql/triggers/constraints — NOT a mock. Ephemeral in-memory DB.
// Loads the ACTUAL shipped migration file and a minimal faithful bootstrap (the columns/FKs the guard
// touches), then exercises every ownership case. Content-free: synthetic UUIDs only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(HERE, '../../backend/supabase/migrations/20260721130000_report_session_ownership_guard.sql');

// Minimal, faithful bootstrap: mirrors the columns + FK semantics the guard depends on. user_issue_reports
// keeps the real `session_id ... REFERENCES sessions(id) ON DELETE SET NULL` FK so we prove the BEFORE
// trigger nulls a bad id BEFORE the FK would otherwise reject the insert.
const BOOTSTRAP = `
-- Supabase roles the migration GRANTs EXECUTE to (present in the real DB; created here for PGlite).
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE TABLE public.user_issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'issue title',
  description text NOT NULL DEFAULT 'issue description body',
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const NONEXISTENT = '99999999-9999-4999-8999-999999999999';

let db;
let sessionA; // owned by USER_A
let sessionB; // owned by USER_B

async function insertReport({ userId, sessionId }) {
  const res = await db.query(
    'INSERT INTO public.user_issue_reports (user_id, session_id) VALUES ($1, $2) RETURNING id, user_id, session_id',
    [userId, sessionId],
  );
  return res.rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(readFileSync(MIGRATION, 'utf8')); // the ACTUAL shipped migration
  await db.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [USER_A, USER_B]);
  sessionA = (await db.query('INSERT INTO public.sessions (user_id) VALUES ($1) RETURNING id', [USER_A])).rows[0].id;
  sessionB = (await db.query('INSERT INTO public.sessions (user_id) VALUES ($1) RETURNING id', [USER_B])).rows[0].id;
});

afterAll(async () => { await db?.close?.(); });

describe('report→session ownership guard (real PostgreSQL via PGlite)', () => {
  it('retains session_id when the session is owned by the same authenticated user', async () => {
    const row = await insertReport({ userId: USER_A, sessionId: sessionA });
    expect(row.session_id).toBe(sessionA);
  });

  it('coerces session_id to NULL when the session is owned by ANOTHER user (no cross-user link)', async () => {
    const row = await insertReport({ userId: USER_A, sessionId: sessionB });
    expect(row.session_id).toBeNull();
    // ...and the report itself still persisted:
    expect(row.id).toBeTruthy();
  });

  it('coerces a NONEXISTENT session id to NULL instead of losing the report (FK would otherwise reject)', async () => {
    const row = await insertReport({ userId: USER_A, sessionId: NONEXISTENT });
    expect(row.session_id).toBeNull();
    expect(row.id).toBeTruthy(); // persistence succeeded
  });

  it('coerces session_id to NULL for an anonymous report (user_id IS NULL cannot own a session)', async () => {
    const row = await insertReport({ userId: null, sessionId: sessionA });
    expect(row.session_id).toBeNull();
    expect(row.id).toBeTruthy();
  });

  it('revalidates ownership on UPDATE of session_id (cannot re-point at a foreign session)', async () => {
    const row = await insertReport({ userId: USER_A, sessionId: sessionA });
    const updated = await db.query(
      'UPDATE public.user_issue_reports SET session_id = $1 WHERE id = $2 RETURNING session_id',
      [sessionB, row.id],
    );
    expect(updated.rows[0].session_id).toBeNull(); // foreign session rejected on update
  });

  it('revalidates ownership on UPDATE of user_id (changing owner drops a now-foreign session link)', async () => {
    const row = await insertReport({ userId: USER_A, sessionId: sessionA });
    // Re-assign the report to USER_B: sessionA is now foreign to the report owner → coerced null.
    const updated = await db.query(
      'UPDATE public.user_issue_reports SET user_id = $1 WHERE id = $2 RETURNING user_id, session_id',
      [USER_B, row.id],
    );
    expect(updated.rows[0].user_id).toBe(USER_B);
    expect(updated.rows[0].session_id).toBeNull();
  });

  it('a deleted session (ON DELETE SET NULL) leaves no dangling foreign link', async () => {
    const s = (await db.query('INSERT INTO public.sessions (user_id) VALUES ($1) RETURNING id', [USER_A])).rows[0].id;
    const row = await insertReport({ userId: USER_A, sessionId: s });
    expect(row.session_id).toBe(s);
    await db.query('DELETE FROM public.sessions WHERE id = $1', [s]);
    const after = await db.query('SELECT session_id FROM public.user_issue_reports WHERE id = $1', [row.id]);
    expect(after.rows[0].session_id).toBeNull();
  });
});
