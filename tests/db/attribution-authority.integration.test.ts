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
    process.cwd(), 'backend', 'supabase', 'migrations', '20260803000000_session_attribution_authority.sql',
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
    over: { engine?: string; version?: string; model?: string; device?: string } = {},
): Promise<string> {
    return (await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id, engine, engine_version, model_name, device_type)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [uid, over.engine ?? 'private-v2', over.version ?? 'v2', over.model ?? 'base', over.device ?? 'cpu'],
    )).rows[0].id;
}

/** Service-role challenge issue (service-role/internal only). */
async function issueChallenge(db: Sql, sessionId: string): Promise<string> {
    await db.exec(`SET ROLE service_role`);
    try {
        return (await db.query<{ c: string }>(
            `SELECT public.issue_attribution_challenge_v1($1) AS c`, [sessionId])).rows[0].c;
    } finally { await db.exec(`RESET ROLE`); }
}

/** Service-role attestation. Returns the version string or throws (fail-closed) — caller asserts. */
async function attest(
    db: Sql, sessionId: string, challengeId: string, evidence: Record<string, unknown>,
): Promise<string> {
    await db.exec(`SET ROLE service_role`);
    try {
        return (await db.query<{ v: string }>(
            `SELECT public.attest_private_session_v1($1, $2, $3::jsonb) AS v`,
            [sessionId, challengeId, JSON.stringify(evidence)])).rows[0].v;
    } finally { await db.exec(`RESET ROLE`); }
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
        expect(await attest(db, s, c, GOOD_V2)).toBe('attrib_v1');
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
        const c = await issueChallenge(db, s);
        expect(await attest(db, s, c, GOOD_V4)).toBe('attrib_v1');
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(1);
    });
});

describe('#1161 attribution authority — evidence gate fails closed', () => {
    for (const [name, ev] of [
        ['Browser provider', { ...GOOD_V2, provider: 'web-speech' }],
        ['Cloud used', { ...GOOD_V2, cloud_used: true }],
        ['fallback occurred', { ...GOOD_V2, fallback_occurred: true }],
        ['tiny model', { ...GOOD_V2, model_id: 'tiny' }],
        ['missing provider (malformed)', { fallback_occurred: false, cloud_used: false }],
        ['empty evidence (defaults fail-closed)', {}],
    ] as [string, Record<string, unknown>][]) {
        it(`${name} → no authority row, zero writes`, async () => {
            const db = await makeDb();
            // tiny-model case must exercise the evidence model_id, so persist a non-tiny server model.
            const s = await seedSession(db, USER, { model: name === 'tiny model' ? 'base' : undefined });
            const c = await issueChallenge(db, s);
            await expect(attest(db, s, c, ev)).rejects.toThrow();
            expect(await count(db,
                `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(0);
            // challenge NOT consumed — a rejected attestation leaves it redeemable for a legitimate retry
            expect(await count(db,
                `SELECT count(*) n FROM public.session_attribution_challenge
                 WHERE challenge_id=$1 AND consumed_at IS NULL`, [c])).toBe(1);
        });
    }

    it('tiny model detected from the SERVER session row (client evidence cannot launder it)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER, { model: 'whisper-tiny' });   // server says tiny
        const c = await issueChallenge(db, s);
        await expect(attest(db, s, c, { ...GOOD_V2, model_id: 'base' })).rejects.toThrow(/tiny/);
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(0);
    });
});

describe('#1161 attribution authority — challenge binding', () => {
    it('wrong challenge id fails closed (no authority row)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await issueChallenge(db, s);
        const bogus = '99999999-9999-4999-8999-999999999999';
        await expect(attest(db, s, bogus, GOOD_V2)).rejects.toThrow();
        expect(await count(db,
            `SELECT count(*) n FROM public.session_attribution_authority WHERE session_id=$1`, [s])).toBe(0);
    });

    it('replay of an ALREADY-CONSUMED challenge (authority absent) fails closed', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        const c = await issueChallenge(db, s);
        // Simulate a consumed challenge whose authority write did not land (defensive replay branch). Done as
        // the superuser (default role) — a privileged setup manipulation, not a client-reachable path.
        await db.query(`UPDATE public.session_attribution_challenge SET consumed_at = now() WHERE challenge_id=$1`, [c]);
        await expect(attest(db, s, c, GOOD_V2)).rejects.toThrow(/consumed/);
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
        const bogusChallenge = '77777777-7777-4777-8777-777777777777';
        await expect(attest(db, bogusSession, bogusChallenge, GOOD_V2)).rejects.toThrow();
    });
});

describe('#1161 attribution authority — idempotent / replay-safe re-attest', () => {
    it('second valid attest returns the existing version, mutates nothing', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        const c = await issueChallenge(db, s);
        expect(await attest(db, s, c, GOOD_V2)).toBe('attrib_v1');
        const attestedAt = (await db.query<{ t: string }>(
            `SELECT attested_at::text t FROM public.session_attribution_authority WHERE session_id=$1`, [s])).rows[0].t;
        // A second attest (challenge already consumed, but authority present ⇒ short-circuits to existing version).
        expect(await attest(db, s, c, GOOD_V2)).toBe('attrib_v1');
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
        const c = await issueChallenge(db, s);
        await act(db, USER);
        await db.exec(`SET ROLE authenticated`);
        try {
            await expect(db.query(
                `SELECT public.attest_private_session_v1($1, $2, $3::jsonb)`,
                [s, c, JSON.stringify(GOOD_V2)])).rejects.toThrow(/permission denied/i);
        } finally { await db.exec(`RESET ROLE`); }
    });

    it('authenticated CANNOT issue a challenge (permission denied)', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await act(db, USER);
        await db.exec(`SET ROLE authenticated`);
        try {
            await expect(db.query(
                `SELECT public.issue_attribution_challenge_v1($1)`, [s])).rejects.toThrow(/permission denied/i);
        } finally { await db.exec(`RESET ROLE`); }
    });

    it('authenticated CANNOT INSERT/UPDATE the authority table directly', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        const c = await issueChallenge(db, s);
        await attest(db, s, c, GOOD_V2);
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
        const c = await issueChallenge(db, s);
        await attest(db, s, c, GOOD_V2);
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
        const c = await issueChallenge(db, s);
        await attest(db, s, c, GOOD_V2);
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
        const c = await issueChallenge(db, s);
        await attest(db, s, c, GOOD_V2);
        await db.query(`DELETE FROM auth.users WHERE id=$1`, [USER]);
        expect(await count(db, `SELECT count(*) n FROM public.session_attribution_authority`, [])).toBe(0);
        expect(await count(db, `SELECT count(*) n FROM public.session_attribution_challenge`, [])).toBe(0);
    });
});
