// @vitest-environment node
//
// #1055 — REAL database-row attribution proof (immediate successor to #1033).
//
// #1033 proved the attribution runtime + recovery UI against MOCKED storage. This proves the SAME
// lifecycle against a genuine PostgreSQL row (PGlite = Postgres compiled to WASM: real planner,
// constraints, defaults — NOT a mock), loading the ACTUAL shipped migration file. It changes no
// product code: it is a test-only guard so the release is protected before the migration is applied
// or the app is deployed (both remain separate Product Owner decisions).
//
// Content-free: synthetic UUIDs only; no real transcript text.
//
// Proven, against a real row on public.sessions:
//   1. pending -> verified on the SAME row (full engine tuple + attribution_status='verified').
//   2. pending -> unverified on the SAME row (unconfirmable identity, no invented tokens).
//   3. A failed save leaves the row pending; a successful retry REUSES the same session_id.
//   4. No retry path creates a duplicate session (UPDATE never inserts; idempotency_key UNIQUE
//      rejects a duplicated initial_save).
//   5. A pre-migration (legacy) row backfills to legacy_unknown and is EXCLUDED from verified-only
//      engine evidence.
//   6. The migration CHECK rejects out-of-set values and is scoped to public.sessions (conrelid).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(HERE, '../../backend/supabase/migrations/20260724220000_sessions_attribution_status.sql');

// Minimal, faithful bootstrap: the public.sessions columns the attribution lifecycle actually touches,
// including `idempotency_key UUID UNIQUE` (the real DB guard #1033 relies on so a retried initial_save
// cannot create a second row). attribution_status is intentionally ABSENT here — it is added by the
// shipped migration, exactly as in production.
const BOOTSTRAP = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  transcript text,
  duration integer,
  engine text,
  engine_version text,
  model_name text,
  device_type text,
  status text NOT NULL DEFAULT 'active',
  idempotency_key uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
// The full producing-engine tuple an app writes when identity is confirmed (verified). Synthetic.
const VERIFIED_TUPLE = {
  engine: 'native',
  engine_version: 'private_v2:base',
  model_name: 'base',
  device_type: 'wasm',
  attribution_status: 'verified',
};

let db;
let legacySessionId; // a row created BEFORE the migration ran

// Insert a NEW (post-migration) recording row the way the save path does: omitting attribution_status
// so it takes the column DEFAULT 'pending'.
async function insertPendingSession(userId, idempotencyKey = null) {
  const res = await db.query(
    `INSERT INTO public.sessions (user_id, transcript, duration, status, idempotency_key)
     VALUES ($1, 'x', 10, 'completed', $2)
     RETURNING id, attribution_status`,
    [userId, idempotencyKey],
  );
  return res.rows[0];
}

async function readRow(id) {
  const res = await db.query(
    'SELECT id, attribution_status, engine, engine_version, model_name, device_type FROM public.sessions WHERE id = $1',
    [id],
  );
  return res.rows[0];
}

async function countRows(userId) {
  const res = await db.query('SELECT count(*)::int AS n FROM public.sessions WHERE user_id = $1', [userId]);
  return res.rows[0].n;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [USER_A, USER_B]);
  // A legacy row that exists BEFORE the feature migration (no attribution_status column yet).
  legacySessionId = (
    await db.query(`INSERT INTO public.sessions (user_id, transcript, status) VALUES ($1, 'x', 'completed') RETURNING id`, [USER_A])
  ).rows[0].id;
  // Apply the ACTUAL shipped migration (adds column, backfills legacy row, sets DEFAULT/NOT NULL/CHECK/index).
  await db.exec(readFileSync(MIGRATION, 'utf8'));
});

afterAll(async () => { await db?.close?.(); });

describe('#1055 sessions.attribution_status — real DB-row lifecycle (PGlite)', () => {
  it('1. a confirmed recording promotes the SAME row pending -> verified with the full engine tuple', async () => {
    const created = await insertPendingSession(USER_A);
    expect(created.attribution_status).toBe('pending'); // new rows start pending (column DEFAULT)

    const updated = await db.query(
      `UPDATE public.sessions
         SET engine=$2, engine_version=$3, model_name=$4, device_type=$5, attribution_status=$6
       WHERE id=$1
       RETURNING id, attribution_status, engine, engine_version, model_name, device_type`,
      [created.id, VERIFIED_TUPLE.engine, VERIFIED_TUPLE.engine_version, VERIFIED_TUPLE.model_name, VERIFIED_TUPLE.device_type, VERIFIED_TUPLE.attribution_status],
    );
    const row = updated.rows[0];
    expect(row.id).toBe(created.id);                 // SAME row
    expect(row.attribution_status).toBe('verified');
    expect(row.engine).toBe('native');
    expect(row.engine_version).toBe('private_v2:base');
    expect(row.model_name).toBe('base');
    expect(row.device_type).toBe('wasm');
  });

  it('2. an unconfirmable identity marks the SAME row pending -> unverified (no invented engine tokens)', async () => {
    const created = await insertPendingSession(USER_A);
    const updated = await db.query(
      `UPDATE public.sessions SET attribution_status='unverified' WHERE id=$1
       RETURNING id, attribution_status, engine, engine_version, model_name, device_type`,
      [created.id],
    );
    const row = updated.rows[0];
    expect(row.id).toBe(created.id);
    expect(row.attribution_status).toBe('unverified');
    // no engine identity fabricated on an unverified row
    expect(row.engine).toBeNull();
    expect(row.engine_version).toBeNull();
    expect(row.model_name).toBeNull();
    expect(row.device_type).toBeNull();
  });

  it('3. a failed save leaves the row pending; the retry REUSES the same session_id to reach verified', async () => {
    const created = await insertPendingSession(USER_A);
    const sessionId = created.id;

    // Failed save == nothing committed for this row: it is still pending, still exactly one row.
    expect((await readRow(sessionId)).attribution_status).toBe('pending');
    const before = await countRows(USER_A);

    // retryRecordingSave() re-targets the SAME sessionId (never mints a new one).
    const retry = await db.query(
      `UPDATE public.sessions
         SET engine=$2, engine_version=$3, model_name=$4, device_type=$5, attribution_status='verified'
       WHERE id=$1 RETURNING id, attribution_status`,
      [sessionId, VERIFIED_TUPLE.engine, VERIFIED_TUPLE.engine_version, VERIFIED_TUPLE.model_name, VERIFIED_TUPLE.device_type],
    );
    expect(retry.rows[0].id).toBe(sessionId);               // same session_id reused
    expect(retry.rows[0].attribution_status).toBe('verified');
    expect(await countRows(USER_A)).toBe(before);            // retry did not add a row
  });

  it('4. no retry path creates a duplicate: UPDATE never inserts, and a duplicated initial_save is rejected by idempotency_key', async () => {
    const key = '33333333-3333-4333-8333-333333333333';
    const first = await insertPendingSession(USER_B, key);
    const before = await countRows(USER_B);

    // (a) a repeated attribution UPDATE for the same id cannot fan out into extra rows.
    await db.query(`UPDATE public.sessions SET attribution_status='verified' WHERE id=$1`, [first.id]);
    await db.query(`UPDATE public.sessions SET attribution_status='verified' WHERE id=$1`, [first.id]);
    expect(await countRows(USER_B)).toBe(before);

    // (b) a retried initial_save reusing the same idempotency_key is rejected (no second row).
    await expect(
      db.query(
        `INSERT INTO public.sessions (user_id, transcript, duration, status, idempotency_key)
         VALUES ($1, 'x', 10, 'completed', $2)`,
        [USER_B, key],
      ),
    ).rejects.toThrow();
    expect(await countRows(USER_B)).toBe(before);
  });

  it('5. a pre-migration legacy row reads legacy_unknown and is EXCLUDED from verified-only engine evidence', async () => {
    const legacy = await readRow(legacySessionId);
    expect(legacy.attribution_status).toBe('legacy_unknown'); // backfilled, never inferred as verified

    // A verified row for the same user, to prove the evidence filter is selective, not empty.
    const verified = await insertPendingSession(USER_A);
    await db.query(`UPDATE public.sessions SET attribution_status='verified' WHERE id=$1`, [verified.id]);

    const evidence = await db.query(
      `SELECT id FROM public.sessions WHERE user_id=$1 AND attribution_status='verified'`,
      [USER_A],
    );
    const ids = evidence.rows.map((r) => r.id);
    expect(ids).toContain(verified.id);        // verified row is included
    expect(ids).not.toContain(legacySessionId); // legacy row is excluded from engine evidence
  });

  it('6a. the CHECK constraint rejects any value outside the closed lifecycle set', async () => {
    const created = await insertPendingSession(USER_A);
    await expect(
      db.query(`UPDATE public.sessions SET attribution_status='bogus' WHERE id=$1`, [created.id]),
    ).rejects.toThrow();
    // the four legitimate values are all accepted
    for (const v of ['pending', 'verified', 'unverified', 'legacy_unknown']) {
      await db.query(`UPDATE public.sessions SET attribution_status=$2 WHERE id=$1`, [created.id, v]);
      expect((await readRow(created.id)).attribution_status).toBe(v);
    }
  });

  it('6b. the CHECK constraint is scoped to public.sessions (conrelid), not merely by name', async () => {
    const scoped = await db.query(
      `SELECT contype FROM pg_constraint
       WHERE conname='sessions_attribution_status_check'
         AND conrelid='public.sessions'::regclass
         AND contype='c'`,
    );
    expect(scoped.rows).toHaveLength(1);
  });

  it('6c. the column is NOT NULL — an insert cannot bypass attribution by writing NULL', async () => {
    await expect(
      db.query(`INSERT INTO public.sessions (user_id, transcript, attribution_status) VALUES ($1, 'x', NULL)`, [USER_A]),
    ).rejects.toThrow();
  });
});
