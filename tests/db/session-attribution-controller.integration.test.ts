// @vitest-environment jsdom
//
// #1055 — APPLICATION-to-database attribution proof (part 2 of 2; companion to
// session-attribution-status.behavioral.test.js).
//
// The schema file proves the migration/column mechanics. THIS file proves the behaviour that matters
// for the release: SpeakSharp's REAL SpeechRuntimeController.retryRecordingSave() — the actual method a
// user's "Retry Save" triggers — reuses the exact same session_id, never creates a duplicate, keys an
// initial-save retry by the recording's idempotency identity, and lands the correct final
// attribution_status. The application method drives every database change; the test never hand-writes
// the INSERT/UPDATE it is trying to prove.
//
// Faithfulness: the controller's own storage seam `@/lib/storage` (the module it imports in production)
// is mocked with a PGlite adapter backed by a genuine PostgreSQL row. The adapter only executes the
// operation the controller chose (which id, insert vs update, which idempotency key) and mirrors the
// production RPC's idempotent-create semantics (a re-used idempotency_key returns the EXISTING row).
// The verified engine tuple is produced by the controller's REAL captureFinalizingIdentity() builder,
// never invented — so an internally inconsistent tuple cannot slip through. No product code changes.
//
// These assertions FAIL if the controller mints a new session id, inserts a duplicate, updates the
// wrong row, leaves a successful retry pending, or writes an incoherent verified tuple.
//
// Content-free: synthetic UUIDs only.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OWNER = '44444444-4444-4444-8444-444444444444';

// Hoisted harness the mock factory closes over: the PGlite handle + per-test failure toggles.
const H = vi.hoisted(() => ({
  db: null as unknown as InstanceType<typeof import('@electric-sql/pglite').PGlite>,
  failSave: false,
  failComplete: false,
  // #1161: the trusted producer seam. Default = a successful attestation; the controller no longer writes
  // attribution columns itself, so this stands in for attest-session-engine and records what was posted.
  attestInvoke: vi.fn((...args: unknown[]): Promise<{ data: unknown; error: unknown }> => {
    void args;
    return Promise.resolve({ data: { attributed: true }, error: null });
  }),
}));

vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: OWNER } } } }) },
    functions: { invoke: (...args: unknown[]) => H.attestInvoke(...args) },
  })),
}));

// #1161: the runtime evidence the client posts for a verified Private session (was a DB patch pre-#1161).
const VERIFIED_EVIDENCE = {
  provider: 'transformers-js', engine: 'private', engine_version: 'private_v2:base',
  model_id: 'base', resolved_device: 'wasm', fallback_occurred: false, cloud_used: false,
};

// The production storage seam, backed by a REAL Postgres row. The controller decides the operation;
// this adapter faithfully executes it as SQL — nothing more.
const ALLOWED_COLS = new Set([
  'attribution_status', 'engine', 'engine_version', 'model_name', 'device_type', 'status', 'transcript', 'duration',
]);
vi.mock('@/lib/storage', () => ({
  heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
  // saveSession → idempotent create: a re-used idempotency_key returns the EXISTING row (mirrors the
  // production create_session_and_update_usage RPC), so an initial-save retry cannot duplicate.
  saveSession: async (
    data: { user_id: string; title?: string; duration?: number; transcript?: string },
    _profile: unknown,
    engineType: string,
    idempotencyKey?: string,
    metadata?: { engineVersion?: string; modelName?: string; deviceType?: string },   // #1161 finding 6
  ) => {
    if (H.failSave) return { session: null, usageExceeded: false };
    if (idempotencyKey) {
      const existing = await H.db.query<{ id: string }>(
        'SELECT id FROM public.sessions WHERE idempotency_key = $1 AND user_id = $2',
        [idempotencyKey, data.user_id],
      );
      if (existing.rows[0]) return { session: { id: existing.rows[0].id }, usageExceeded: false };
    }
    // #1161 finding 6: persist the engine provenance metadata the controller passes (mirrors the production
    // create_session_and_update_usage p_engine_version/p_model_name/p_device_type), so a recovered row keeps it.
    const res = await H.db.query<{ id: string }>(
      `INSERT INTO public.sessions (user_id, title, duration, transcript, engine, engine_version, model_name, device_type, status, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9) RETURNING id`,
      [data.user_id, data.title ?? null, data.duration ?? 0, data.transcript ?? ' ', engineType ?? null,
       metadata?.engineVersion ?? null, metadata?.modelName ?? null, metadata?.deviceType ?? null, idempotencyKey ?? null],
    );
    return { session: { id: res.rows[0].id }, usageExceeded: false };
  },
  // completeSession → UPDATE status/transcript/duration on the given row (never inserts).
  completeSession: async (
    sessionId: string,
    options: { status?: string; transcript?: string; duration?: number } = {},
  ) => {
    if (H.failComplete) return { success: false };
    await H.db.query(
      `UPDATE public.sessions SET status = $2, transcript = COALESCE($3, transcript), duration = COALESCE($4, duration) WHERE id = $1`,
      [sessionId, options.status ?? 'completed', options.transcript ?? null, options.duration ?? null],
    );
    return { success: true };
  },
  // updateSession → UPDATE exactly the patch columns on the given row (never inserts).
  updateSession: async (sessionId: string, patch: Record<string, unknown>) => {
    const keys = Object.keys(patch).filter((k) => ALLOWED_COLS.has(k));
    if (keys.length) {
      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      await H.db.query(`UPDATE public.sessions SET ${sets} WHERE id = $1`, [sessionId, ...keys.map((k) => patch[k])]);
    }
    return { success: true };
  },
}));

import { SpeechRuntimeController } from '@/services/SpeechRuntimeController';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(HERE, '../../backend/supabase/migrations/20260724220000_sessions_attribution_status.sql');
const BOOTSTRAP = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text, transcript text, duration integer,
  engine text, engine_version text, model_name text, device_type text,
  status text NOT NULL DEFAULT 'active',
  idempotency_key uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

let controller: SpeechRuntimeController;
const priv = () => controller as unknown as {
  pendingFullSaveRetry: unknown;
  pendingAttributionRetry: unknown;
  recordingStartedUnresolved: boolean;
  isEngineSelectionLocked: () => boolean;
  pendingResolutionKind: () => string | null;
  retryRecordingSave: () => Promise<boolean>;
  captureFinalizingIdentity: (svc: unknown, mode: string | null) => Record<string, unknown>;
};

const readRow = async (id: string) =>
  (await H.db.query<Record<string, unknown>>(
    'SELECT id, attribution_status, engine, engine_version, model_name, device_type, status, idempotency_key FROM public.sessions WHERE id = $1',
    [id],
  )).rows[0];
const count = async () =>
  (await H.db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.sessions WHERE user_id = $1', [OWNER])).rows[0].n;

// The COHERENT verified tuple, produced by the controller's REAL builder (engine === producerMode).
const buildVerifiedPatch = () =>
  priv().captureFinalizingIdentity(
    { getMetadata: () => ({ engineVersion: 'private_v2:base', modelName: 'base', deviceType: 'wasm' }) },
    'private',
  );
// A real UNVERIFIED result: an allowlisted engine but no resolvable metadata → no invented tuple.
const buildUnverifiedPatch = () => priv().captureFinalizingIdentity(null, 'native');

beforeAll(async () => {
  H.db = new PGlite();
  await H.db.exec(BOOTSTRAP);
  await H.db.query('INSERT INTO auth.users (id) VALUES ($1)', [OWNER]);
  await H.db.exec(readFileSync(MIGRATION, 'utf8'));
});
afterAll(async () => { await H.db?.close?.(); });

beforeEach(async () => {
  H.failSave = false;
  H.failComplete = false;
  H.attestInvoke.mockClear();
  H.attestInvoke.mockResolvedValue({ data: { attributed: true }, error: null });
  await H.db.query('DELETE FROM public.sessions');
  controller = SpeechRuntimeController.getInstance();
  const c = controller as unknown as Record<string, unknown>;
  c.state = 'IDLE';
  c.engineSelectionIntentLocked = false;
  c.pendingFullSaveRetry = null;
  c.pendingAttributionRetry = null;
  c.recordingStartedUnresolved = false;
  c.recordingEngineMode = null;
  c.producerIntegrityCompromised = false;
  c.sessionId = null;
  c.pendingInitialSaveContext = null;
  c.queuedProducerPolicy = null;
});

describe('#1055 retryRecordingSave() drives a real DB row (PGlite-backed storage)', () => {
  it('the REAL builder yields a coherent verified tuple (engine matches its own version string)', () => {
    const patch = buildVerifiedPatch();
    expect(patch.attribution_status).toBe('verified');
    expect(patch.engine).toBe('private');                 // engine === producerMode
    expect(patch.engine_version).toBe('private_v2:base');  // coherent with engine='private'
    // guardrail: never engine='native' paired with a private_v2 version
    expect(patch.engine).not.toBe('native');
  });

  it('FULL-SAVE retry: a failed save stays pending; the retry completes the SAME row + attests it (no duplicate)', async () => {
    // A placeholder row exists (pending) but completeSession failed at stop.
    const sessionId = (await H.db.query<{ id: string }>(
      `INSERT INTO public.sessions (user_id, transcript, status) VALUES ($1, 'words', 'active') RETURNING id`, [OWNER],
    )).rows[0].id;
    const c = controller as unknown as Record<string, unknown>;
    // #1161: the stash carries runtime EVIDENCE; the client posts it to the recorder (it can no longer write
    // the attribution columns itself — those are server-written; the recorded verdict is a declaration, not proof).
    c.pendingFullSaveRetry = { sessionId, completeArgs: { status: 'completed', transcript: 'words', duration: 12 }, attributionEvidence: VERIFIED_EVIDENCE };
    c.recordingStartedUnresolved = true;

    // 1) storage FAILS → retry returns false, row not completed, still one row, still retryable, no attest.
    H.failComplete = true;
    await expect(priv().retryRecordingSave()).resolves.toBe(false);
    expect((await readRow(sessionId)).status).toBe('active');
    expect(H.attestInvoke).not.toHaveBeenCalled();
    expect(await count()).toBe(1);
    expect(priv().pendingResolutionKind()).toBe('full_save');

    // 2) storage recovers → retry returns true; the SAME row is completed and ATTESTED via the producer;
    //    still one row; lock released. (The authority row + attribution_status are written server-side —
    //    proven in the authority/consumer suites, not by the client here.)
    H.failComplete = false;
    await expect(priv().retryRecordingSave()).resolves.toBe(true);
    const row = await readRow(sessionId);
    expect(row.id).toBe(sessionId);                 // EXACT original session_id updated (not a new one)
    expect(row.status).toBe('completed');
    expect(H.attestInvoke).toHaveBeenCalledWith('attest-session-engine',
      expect.objectContaining({ body: { sessionId, runtimeEvidence: VERIFIED_EVIDENCE } }));
    expect(await count()).toBe(1);                  // no duplicate session
    expect(priv().pendingResolutionKind()).toBeNull();
    expect(priv().isEngineSelectionLocked()).toBe(false); // resolution genuinely unlocks the selector
  });

  it('FULL-SAVE retry with an unconfirmable identity completes the SAME row + RESOLVES unattributed via server (no authority)', async () => {
    const sessionId = (await H.db.query<{ id: string }>(
      `INSERT INTO public.sessions (user_id, transcript, status) VALUES ($1, 'words', 'active') RETURNING id`, [OWNER],
    )).rows[0].id;
    // The REAL builder still invents nothing for an unconfirmable identity.
    const unverified = buildUnverifiedPatch();
    expect(unverified.attribution_status).toBe('unverified');
    expect(unverified.engine).toBeUndefined();

    const c = controller as unknown as Record<string, unknown>;
    // #1161 P1: no trusted identity ⇒ null evidence ⇒ the client posts op:'resolve_unattributed' so the SERVER writes the
    // terminal unattributed marker (convergence — not a silent skip). The row is still durably saved + completed;
    // the client fabricates NO engine identity (no authority).
    c.pendingFullSaveRetry = { sessionId, completeArgs: { status: 'completed', transcript: 'words', duration: 12 }, attributionEvidence: null };
    c.recordingStartedUnresolved = true;

    await expect(priv().retryRecordingSave()).resolves.toBe(true);
    const row = await readRow(sessionId);
    expect(row.id).toBe(sessionId);
    expect(row.status).toBe('completed');           // transcript still durably saved
    expect(H.attestInvoke).toHaveBeenCalledTimes(1);
    expect((H.attestInvoke.mock.calls[0][1] as { body?: { op?: string; sessionId?: string } })?.body)
        .toMatchObject({ op: 'resolve_unattributed', sessionId });   // server RESOLVE op invoked (definitive no-evidence)
    expect(row.engine).toBeNull();                  // client fabricated no engine identity
    expect(await count()).toBe(1);
    expect(priv().isEngineSelectionLocked()).toBe(false);
  });

  it('INITIAL-SAVE retry: creates exactly one row keyed by the recording idempotency key; a repeat cannot create a second', async () => {
    const recordingId = '55555555-5555-4555-8555-555555555555';
    const c = controller as unknown as Record<string, unknown>;
    const seedInitial = () => {
      c.pendingFullSaveRetry = {
        sessionId: null,
        initialSave: { userId: OWNER, recordingId, mode: 'private',
          engineVersion: 'private_v2:base', modelName: 'base', deviceType: 'wasm' },   // #1161 finding 6
        completeArgs: { status: 'completed', transcript: 'words', duration: 12 },
        attributionEvidence: VERIFIED_EVIDENCE,
      };
      c.recordingStartedUnresolved = true;
    };
    seedInitial();
    expect(priv().pendingResolutionKind()).toBe('initial_save');

    // 1) saveSession FAILS → nothing created, still retryable.
    H.failSave = true;
    await expect(priv().retryRecordingSave()).resolves.toBe(false);
    expect(await count()).toBe(0);

    // 2) saveSession recovers → EXACTLY one row, keyed by the recording identity, and attested via the producer.
    H.failSave = false;
    await expect(priv().retryRecordingSave()).resolves.toBe(true);
    expect(await count()).toBe(1);
    const first = (await H.db.query<{ id: string; idempotency_key: string; engine: string; engine_version: string; model_name: string; device_type: string }>(
      'SELECT id, idempotency_key, engine, engine_version, model_name, device_type FROM public.sessions WHERE user_id = $1', [OWNER],
    )).rows[0];
    expect(first.idempotency_key).toBe(recordingId); // same recording, not a new identity
    // #1161 finding 6: the recovered row carries the SAME engine provenance (not a blank identity).
    expect({ engine: first.engine, engine_version: first.engine_version, model_name: first.model_name, device_type: first.device_type })
      .toEqual({ engine: 'private', engine_version: 'private_v2:base', model_name: 'base', device_type: 'wasm' });
    expect(H.attestInvoke).toHaveBeenCalledWith('attest-session-engine',
      expect.objectContaining({ body: { sessionId: first.id, runtimeEvidence: VERIFIED_EVIDENCE } }));

    // 3) a repeated initial-save retry reusing the SAME recording key is idempotent — no second row.
    seedInitial();
    await expect(priv().retryRecordingSave()).resolves.toBe(true);
    expect(await count()).toBe(1);
    expect((await H.db.query<{ id: string }>('SELECT id FROM public.sessions WHERE user_id = $1', [OWNER])).rows[0].id).toBe(first.id);
  });
});
