// @vitest-environment node
// #1846 — SESSION SAVE PATH CONTRACT, at the real client and database boundaries.
//
// What runs for real: `frontend/src/lib/storage.ts` (saveSession, completeSession, getSessionById, updateSession) and
// `frontend/src/services/recordingLease.ts` (the take lease a save must carry), the real `@supabase/supabase-js`
// client, and PostgreSQL (PGlite) with EVERY shipped migration applied in order — so the newest bodies of
// `create_session_and_update_usage` and `complete_session_v2`, the signup trial trigger, RLS, the column grants and
// the retention pins are the production ones, not restated or sliced. The only stand-in is the HTTP hop: a
// PostgREST-shaped fetch (helpers/postgrestPglite.ts) that runs each request as its JWT role in its own transaction.
//
// What it proves: a save writes every metric to the column it belongs in and reads back intact; a refused or failed
// write reaches the caller as a failure and leaves no partial completion; an identical retry recovers and a
// conflicting retry is refused; ownership holds across users. Negative controls show the round-trip assertion goes
// red when the server stops writing a metric or the client stops sending one.
//
// Synthetic PGlite only. No hosted URL, credential, provider or production database is reachable from here.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { FAKE_ANON_KEY, FAKE_SUPABASE_URL, postgrestPglite, testAccessToken, type PostgrestPglite } from './helpers/postgrestPglite';

const holder = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => {
    if (!holder.client) throw new Error('save-path contract: no client bound for this call');
    return holder.client;
  },
}));

import { completeSession, getSessionById, saveSession, updateSession, type CompleteSessionOptions } from '@/lib/storage';
import { __resetTakeLeaseForTests, acquireTakeLease, currentTakeLeaseId, releaseTakeLease } from '@/services/recordingLease';
import logger from '@/lib/logger';
import type { UserProfile } from '@/types/user';

const MIGRATIONS = 'backend/supabase/migrations';
const SHIPPED = readdirSync(MIGRATIONS).filter(f => /^\d{8,14}_.+\.sql$/.test(f)).sort();
const migration = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8');
const V2_SIGNATURE = 'public.complete_session_v2(uuid,text,integer,text,jsonb,integer,double precision,double precision,jsonb,jsonb,text)';

// Only what Supabase provides outside the migrations. Read from the existing shipped-chain suite rather than copied,
// so the two current-chain proofs cannot drift apart.
const SUPABASE_BOOTSTRAP = (() => {
  const m = readFileSync('tests/db/trial-session-v2-current-chain.integration.test.ts', 'utf8').match(/const SUPABASE_BOOTSTRAP = `([\s\S]*?)`;/);
  if (!m) throw new Error('shipped-chain Supabase bootstrap moved: tests/db/trial-session-v2-current-chain.integration.test.ts');
  return m[1];
})();

// Supabase's PLATFORM default privileges on the public schema (set by the platform, not by a migration of ours): every
// table, sequence and function the migrations create is granted to anon, authenticated and service_role, and the
// migrations then REVOKE what must be locked. Without this the entitled-write RLS policies cannot even read the
// caller's own profile row, which production can, so an UPDATE that succeeds in production would fail here.
const PLATFORM_DEFAULT_PRIVILEGES = `
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
`;

async function shippedChain(): Promise<PGlite> {
  const db = new PGlite();
  try {
    await db.exec(SUPABASE_BOOTSTRAP);
    await db.exec(PLATFORM_DEFAULT_PRIVILEGES);
    for (const f of SHIPPED) await db.exec(migration(f));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

/**
 * Install a one-line mutant of the installed complete_session_v2 (or, with `from` null, restore the original) and re-pin
 * it, exactly as the shipped-chain trial suite does, so the retention compatibility guard admits this one intentional
 * change in this isolated database only.
 */
async function installV2Mutant(db: PGlite, original: string, from: string | null, to: string | null): Promise<void> {
  if (from !== null && original.split(from).length !== 2) throw new Error(`mutant target does not occur exactly once: ${from}`);
  await db.exec(from === null || to === null ? original : original.replace(from, to));
  const repinned = await db.query(`UPDATE public.transcript_retention_function_pins SET definition_md5 = md5(pg_get_functiondef($1::regprocedure))
     WHERE signature = $1 RETURNING signature`, [V2_SIGNATURE]);
  if (repinned.rows.length !== 1) throw new Error('could not re-pin the mutant');
}

// ── Synthetic users and clients ─────────────────────────────────────────────────────────────────────────────────
/** A new account through the shipped signup trigger: a live 30-day trial, the same tier a new customer has. */
async function newUser(db: PGlite): Promise<string> {
  const id = randomUUID();
  await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, `save-path-${id}@example.test`]);
  return id;
}

function bindClient(transport: PostgrestPglite, userId: string): void {
  __resetTakeLeaseForTests();
  holder.client = createClient(FAKE_SUPABASE_URL, FAKE_ANON_KEY, {
    accessToken: async () => testAccessToken(userId),
    global: { fetch: transport.fetch },
  });
}

const PROFILE = {} as UserProfile; // saveSession's signature requires it; the save path never reads it.
const NEXT_ACTION = { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'wpm', value: 128, comparator: 'within_target', templateVersion: 'rec_v1' } as const;
const METRICS = {
  totalWords: 131,
  clarityScore: 87.5,
  wpm: 128.25,
  fillerCounts: { um: 3, like: 2, you_know: 1 },
  pauseMetrics: { totalPauses: 6, averagePauseDuration: 0.7, longestPause: 1.9, pausesPerMinute: 5.5, silencePercentage: 12, transitionPauses: 2, extendedPauses: 1 },
};
const TRANSCRIPT = 'synthetic contract take words for the save path';

const completion = (over: Partial<CompleteSessionOptions> = {}): CompleteSessionOptions & { status: 'completed' } => ({
  status: 'completed', duration: 61, nextActionSignal: NEXT_ACTION, metrics: METRICS, finalTranscript: TRANSCRIPT, ...over,
} as CompleteSessionOptions & { status: 'completed' });

/** The app's own start: take the account lease, then create the row carrying it. */
async function startTake(product = 'open_mic'): Promise<string> {
  const lease = await acquireTakeLease({ holderLabel: 'save-path-contract' });
  if (lease.action !== 'start' || currentTakeLeaseId() === null) throw new Error(`lease not acquired: ${JSON.stringify(lease)}`);
  const saved = await saveSession({ user_id: 'ignored-by-server', title: 'Save-path contract take', duration: 0, product } as never,
    PROFILE, 'private', undefined, { engineVersion: 'v2', modelName: 'base', deviceType: 'desktop' });
  if (saved.status !== 'saved') throw new Error(`saveSession did not save: ${JSON.stringify(saved)}`);
  return saved.session.id;
}

type Row = {
  status: string | null; duration: number | null; total_words: number | null; clarity_score: number | null; wpm: number | null;
  filler_counts: unknown; pause_metrics: unknown; next_action_signal: unknown; transcript: string | null; transcript_state: string | null;
  user_id: string; title: string | null;
};
const rowOf = async (db: PGlite, id: string): Promise<Row | undefined> => (await db.query<Row>(
  `SELECT status, duration, total_words, clarity_score, wpm, filler_counts, pause_metrics, next_action_signal, transcript,
          transcript_state, user_id, title FROM public.sessions WHERE id = $1`, [id])).rows[0];

/**
 * THE ROUND-TRIP ASSERTION. Compares what the client asked to persist with what the database actually holds, field by
 * field (JSON compared structurally, so jsonb key order is irrelevant), and returns every field that differs. An empty
 * list is the only pass. Shared by the positive case and every negative control so no control runs a weaker check.
 */
function persistedMismatches(row: Row | undefined, asked: ReturnType<typeof completion>): string[] {
  if (!row) return ['<row missing>'];
  const expected: Record<string, unknown> = {
    status: 'completed',
    duration: asked.duration,
    total_words: asked.metrics?.totalWords,
    clarity_score: asked.metrics?.clarityScore,
    wpm: asked.metrics?.wpm,
    filler_counts: asked.metrics?.fillerCounts,
    pause_metrics: asked.metrics?.pauseMetrics,
    next_action_signal: asked.nextActionSignal,
    transcript: asked.finalTranscript,
    transcript_state: 'available',
  };
  return Object.entries(expected)
    .filter(([key, value]) => !isDeepStrictEqual((row as Record<string, unknown>)[key] ?? null, value ?? null))
    .map(([key]) => key);
}

async function withFault<T>(db: PGlite, event: 'INSERT' | 'UPDATE', sessionId: string | null, body: () => Promise<T>): Promise<T> {
  const when = event === 'UPDATE' && sessionId ? `WHEN (OLD.id = '${sessionId}'::uuid)` : '';
  await db.exec(`
    CREATE FUNCTION public.save_path_fixture_fault() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'synthetic_save_fault ${TRANSCRIPT}'; END $f$;
    CREATE TRIGGER save_path_fixture_fault BEFORE ${event} ON public.sessions
      FOR EACH ROW ${when} EXECUTE FUNCTION public.save_path_fixture_fault();`);
  try { return await body(); }
  finally { await db.exec('DROP TRIGGER save_path_fixture_fault ON public.sessions; DROP FUNCTION public.save_path_fixture_fault();'); }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
let db: PGlite;
let transport: PostgrestPglite;

beforeAll(async () => {
  db = await shippedChain();
  transport = postgrestPglite(db);
}, 180_000);
afterEach(async () => { await releaseTakeLease(); __resetTakeLeaseForTests(); });
afterAll(async () => { holder.client = null; await db?.close(); });

describe('the database under test runs the CURRENT save-path code and access layer', () => {
  const COLUMN_GRANT = /REVOKE UPDATE ON public\.sessions FROM authenticated;\s*GRANT UPDATE \(([^)]*)\) ON public\.sessions TO authenticated;/g;

  it('storage.ts still saves through exactly these two RPCs', () => {
    const source = readFileSync('frontend/src/lib/storage.ts', 'utf8');
    expect(source).toMatch(/supabase\.rpc\('create_session_and_update_usage'/);
    expect(source).toMatch(/supabase\.rpc\('complete_session_v2'/);
  });

  for (const fn of ['create_session_and_update_usage', 'complete_session_v2']) {
    it(`${fn}: the installed body is byte-identical to the newest migration that defines it`, async () => {
      const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\bAS \\$\\$([\\s\\S]*?)\\$\\$;`, 'g');
      const bodies = SHIPPED.flatMap(file => [...migration(file).matchAll(re)].map(m => ({ file, body: m[1] })));
      expect(bodies.length).toBeGreaterThan(0);
      const installed = (await db.query<{ src: string }>(
        `SELECT p.prosrc AS src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1`,
        [fn])).rows.map(r => r.src);
      expect(installed).toEqual([bodies.at(-1)!.body]);
    });
  }

  it('the authenticated UPDATE whitelist on sessions is exactly the newest migration grant, without filler_counts', async () => {
    const grants = SHIPPED.flatMap(file => [...migration(file).matchAll(COLUMN_GRANT)].map(m => m[1].split(',').map(c => c.trim()).sort()));
    const effective = (await db.query<{ c: string }>(
      `SELECT attname AS c FROM pg_attribute WHERE attrelid = 'public.sessions'::regclass AND attnum > 0 AND NOT attisdropped
         AND has_column_privilege('authenticated', 'public.sessions', attname, 'UPDATE') ORDER BY attname`)).rows.map(r => r.c);
    expect(effective).toEqual(grants.at(-1));
    expect(effective).not.toContain('filler_counts');
    expect((await db.query<{ rls: boolean }>("SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'public.sessions'::regclass")).rows[0].rls).toBe(true);
  });
});

describe('ordinary successful save', () => {
  it('saveSession → completeSession writes every metric to its column, and getSessionById reads it back', async () => {
    const user = await newUser(db);
    bindClient(transport, user);
    const before = transport.requests.length;

    const id = await startTake();
    expect((await rowOf(db, id))?.status).toBe('active');
    expect((await rowOf(db, id))?.user_id).toBe(user);

    const asked = completion();
    const result = await completeSession(id, asked);
    expect(result).toMatchObject({ success: true, transcriptOutcome: 'retained', transcriptState: 'available', idempotent: false, finalStatus: 'completed' });
    expect(persistedMismatches(await rowOf(db, id), asked)).toEqual([]);

    const read = await getSessionById(id);
    expect(read).toMatchObject({
      id, user_id: user, status: 'completed', duration: 61, total_words: METRICS.totalWords, wpm: METRICS.wpm,
      clarity_score: METRICS.clarityScore, filler_counts: METRICS.fillerCounts, pause_metrics: METRICS.pauseMetrics,
      next_action_signal: NEXT_ACTION, transcript: TRANSCRIPT, transcript_state: 'available', product: 'open_mic',
    });

    expect(transport.requests.slice(before).map(r => `${r.method} ${r.path} ${r.status}`)).toEqual([
      'POST /rest/v1/rpc/acquire_recording_lease 200',
      'POST /rest/v1/rpc/create_session_and_update_usage 200',
      'POST /rest/v1/rpc/complete_session_v2 200',
      'GET /rest/v1/sessions 200',
    ]);
    expect(transport.unsupported).toEqual([]);
  });

  it('a measured zero ({}) is kept as zero, never read back as "not measured"', async () => {
    bindClient(transport, await newUser(db));
    const id = await startTake();
    const asked = completion({ metrics: { ...METRICS, fillerCounts: {} } });
    expect((await completeSession(id, asked)).success).toBe(true);
    expect((await rowOf(db, id))?.filler_counts).toEqual({});
    expect(persistedMismatches(await rowOf(db, id), asked)).toEqual([]);
  });
});

describe('failures reach the caller and leave no partial completion', () => {
  /** The freshly created row, exactly as the create RPC left it. A failed completion must leave it byte-for-byte so. */
  const activeRow = async (id: string) => {
    const row = await rowOf(db, id);
    expect(row).toMatchObject({ status: 'active', wpm: null, clarity_score: null, filler_counts: null, next_action_signal: null, transcript: null });
    return row;
  };

  it('unmeasured fillers (null) are refused by the server: success=false, and nothing was written', async () => {
    bindClient(transport, await newUser(db));
    const id = await startTake();
    const before = await activeRow(id);
    const result = await completeSession(id, completion({ metrics: { ...METRICS, fillerCounts: null } }));
    expect(result).toEqual({ success: false });
    expect(await rowOf(db, id)).toEqual(before);
  });

  it('a database failure mid-write rolls back the whole completion and is logged content-free', async () => {
    bindClient(transport, await newUser(db));
    const id = await startTake();
    const before = await activeRow(id);
    vi.mocked(logger.error).mockClear();

    const result = await withFault(db, 'UPDATE', id, () => completeSession(id, completion()));
    expect(result).toEqual({ success: false });
    expect(await rowOf(db, id)).toEqual(before);

    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(logged).toContain('P0001');
    expect(logged).not.toContain(TRANSCRIPT); // the fault message quotes the transcript; the log must not
  });

  it('recovery: the identical retry succeeds, a replay is idempotent, a conflicting replay is refused', async () => {
    bindClient(transport, await newUser(db));
    const id = await startTake();
    const asked = completion();

    expect(await withFault(db, 'UPDATE', id, () => completeSession(id, asked))).toEqual({ success: false });
    const retried = await completeSession(id, asked);
    expect(retried).toMatchObject({ success: true, idempotent: false });
    expect(persistedMismatches(await rowOf(db, id), asked)).toEqual([]);

    expect(await completeSession(id, asked)).toMatchObject({ success: true, idempotent: true, transcriptOutcome: 'retained' });

    const saved = await rowOf(db, id);
    expect(await completeSession(id, completion({ metrics: { ...METRICS, wpm: 200 } }))).toEqual({ success: false });
    expect(await rowOf(db, id)).toEqual(saved);
  });

  it('a request lost before the server (network failure) is a failure, and the retry recovers', async () => {
    const user = await newUser(db);
    let dropped = 0;
    const flaky = postgrestPglite(db, req => (req.path.endsWith('/rpc/complete_session_v2') && !dropped++
      ? { networkError: new TypeError('fetch failed') } : undefined));
    bindClient(flaky, user);
    const id = await startTake();
    const before = await activeRow(id);
    const asked = completion();
    expect(await completeSession(id, asked)).toEqual({ success: false });
    expect(await rowOf(db, id)).toEqual(before);
    expect(await completeSession(id, asked)).toMatchObject({ success: true, idempotent: false });
    expect(persistedMismatches(await rowOf(db, id), asked)).toEqual([]);
  });

  it('a response lost AFTER the server committed is a failure to the caller, and the retry is an idempotent replay', async () => {
    const user = await newUser(db);
    let lost = 0;
    const lossy: PostgrestPglite = {
      ...transport,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await transport.fetch(input, init);
        if (new Request(input, init).url.endsWith('/rpc/complete_session_v2') && !lost++) throw new TypeError('fetch failed');
        return response;
      }) as typeof fetch,
    };
    bindClient(lossy, user);
    const id = await startTake();
    const asked = completion();
    expect(await completeSession(id, asked)).toEqual({ success: false });
    expect(persistedMismatches(await rowOf(db, id), asked)).toEqual([]); // it DID land
    expect(await completeSession(id, asked)).toMatchObject({ success: true, idempotent: true, transcriptOutcome: 'retained' });
    expect(persistedMismatches(await rowOf(db, id), asked)).toEqual([]);
  });

  it('saveSession: a database error is rpc_error and creates no row', async () => {
    const user = await newUser(db);
    bindClient(transport, user);
    const result = await withFault(db, 'INSERT', null, () => saveSession({ user_id: user, title: 't', duration: 0, product: 'open_mic' } as never, PROFILE, 'private'));
    expect(result).toEqual({ status: 'failed', reason: 'rpc_error' });
    expect((await db.query('SELECT 1 FROM public.sessions WHERE user_id = $1', [user])).rows).toHaveLength(0);
  });

  it('saveSession: a server refusal in the envelope is server_rejected and creates no row', async () => {
    const user = await newUser(db);
    bindClient(transport, user);
    const result = await saveSession({ user_id: user, title: 't', duration: 0, product: 'not_a_product' } as never, PROFILE, 'private');
    expect(result).toEqual({ status: 'failed', reason: 'server_rejected' });
    expect((await db.query('SELECT 1 FROM public.sessions WHERE user_id = $1', [user])).rows).toHaveLength(0);
  });
});

describe('ownership across users', () => {
  it("another user can neither complete nor read someone else's session", async () => {
    const owner = await newUser(db);
    bindClient(transport, owner);
    const id = await startTake();
    const before = await rowOf(db, id);

    bindClient(transport, await newUser(db));
    expect(await completeSession(id, completion())).toEqual({ success: false });
    expect(await rowOf(db, id)).toEqual(before);
    expect(await getSessionById(id)).toBeNull();
  });

  it('getSessionById: a transport error throws the user-facing load error, a missing row is null', async () => {
    const user = await newUser(db);
    const down = postgrestPglite(db, req => (req.method === 'GET' ? { networkError: new TypeError('fetch failed') } : undefined));
    bindClient(down, user);
    await expect(getSessionById(randomUUID())).rejects.toThrow('Unable to load this session');
    bindClient(transport, user);
    expect(await getSessionById(randomUUID())).toBeNull();
  });
});

describe('updateSession against the real column grants', () => {
  it('a granted column persists', async () => {
    bindClient(transport, await newUser(db));
    const id = await startTake();
    expect(await updateSession(id, { title: 'Renamed take' })).toEqual({ success: true });
    expect((await rowOf(db, id))?.title).toBe('Renamed take');
  });

  it('a metrics write it was once used for (filler_counts) is refused: success=false and the row is unchanged', async () => {
    bindClient(transport, await newUser(db));
    const id = await startTake();
    const before = await rowOf(db, id);
    const result = await updateSession(id, { filler_counts: { um: 1 } } as never);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission denied/i);
    expect(await rowOf(db, id)).toEqual(before);
  });

  it("KNOWN GAP (characterised, not endorsed): an update that RLS filters to zero rows reports success", async () => {
    const owner = await newUser(db);
    bindClient(transport, owner);
    const id = await startTake();
    const before = await rowOf(db, id);
    bindClient(transport, await newUser(db));
    // updateSession has no row-count check, so "nothing matched" is indistinguishable from "saved". It has no
    // production caller today; this pins the behaviour so a future caller cannot assume otherwise unnoticed.
    expect(await updateSession(id, { title: 'not yours' })).toEqual({ success: true });
    expect(await rowOf(db, id)).toEqual(before);
  });
});

describe('negative controls: the round-trip assertion goes red on real regressions', () => {
  const runOrdinary = async (database: PGlite, t: PostgrestPglite) => {
    bindClient(t, await newUser(database));
    const id = await startTake();
    const asked = completion();
    const result = await completeSession(id, asked);
    return { result, mismatches: persistedMismatches(await rowOf(database, id), asked) };
  };

  const serverMutants = [
    { name: 'complete_session_v2 stops writing wpm', from: 'wpm           = COALESCE(p_wpm, wpm),', to: 'wpm           = wpm,', expected: ['wpm'] },
    { name: 'complete_session_v2 stops writing filler_counts', from: 'filler_counts = COALESCE(p_filler_counts, filler_counts),', to: 'filler_counts = filler_counts,', expected: ['filler_counts'] },
    { name: 'complete_session_v2 stops writing pause_metrics', from: 'pause_metrics = COALESCE(p_pause_metrics, pause_metrics),', to: 'pause_metrics = pause_metrics,', expected: ['pause_metrics'] },
  ];
  // One isolated shipped chain for the server mutants; the original definition is restored (and re-pinned) before
  // each, so every mutant differs from the shipped v2 by exactly its one line.
  let mutantDb: PGlite;
  let originalV2: string;
  beforeAll(async () => {
    mutantDb = await shippedChain();
    originalV2 = (await mutantDb.query<{ d: string }>('SELECT pg_get_functiondef($1::regprocedure) AS d', [V2_SIGNATURE])).rows[0].d;
  }, 180_000);
  afterAll(async () => { await mutantDb?.close(); });

  for (const mutant of serverMutants) {
    it(`server: ${mutant.name}`, async () => {
      await installV2Mutant(mutantDb, originalV2, mutant.from, mutant.to);
      try {
        const { result, mismatches } = await runOrdinary(mutantDb, postgrestPglite(mutantDb));
        expect(result.success).toBe(true); // the server still REPORTS success…
        expect(mismatches).toEqual(mutant.expected); // …and only the round-trip check catches the lost metric
      } finally {
        await installV2Mutant(mutantDb, originalV2, null, null);
      }
    }, 60_000);
  }

  it('client: a request that stops carrying p_clarity_score is caught', async () => {
    const dropping = postgrestPglite(db, req => {
      if (!req.path.endsWith('/rpc/complete_session_v2')) return undefined;
      const rest = { ...(req.body as Record<string, unknown>) };
      delete rest.p_clarity_score;
      return { body: rest };
    });
    const { result, mismatches } = await runOrdinary(db, dropping);
    expect(result.success).toBe(true);
    expect(mismatches).toEqual(['clarity_score']);
  });

  it('restored: the unmodified code passes the same check', async () => {
    const { result, mismatches } = await runOrdinary(db, transport);
    expect(result.success).toBe(true);
    expect(mismatches).toEqual([]);
  });
});
