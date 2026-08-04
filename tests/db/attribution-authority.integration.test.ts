// @vitest-environment node
//
// #1161 — EXECUTED real-PostgreSQL adversarial proof for the server-owned, versioned, immutable Private
// attribution AUTHORITY (challenge-bound attestation).
//
// A static SQL-string test cannot catch a syntax error, a wrong grant, or an evidence gate that fails open.
// This suite stands up a REAL throwaway PostgreSQL (PGlite — the repo's DB harness), applies the #1161
// migration file VERBATIM from disk over a production-shaped bootstrap, and EXERCISES the guarded RPCs exactly
// as PostgREST would (auth.uid() from the JWT claim GUC; service-role calls via SET ROLE). Every row of the
// #1161 falsification matrix (contract 5174459053 + frozen decisions 5174505198) maps to a named test below.
//
// Content-free: synthetic UUIDs only — no transcript/audio/customer content.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
    process.cwd(), 'backend', 'supabase', 'migrations', '20260803010000_session_attribution_authority.sql',
);
const BOOTSTRAP_PATH = resolve(process.cwd(), 'tests', 'db', 'attribution-authority-bootstrap.sql');
const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
const bootstrapSql = readFileSync(BOOTSTRAP_PATH, 'utf8');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

type Sql = PGlite;

async function makeDb(): Promise<Sql> {
    const db = new PGlite();
    await db.exec(bootstrapSql);
    await db.exec(migrationSql);
    await db.query(`INSERT INTO auth.users (id) VALUES ($1), ($2)`, [USER, OTHER]);
    return db;
}

const act = (db: Sql, uid: string) => db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);

/** Persist a session row with a chosen server-side engine identity (what the RPC derives ownership + identity
 * from). attribution_status is the transitional client-writable column #1161 supersedes. */
async function seedSession(
    db: Sql, uid: string,
    over: { engine?: string; version?: string; model?: string; device?: string; status?: string } = {},
): Promise<string> {
    return (await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id, engine, engine_version, model_name, device_type, status)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [uid, over.engine ?? 'private-v2', over.version ?? 'v2', over.model ?? 'base', over.device ?? 'cpu',
         over.status ?? 'active'],   // #1161: the PRE-RECORDING state — a challenge is registered here
    )).rows[0].id;
}

/** Transition a session to a terminal state (as the client's completeSession would). */
async function setStatus(db: Sql, sessionId: string, status: string): Promise<void> {
    await db.query(`UPDATE public.sessions SET status = $2 WHERE id = $1`, [sessionId, status]);
}
const complete = (db: Sql, sessionId: string) => setStatus(db, sessionId, 'completed');

/** Service-role PRE-SESSION intent issue + ATOMIC bind to the session (Option 2). Issues the intent keyed on a
 * recording key derived from the session, then binds it — the canonical "this session has a frozen class/model"
 * setup. Returns the bound challenge_id. issue_intent never touches the session; bind enforces owner/expiry/
 * lifecycle/replay, so a denial (e.g. a non-active session) surfaces from bind exactly as the tests expect. */
async function issueChallenge(
    db: Sql, sessionId: string, engineClass = 'private', expectedModel: string | null = 'base',
    recordingKey?: string,
): Promise<string> {
    const uid = (await db.query<{ user_id: string }>(
        `SELECT user_id FROM public.sessions WHERE id=$1`, [sessionId])).rows[0].user_id;
    const key = recordingKey ?? `rec-${sessionId}`;
    await db.exec(`SET ROLE service_role`);
    try {
        await db.query(`SELECT public.issue_attribution_intent_v1($1, $2, $3, $4)`,
            [uid, key, engineClass, expectedModel]);
        return (await db.query<{ c: string }>(
            `SELECT public.bind_attribution_intent_v1($1, $2) AS c`, [sessionId, key])).rows[0].c;
    } finally { await db.exec(`RESET ROLE`); }
}

/** Service-role attestation (finds the session's pre-recording challenge itself). Throws on fail-closed. */
async function attest(db: Sql, sessionId: string, evidence: Record<string, unknown>): Promise<string> {
    await db.exec(`SET ROLE service_role`);
    try {
        return (await db.query<{ v: string }>(
            `SELECT public.attest_session_engine_v1($1, $2::jsonb) AS v`,
            [sessionId, JSON.stringify(evidence)])).rows[0].v;
    } finally { await db.exec(`RESET ROLE`); }
}

/** The canonical flow after a challenge is registered on an ACTIVE session: complete, then attest. */
async function attestCompleted(db: Sql, sessionId: string, evidence: Record<string, unknown>): Promise<string> {
    await complete(db, sessionId);
    return attest(db, sessionId, evidence);
}

/** Assert a completed session resolves DEFINITIVELY unattributed (terminal, no authority, marker written). */
async function expectUnattributed(db: Sql, sessionId: string, evidence: Record<string, unknown>): Promise<void> {
    expect(await attestCompleted(db, sessionId, evidence)).toBe('unattributed');
    expect(await count(db,
        `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [sessionId])).toBe(0);
    expect(await count(db,
        `SELECT count(*) n FROM public.session_attribution_unattributed WHERE session_id=$1`, [sessionId])).toBe(1);
}

const GOOD_V2 = { provider: 'transformers-js', model_id: 'base', fallback_occurred: false, cloud_used: false };
const GOOD_V4 = { provider: 'transformers-js-v4', model_id: 'base_q4', fallback_occurred: false, cloud_used: false };

async function count(db: Sql, sql: string, args: unknown[] = []): Promise<number> {
    return Number((await db.query<{ n: number }>(sql, args)).rows[0].n);
}

describe('#1161 attribution authority — positive attestation', () => {
    it('legit Private v2 completion attests exactly one immutable authority row (attrib_v1)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        const c = await issueChallenge(db, s);
        expect(await attestCompleted(db, s, GOOD_V2)).toBe('attrib_v1');
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1
             AND user_id=$2 AND authority_version='attrib_v1' AND provider='transformers-js'`, [s, USER])).toBe(1);
        // challenge consumed
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_challenge
             WHERE challenge_id=$1 AND consumed_at IS NOT NULL`, [c])).toBe(1);
    });

    it('legit Private v4 (transformers-js-v4) completion attests', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER, { engine: 'private-v4', version: 'v4', model: 'base_q4' });
        await issueChallenge(db, s);
        expect(await attestCompleted(db, s, GOOD_V4)).toBe('attrib_v1');
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(1);
    });
});

describe('#1161 attribution authority — evidence gate fails closed', () => {
    for (const [name, ev] of [
        ['Cloud provider (assemblyai)', { ...GOOD_V2, provider: 'assemblyai' }],
        ['Cloud used flag', { ...GOOD_V2, cloud_used: true }],
        ['fallback occurred', { ...GOOD_V2, fallback_occurred: true }],
        ['unknown provider', { ...GOOD_V2, provider: 'mystery-engine' }],
        ['missing provider (malformed)', { fallback_occurred: false, cloud_used: false }],
        ['empty evidence (defaults fail-closed)', {}],
    ] as [string, Record<string, unknown>][]) {
        it(`${name} → definitively UNATTRIBUTED (terminal), no authority, challenge consumed`, async () => {
            const db = await makeDb();
            const s = await seedSession(db, USER);
            const c = await issueChallenge(db, s);   // a legitimate Private pre-recording challenge
            await expectUnattributed(db, s, ev);
            // the challenge is consumed exactly once — the outcome is terminal (single-use), not retryable
            expect(await count(db,
                `SELECT count(*) n FROM public.session_attribution_challenge
                 WHERE challenge_id=$1 AND consumed_at IS NOT NULL`, [c])).toBe(1);
        });
    }

    it('tiny model on the Private CHALLENGE provenance is not attestable', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueChallenge(db, s, 'private', 'whisper-tiny');   // the provenance is tiny
        await expectUnattributed(db, s, GOOD_V2);
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(0);
    });

    it('a Private challenge with a BLANK model provenance cannot be issued (finding 4)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await expect(issueChallenge(db, s, 'private', '  ')).rejects.toThrow(/model provenance/);
        await expect(issueChallenge(db, s, 'private', null)).rejects.toThrow(/model provenance/);
    });
});

describe('#1161 attribution authority — challenge binding', () => {
    it('NO pre-recording challenge → attest fails closed (completion cannot mint one)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);   // completed session, but no challenge was ever issued
        await expectUnattributed(db, s, GOOD_V2);
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(0);
    });

    it('unattributed resolution is idempotent/replay-safe — a re-attest returns unattributed, one marker', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueChallenge(db, s);
        // definitive rejection (Cloud) resolves terminally unattributed
        expect(await attestCompleted(db, s, { ...GOOD_V2, cloud_used: true })).toBe('unattributed');
        // a replay short-circuits on the terminal marker — still exactly one marker, still no authority
        expect(await attest(db, s, GOOD_V2)).toBe('unattributed');
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_unattributed WHERE session_id=$1`, [s])).toBe(1);
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(0);
    });

    it('challenge issue is idempotent — one open challenge per session', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        const c1 = await issueChallenge(db, s);
        const c2 = await issueChallenge(db, s);
        expect(c1).toBe(c2);
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_challenge WHERE session_id=$1`, [s])).toBe(1);
    });

    it('attestation for a nonexistent session raises (no data)', async () => {
        const db = await makeDb();
        const bogusSession = '88888888-8888-4888-8888-888888888888';
        await expect(attest(db, bogusSession, GOOD_V2)).rejects.toThrow();
    });
});

describe('#1161 attribution authority — idempotent / replay-safe re-attest', () => {
    it('second valid attest returns the existing version, mutates nothing', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueChallenge(db, s);
        expect(await attestCompleted(db, s, GOOD_V2)).toBe('attrib_v1');
        const attestedAt = (await db.query<{ t: string }>(
            `SELECT attested_at::text t FROM public.session_attribution_authority WHERE session_id=$1`, [s])).rows[0].t;
        // A second attest (challenge already consumed, but authority present ⇒ short-circuits to existing version).
        expect(await attestCompleted(db, s, GOOD_V2)).toBe('attrib_v1');
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(1);
        expect((await db.query<{ t: string }>(
            `SELECT attested_at::text t FROM public.session_attribution_authority WHERE session_id=$1`, [s])).rows[0].t)
            .toBe(attestedAt);   // unchanged — immutable
    });
});

describe('#1161 attribution authority — ACL: no client write path', () => {
    it('authenticated CANNOT execute the attestation RPC (permission denied)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueChallenge(db, s);
        await act(db, USER);
        await db.exec(`SET ROLE authenticated`);
        try {
            await expect(db.query(
                `SELECT public.attest_session_engine_v1($1, $2::jsonb)`,
                [s, JSON.stringify(GOOD_V2)])).rejects.toThrow(/permission denied/i);
        } finally { await db.exec(`RESET ROLE`); }
    });

    it('authenticated CANNOT issue an intent NOR bind one (permission denied)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await act(db, USER);
        await db.exec(`SET ROLE authenticated`);
        try {
            await expect(db.query(
                `SELECT public.issue_attribution_intent_v1($1, 'rec-x', 'private', 'base')`, [USER]))
                .rejects.toThrow(/permission denied/i);
            await expect(db.query(
                `SELECT public.bind_attribution_intent_v1($1, 'rec-x')`, [s]))
                .rejects.toThrow(/permission denied/i);
        } finally { await db.exec(`RESET ROLE`); }
    });

    it('authenticated CANNOT INSERT/UPDATE the authority table directly', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueChallenge(db, s);
        await attestCompleted(db, s, GOOD_V2);
        await act(db, USER);
        await db.exec(`SET ROLE authenticated`);
        try {
            await expect(db.query(
                `INSERT INTO public.session_attribution_authority(session_id,user_id,engine,provider)
                 VALUES ($1,$2,'x','transformers-js')`, [s, USER])).rejects.toThrow(/permission denied/i);
            await expect(db.query(
                `UPDATE public.session_attribution_authority SET provider='forged' WHERE session_id=$1`, [s]))
                .rejects.toThrow(/permission denied/i);
        } finally { await db.exec(`RESET ROLE`); }
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1
             AND provider='transformers-js'`, [s])).toBe(1);   // unchanged
    });

    it('authenticated CANNOT write the challenge table directly', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await act(db, USER);
        await db.exec(`SET ROLE authenticated`);
        try {
            await expect(db.query(
                `INSERT INTO public.session_attribution_challenge(session_id,user_id) VALUES ($1,$2)`, [s, USER]))
                .rejects.toThrow(/permission denied/i);
        } finally { await db.exec(`RESET ROLE`); }
    });
});

describe('#1161 sessions UPDATE lockdown — table-level revoke + safe-column re-grant', () => {
    it('authenticated CAN update safe operational columns (title, transcript)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await act(db, USER);
        await db.exec(`SET ROLE authenticated`);
        try {
            await db.query(`UPDATE public.sessions SET title='t', transcript='x' WHERE id=$1 AND user_id=$2`,
                [s, USER]);
        } finally { await db.exec(`RESET ROLE`); }
        expect(await count(db, `SELECT count(*) n FROM public.sessions WHERE id=$1 AND title='t'`, [s])).toBe(1);
    });

    for (const col of ['attribution_status', 'engine', 'engine_version', 'model_name', 'device_type']) {
        it(`authenticated CANNOT update the locked identity column ${col} (permission denied)`, async () => {
            const db = await makeDb();
            const s = await seedSession(db, USER);
            await act(db, USER);
            await db.exec(`SET ROLE authenticated`);
            try {
                await expect(db.query(
                    `UPDATE public.sessions SET ${col}='forged' WHERE id=$1 AND user_id=$2`, [s, USER]))
                    .rejects.toThrow(/permission denied/i);
            } finally { await db.exec(`RESET ROLE`); }
        });
    }
});

describe('#1161 attribution authority — consumer read + ownership', () => {
    it('get_attribution_authority_v1 returns attrib_v1 for the owner after attestation', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueChallenge(db, s);
        await attestCompleted(db, s, GOOD_V2);
        await act(db, USER);
        expect((await db.query<{ v: string | null }>(
            `SELECT public.get_attribution_authority_v1($1) v`, [s])).rows[0].v).toBe('attrib_v1');
    });

    it('pending (no authority) reads NULL — consumers fail closed', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await act(db, USER);
        expect((await db.query<{ v: string | null }>(
            `SELECT public.get_attribution_authority_v1($1) v`, [s])).rows[0].v).toBeNull();
    });

    it('a foreign user reads NULL for someone else\'s attested session', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueChallenge(db, s);
        await attestCompleted(db, s, GOOD_V2);
        await act(db, OTHER);
        expect((await db.query<{ v: string | null }>(
            `SELECT public.get_attribution_authority_v1($1) v`, [s])).rows[0].v).toBeNull();
        // RLS also hides the row on a direct select
        await db.exec(`SET ROLE authenticated`);
        try {
            expect(await count(db,
                `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(0);
        } finally { await db.exec(`RESET ROLE`); }
    });
});

describe('#1161 attribution authority — no legacy backfill + cascade', () => {
    it('a pre-existing verified-legacy session gets NO authority without a fresh attestation', async () => {
        const db = await makeDb();
        // Legacy row: attribution_status flipped verified by the OLD client path — must NOT confer authority.
        const s = (await db.query<{ id: string }>(
            `INSERT INTO public.sessions (user_id, engine, attribution_status) VALUES ($1,'private-v2','verified')
             RETURNING id`, [USER])).rows[0].id;
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(0);
        await act(db, USER);
        expect((await db.query<{ v: string | null }>(
            `SELECT public.get_attribution_authority_v1($1) v`, [s])).rows[0].v).toBeNull();
    });

    it('deleting the owner cascades away authority + challenge rows', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueChallenge(db, s);
        await attestCompleted(db, s, GOOD_V2);
        await db.query(`DELETE FROM auth.users WHERE id=$1`, [USER]);
        expect(await count(db, `SELECT count(*) n FROM public.session_attribution_authority`, [])).toBe(0);
        expect(await count(db, `SELECT count(*) n FROM public.session_attribution_challenge`, [])).toBe(0);
    });
});

describe('#1161 attribution authority — identity from persisted session (no caller promotion)', () => {
    it('authority records the PERSISTED identity; caller evidence identity is ignored + sessions NOT overwritten', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER,
            { engine: 'private-v2', version: 'v2', model: 'base', device: 'wasm' });
        await issueChallenge(db, s);
        // Caller sends DIFFERENT identity fields — same class (consistent), but they must NOT be promoted.
        await attestCompleted(db, s, {
            provider: 'transformers-js', engine: 'attacker-engine', engine_version: 'attacker-v9',
            model_id: 'attacker-model', resolved_device: 'attacker-device', fallback_occurred: false, cloud_used: false,
        });
        // the authority carries the PERSISTED identity, NOT the caller's payload
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority
             WHERE session_id=$1 AND engine_class='private' AND engine='private-v2'
               AND engine_version='v2' AND model_id='base' AND resolved_device='wasm'`, [s])).toBe(1);
        // the locked sessions columns are UNCHANGED (never overwritten from caller evidence)
        const row = (await db.query<Record<string, string>>(
            `SELECT engine, engine_version, model_name, device_type, attribution_status
             FROM public.sessions WHERE id=$1`, [s])).rows[0];
        expect(row).toEqual({
            engine: 'private-v2', engine_version: 'v2', model_name: 'base',
            device_type: 'wasm', attribution_status: 'pending',   // advisory column NOT promoted by attest
        });
    });

    it('a rejected attestation writes NO authority row and does not touch sessions (fail-closed)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER, { engine: 'private-v2', model: 'base' });
        await issueChallenge(db, s);
        await expectUnattributed(db, s, { ...GOOD_V2, cloud_used: true });
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(0);
        const row = (await db.query<Record<string, string>>(
            `SELECT engine, attribution_status FROM public.sessions WHERE id=$1`, [s])).rows[0];
        expect(row.engine).toBe('private-v2');          // untouched
        expect(row.attribution_status).toBe('pending'); // never promoted
    });
});

describe('#1161 attribution authority — P1: swap denial + terminal-completion gate', () => {
    const BROWSER_EV = { provider: 'web-speech', engine: 'native', fallback_occurred: false, cloud_used: false };
    const PRIVATE_EV = { provider: 'transformers-js', model_id: 'base', fallback_occurred: false, cloud_used: false };

    it('Browser→Private swap denied: a BROWSER challenge + Private evidence → no authority', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueChallenge(db, s, 'browser', null);   // the server-frozen class is browser
        await expectUnattributed(db, s, PRIVATE_EV);
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(0);
    });

    it('Private→Browser swap denied: a PRIVATE challenge + Browser evidence → no authority', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueChallenge(db, s, 'private', 'base');   // the server-frozen class is private
        await expectUnattributed(db, s, BROWSER_EV);
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(0);
    });

    it('the guarded issue RPC rejects an invalid engine class (only private|browser)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await expect(issueChallenge(db, s, 'cloud', null)).rejects.toThrow(/invalid engine class/);
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_challenge WHERE session_id=$1`, [s])).toBe(0);
    });

    for (const status of ['pending', 'active', 'failed']) {
        it(`a non-completed (${status}) session receives NO authority (terminal-completion gate)`, async () => {
            const db = await makeDb();
            const s = await seedSession(db, USER);              // active — register succeeds here
            const c = await issueChallenge(db, s);
            if (status !== 'active') await setStatus(db, s, status);
            await expect(attest(db, s, PRIVATE_EV)).rejects.toThrow(/not durably completed/);
            expect(await count(db,
                `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(0);
            // the challenge is NOT consumed — a later legitimate completion can still attest
            expect(await count(db,
                `SELECT count(*) n FROM public.session_attribution_challenge
                 WHERE challenge_id=$1 AND consumed_at IS NULL`, [c])).toBe(1);
        });
    }
});

describe('#1161 attribution authority — P1: post-completion registration denial (pre-recording lifecycle)', () => {
    for (const status of ['completed', 'failed', 'pending']) {
        it(`a ${status} (non-pre-recording) session CANNOT register a challenge → zero challenge, zero authority`, async () => {
            const db = await makeDb();
            const s = await seedSession(db, USER, { status });
            await expect(issueChallenge(db, s)).rejects.toThrow(/not in the pre-recording state/);
            expect(await count(db,
                `SELECT count(*) n FROM public.session_attribution_challenge WHERE session_id=$1`, [s])).toBe(0);
            // and with no challenge, even a completed session cannot be attested
            await setStatus(db, s, 'completed');
            expect(await attest(db, s, GOOD_V2)).toBe('unattributed'); // definitive: never registered
            expect(await count(db,
                `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(0);
        });
    }

    it('legitimate lifecycle: register (active) → complete → attest → exactly one authority', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);          // active
        await issueChallenge(db, s, 'private', 'base'); // register BEFORE completion
        await complete(db, s);                          // then completion
        expect(await attest(db, s, GOOD_V2)).toBe('attrib_v1');
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1
             AND engine_class='private'`, [s])).toBe(1);
    });

    it('register-vs-complete: if completion wins first, registration is denied (no challenge)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await complete(db, s);                          // completion committed first
        await expect(issueChallenge(db, s)).rejects.toThrow(/not in the pre-recording state/);
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_challenge WHERE session_id=$1`, [s])).toBe(0);
    });

    it('#1161 P1-2: an authenticated caller CANNOT reset a completed session to active (monotonic trigger)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);          // active
        await complete(db, s);                          // terminal
        // the reset→re-register bypass is denied at the DB regardless of the client's status grant
        await act(db, USER);
        await db.exec(`SET ROLE authenticated`);
        try {
            await expect(db.query(`UPDATE public.sessions SET status='active' WHERE id=$1`, [s]))
                .rejects.toThrow(/terminal and cannot revert/);
        } finally { await db.exec(`RESET ROLE`); }
        // status stays completed; the reset attack cannot re-open the register window
        expect(await count(db,
            `SELECT count(*) n FROM public.sessions WHERE id=$1 AND status='completed'`, [s])).toBe(1);
    });
});

const GOOD_BROWSER = { provider: 'web-speech', engine: 'native', fallback_occurred: false, cloud_used: false };

describe('#1161 attribution authority — engine classes (private vs browser)', () => {
    it('Private (transformers-js) attests as engine_class=private', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueChallenge(db, s);
        expect(await attestCompleted(db, s, GOOD_V2)).toBe('attrib_v1');
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority
             WHERE session_id=$1 AND engine_class='private'`, [s])).toBe(1);
        await act(db, USER);
        expect((await db.query<{ c: string | null }>(
            `SELECT public.get_session_engine_class_v1($1) c`, [s])).rows[0].c).toBe('private');
    });

    it('Browser (web-speech) attests as engine_class=browser — Progress-eligible, not Private', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER, { engine: 'native' });
        await issueChallenge(db, s, 'browser', null);
        expect(await attestCompleted(db, s, GOOD_BROWSER)).toBe('attrib_v1');
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority
             WHERE session_id=$1 AND engine_class='browser' AND provider='web-speech'`, [s])).toBe(1);
        await act(db, USER);
        expect((await db.query<{ c: string | null }>(
            `SELECT public.get_session_engine_class_v1($1) c`, [s])).rows[0].c).toBe('browser');
        // Guided requires 'private' → a Browser class is never Guided-eligible.
        expect((await db.query<{ c: string | null }>(
            `SELECT public.get_session_engine_class_v1($1) c`, [s])).rows[0].c).not.toBe('private');
    });

    it('the tiny-model gate does NOT apply to Browser (native engine has no model)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER, { engine: 'native' });
        await issueChallenge(db, s, 'browser', null);   // Browser challenge carries no model
        // Browser path skips the Private-only tiny gate → still attests as browser.
        expect(await attestCompleted(db, s, GOOD_BROWSER)).toBe('attrib_v1');
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority
             WHERE session_id=$1 AND engine_class='browser'`, [s])).toBe(1);
    });

    it('pending session reads NULL engine class (fail-closed for Guided + Progress)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await act(db, USER);
        expect((await db.query<{ c: string | null }>(
            `SELECT public.get_session_engine_class_v1($1) c`, [s])).rows[0].c).toBeNull();
    });
});

// ── Option 2 pre-session INTENT guards: ownership, expiry, single-bind replay, atomic one-per-session ─────────
async function issueIntent(db: Sql, uid: string, key: string, cls = 'private', model: string | null = 'base',
    ttl = 900): Promise<string> {
    await db.exec(`SET ROLE service_role`);
    try {
        return (await db.query<{ c: string }>(
            `SELECT public.issue_attribution_intent_v1($1,$2,$3,$4,$5) AS c`, [uid, key, cls, model, ttl])).rows[0].c;
    } finally { await db.exec(`RESET ROLE`); }
}
async function bindIntent(db: Sql, sessionId: string, key: string): Promise<string | null> {
    await db.exec(`SET ROLE service_role`);
    try {
        return (await db.query<{ c: string | null }>(
            `SELECT public.bind_attribution_intent_v1($1,$2) AS c`, [sessionId, key])).rows[0].c;
    } finally { await db.exec(`RESET ROLE`); }
}

describe('#1161 pre-session intent — ownership / expiry / replay / atomic single-bind', () => {
    it('OWNERSHIP: an intent issued for one user cannot bind another user\'s session', async () => {
        const db = await makeDb();
        const sOther = await seedSession(db, OTHER);
        await issueIntent(db, USER, 'rk-own');                 // USER's intent
        expect(await bindIntent(db, sOther, 'rk-own')).toBeNull();   // cannot bind OTHER's session
        // …and OTHER's completed session therefore resolves definitively unattributed (never bound)
        await complete(db, sOther);
        expect(await attest(db, sOther, GOOD_V2)).toBe('unattributed');
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [sOther])).toBe(0);
    });

    it('EXPIRY: an expired intent cannot be bound (stale/replayed intent is rejected)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueIntent(db, USER, 'rk-exp');
        // simulate the pre-recording window elapsing before the session was produced (as the table owner)
        await db.query(`UPDATE public.session_attribution_challenge SET expires_at = now() - interval '1 second'
            WHERE user_id=$1 AND recording_key='rk-exp'`, [USER]);
        expect(await bindIntent(db, s, 'rk-exp')).toBeNull();       // expired ⇒ no bind
        await complete(db, s);
        expect(await attest(db, s, GOOD_V2)).toBe('unattributed');
    });

    it('REPLAY: a bound intent cannot be re-bound to a DIFFERENT session (single-bind)', async () => {
        const db = await makeDb();
        const sA = await seedSession(db, USER);
        const sB = await seedSession(db, USER);
        await issueIntent(db, USER, 'rk-replay');
        expect(await bindIntent(db, sA, 'rk-replay')).not.toBeNull();  // binds A
        expect(await bindIntent(db, sB, 'rk-replay')).toBeNull();      // cannot steal it for B
        // A keeps the intent; B has none → B resolves unattributed, A attests
        await complete(db, sB);
        expect(await attest(db, sB, GOOD_V2)).toBe('unattributed');
        await complete(db, sA);
        expect(await attest(db, sA, GOOD_V2)).toBe('attrib_v1');
    });

    it('IDEMPOTENT bind: re-binding the SAME session is a no-op success (same challenge)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueIntent(db, USER, 'rk-idem');
        const c1 = await bindIntent(db, s, 'rk-idem');
        const c2 = await bindIntent(db, s, 'rk-idem');
        expect(c1).not.toBeNull();
        expect(c2).toBe(c1);
    });

    it('ATOMIC one-per-session: a SECOND intent cannot bind an already-bound session (unique)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueIntent(db, USER, 'rk-a');
        await issueIntent(db, USER, 'rk-b');
        expect(await bindIntent(db, s, 'rk-a')).not.toBeNull();
        // the partial UNIQUE(session_id) index rejects a second intent claiming the same session
        await expect(bindIntent(db, s, 'rk-b')).rejects.toThrow(/unique|duplicate/i);
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_challenge WHERE session_id=$1`, [s])).toBe(1);
    });
});
