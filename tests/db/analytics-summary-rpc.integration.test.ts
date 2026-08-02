// @vitest-environment node
//
// #1091 — EXECUTED proof for get_analytics_summary (migration 20260729130000).
//
// A static SQL-string contract test cannot catch a syntax error, a type mismatch, or a wrong JSON key.
// This suite stands up a REAL, throwaway PostgreSQL (PGlite — PostgreSQL compiled to WASM, already a
// repo dependency and already the DB harness used by session-attribution-controller.integration.test.ts),
// applies the migration file VERBATIM from disk, seeds fixtures, and EXECUTES the function.
//
// Nothing here touches any hosted environment: each test gets its own in-memory database that is
// discarded when the process exits.
//
// The bootstrap (analytics-summary-bootstrap.sql) supplies only what a bare engine lacks and Supabase
// preinstalls: the auth schema + auth.uid(), the authenticated/service_role roles, and the final shape of
// public.sessions. The artefact under test — the migration — is never rewritten or paraphrased.
//
// Content-free: synthetic UUIDs and synthetic transcripts only.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateOverallStats } from '../../frontend/src/lib/analyticsUtils';
import type { PracticeSession } from '../../frontend/src/types/session';

const MIGRATION_PATH = resolve(
    process.cwd(), 'backend', 'supabase', 'migrations',
    '20260729130000_analytics_summary_evidence_validity.sql',
);
// #1047: the additive redefinition gating contributors on explicit transcript_state.
const PROVENANCE_MIGRATION_PATH = resolve(
    process.cwd(), 'backend', 'supabase', 'migrations',
    '20260801010000_analytics_summary_transcript_provenance.sql',
);
const BOOTSTRAP_PATH = resolve(process.cwd(), 'tests', 'db', 'analytics-summary-bootstrap.sql');

const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
const provenanceMigrationSql = readFileSync(PROVENANCE_MIGRATION_PATH, 'utf8');
const bootstrapSql = readFileSync(BOOTSTRAP_PATH, 'utf8');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

/** A fixture row. Mirrors the columns of public.sessions that the RPC and the client both read. */
interface Fixture {
    label: string;
    created_at: string;
    duration: number | null;
    total_words: number | null;
    clarity_score: number | null;
    wpm: number | null;
    accuracy: number | null;
    engine: string | null;
    transcript: string | null;
    filler_words: Record<string, { count: number }> | null;
    pause_metrics: Record<string, number> | null;
    transcript_state?: string; // #1047: server-owned provenance; defaults to 'available' for existing fixtures
}

const fx = (label: string, over: Partial<Fixture> = {}): Fixture => ({
    label,
    created_at: '2026-07-01T10:00:00Z',
    duration: 60,
    total_words: 120,
    clarity_score: 80,
    wpm: 120,
    accuracy: 0.9,
    engine: 'private-v2',
    transcript: null,
    filler_words: { um: { count: 2 }, total: { count: 2 } },
    pause_metrics: { transitionPauses: 1, extendedPauses: 1, averagePauseMs: 800, totalPauseMs: 1600 },
    transcript_state: 'available',
    ...over,
});

/**
 * THE FIXTURE MATRIX. Every row is a state the production database genuinely reaches.
 * `transcript` is deliberately word-count-matched to `total_words` so the client and the RPC are
 * measuring the same speech and any difference is the RULE, not the fixture.
 */
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const MATRIX: Fixture[] = [
    // 1. MISSING EVIDENCE — phase 2c (`updateSession`) failed. The transcript was saved; the metrics
    //    were not. This is the row that produced "Clear Delivery 0%" for the 59-session account.
    fx('missing-evidence', {
        created_at: '2026-07-01T10:00:00Z',
        clarity_score: null, total_words: null, wpm: null, accuracy: null,
        filler_words: null, pause_metrics: null, transcript: null,
    }),
    // 2. GENUINE MEASURED ZERO — real speech that genuinely scored 0. Evidence, and it must COUNT.
    fx('genuine-zero', {
        created_at: '2026-07-02T10:00:00Z',
        clarity_score: 0, total_words: 50, transcript: words(50),
        filler_words: { um: { count: 30 }, total: { count: 30 } },
    }),
    // 3. VALID NONZERO — the ordinary healthy session.
    fx('valid-nonzero', {
        created_at: '2026-07-03T10:00:00Z',
        clarity_score: 88, total_words: 120, transcript: words(120),
    }),
    // 4. WORDLESS — mic on, nothing transcribed. Duration > 0, so the old filler rate reported a
    //    flattering "0.0/min" for silence.
    fx('wordless', {
        created_at: '2026-07-04T10:00:00Z',
        duration: 6, total_words: 0, clarity_score: null, wpm: null, transcript: '',
        filler_words: { total: { count: 0 } }, pause_metrics: null,
    }),
    // 5. SHORT — below the clarity contributor rule (3 words). Carries a clarity_score, but too little
    //    speech for it to mean anything.
    fx('short-below-rule', {
        created_at: '2026-07-05T10:00:00Z',
        duration: 4, total_words: 2, clarity_score: 40, transcript: words(2),
        filler_words: { total: { count: 0 } },
    }),
    // 6. MALFORMED — filler_words is a structurally empty object (the column DEFAULT), pause_metrics
    //    likewise. Not usable evidence, but the row is otherwise a normal scorable session.
    fx('malformed-filler', {
        created_at: '2026-07-06T10:00:00Z',
        clarity_score: 71, total_words: 90, transcript: words(90),
        filler_words: {}, pause_metrics: {},
    }),
];

type Summary = {
    overallStats: Record<string, unknown> & { chartData: { date: string; clarity: number | null }[] };
    accuracyData: { date: string; accuracy: number; engine: string }[];
    topFillerWords: unknown[];
    weeklySessionsCount: number;
};

const makeDb = async (): Promise<PGlite> => {
    const db = new PGlite();
    await db.exec(bootstrapSql);
    await db.exec(migrationSql);
    await db.exec(provenanceMigrationSql); // #1047: redefine get_analytics_summary to gate on transcript_state
    await db.exec(`INSERT INTO auth.users (id) VALUES ('${USER}'), ('${OTHER_USER}')`);
    return db;
};

const seed = async (db: PGlite, rows: Fixture[], userId = USER) => {
    for (const r of rows) {
        await db.query(
            `INSERT INTO public.sessions
                (user_id, created_at, duration, total_words, clarity_score, wpm, accuracy, engine,
                 transcript, filler_words, pause_metrics, title, transcript_state)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
                userId, r.created_at, r.duration, r.total_words, r.clarity_score, r.wpm, r.accuracy,
                r.engine, r.transcript,
                r.filler_words === null ? null : JSON.stringify(r.filler_words),
                r.pause_metrics === null ? null : JSON.stringify(r.pause_metrics),
                r.label, r.transcript_state ?? 'available',
            ],
        );
    }
};

/** Execute the RPC as the given user, exactly as PostgREST would (auth.uid() from the JWT claim GUC). */
const callRpc = async (db: PGlite, actingAs: string, forUser = actingAs): Promise<Summary> => {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [actingAs]);
    const res = await db.query<{ get_analytics_summary: Summary }>(
        'SELECT get_analytics_summary($1) AS get_analytics_summary', [forUser],
    );
    return res.rows[0].get_analytics_summary;
};

/** The same fixture rows as the client sees them, so the two paths measure identical input. */
const asPracticeSessions = (rows: Fixture[]): PracticeSession[] =>
    [...rows].reverse().map((r, i) => ({
        id: `00000000-0000-4000-8000-00000000000${i}`,
        user_id: USER,
        created_at: r.created_at,
        duration: r.duration,
        total_words: r.total_words,
        clarity_score: r.clarity_score,
        wpm: r.wpm,
        accuracy: r.accuracy,
        engine: r.engine,
        transcript: r.transcript,
        filler_words: r.filler_words,
        pause_metrics: r.pause_metrics,
        custom_words: null,
    }) as unknown as PracticeSession);

describe('#1091 get_analytics_summary — EXECUTED in a real PostgreSQL', () => {
    let version = '';

    beforeAll(async () => {
        const db = new PGlite();
        version = (await db.query<{ version: string }>('SELECT version()')).rows[0].version;
    });

    it('runs on a genuine PostgreSQL engine, not a simulation', () => {
        expect(version).toMatch(/PostgreSQL/);
    });

    it('applies the migration file verbatim without a syntax or type error', async () => {
        // This is the assertion the static contract test could never make.
        const db = await makeDb();
        const fn = await db.query<{ proname: string; prosecdef: boolean }>(
            `SELECT proname, prosecdef FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND proname = 'get_analytics_summary'`,
        );
        expect(fn.rows).toHaveLength(1);
        expect(fn.rows[0].prosecdef).toBe(true);
    });

    describe('authorization', () => {
        it('refuses to return another user\'s analytics', async () => {
            const db = await makeDb();
            await seed(db, MATRIX);
            await expect(callRpc(db, USER, OTHER_USER)).rejects.toThrow(/Unauthorized/);
        });

        it('returns only the calling user\'s rows, never another user\'s', async () => {
            const db = await makeDb();
            await seed(db, MATRIX, USER);
            await seed(db, [fx('other-1'), fx('other-2'), fx('other-3')], OTHER_USER);
            const mine = await callRpc(db, USER);
            expect(mine.overallStats.totalSessions).toBe(MATRIX.length);
        });

        it('keeps EXECUTE granted to authenticated so the product path still works', async () => {
            // The full privilege matrix (PUBLIC/anon/service_role) is a separate security finding and is
            // proved in tests/db/analytics-summary-security.integration.test.ts.
            const db = await makeDb();
            const grants = await db.query<{ grantee: string }>(
                `SELECT grantee FROM information_schema.role_routine_grants
                 WHERE routine_name = 'get_analytics_summary' AND privilege_type = 'EXECUTE'`,
            );
            expect(grants.rows.map(r => r.grantee)).toContain('authenticated');
        });
    });

    describe('backward compatibility of the returned JSON', () => {
        it('still returns every top-level key its consumers read', async () => {
            const db = await makeDb();
            await seed(db, MATRIX);
            const summary = await callRpc(db, USER);
            for (const key of [
                'overallStats', 'topFillerWords', 'fillerWordTrends',
                'accuracyData', 'weeklySessionsCount', 'weeklyActivity',
            ]) {
                expect(summary).toHaveProperty(key);
            }
        });

        it('still returns every overallStats key, none renamed', async () => {
            const db = await makeDb();
            await seed(db, MATRIX);
            const { overallStats } = await callRpc(db, USER);
            for (const key of [
                'totalSessions', 'totalPracticeTime', 'avgWpm',
                'avgFillerWordsPerMin', 'avgAccuracy', 'chartData',
            ]) {
                expect(overallStats).toHaveProperty(key);
            }
        });

        it('adds the new evidence keys alongside the old ones', async () => {
            const db = await makeDb();
            await seed(db, MATRIX);
            const { overallStats } = await callRpc(db, USER);
            for (const key of [
                'avgClarity', 'clarityContributorCount',
                'wpmContributorCount', 'fillerRateContributorCount',
            ]) {
                expect(overallStats).toHaveProperty(key);
            }
        });

        it('keeps avgAccuracy carrying the same corrected clarity value as avgClarity', async () => {
            const db = await makeDb();
            await seed(db, MATRIX);
            const { overallStats } = await callRpc(db, USER);
            expect(overallStats.avgAccuracy).toBe(overallStats.avgClarity);
        });
    });

    describe('contributor counts are correct per metric', () => {
        it('counts only rows with a real clarity value AND enough words', async () => {
            const db = await makeDb();
            await seed(db, MATRIX);
            const { overallStats } = await callRpc(db, USER);
            // genuine-zero (0 / 50w), valid-nonzero (88 / 120w), malformed-filler (71 / 90w) qualify.
            // missing-evidence (NULL), wordless (NULL), short-below-rule (2 words) do not.
            expect(overallStats.clarityContributorCount).toBe(3);
        });

        it('averages clarity over those contributors only — the genuine zero still counts', async () => {
            const db = await makeDb();
            await seed(db, MATRIX);
            const { overallStats } = await callRpc(db, USER);
            // (0 + 88 + 71) / 3 = 53.0. The old function divided by all 6 and would have said 26.5.
            expect(Number(overallStats.avgClarity)).toBeCloseTo(53.0, 1);
            expect(Number(overallStats.avgClarity)).not.toBeCloseTo((0 + 88 + 71) / 6, 1);
        });

        it('counts pace/filler contributors as rows carrying both words and duration', async () => {
            const db = await makeDb();
            await seed(db, MATRIX);
            const { overallStats } = await callRpc(db, USER);
            // genuine-zero, valid-nonzero, short-below-rule, malformed-filler have words + duration.
            // missing-evidence (NULL words) and wordless (0 words) do not.
            expect(overallStats.wpmContributorCount).toBe(4);
            expect(overallStats.fillerRateContributorCount).toBe(4);
        });
    });

    describe('no evidence yields NULL, never a fabricated number', () => {
        const noEvidence = [
            fx('phase2c-failed-1', {
                clarity_score: null, total_words: null, wpm: null, accuracy: null,
                filler_words: null, pause_metrics: null,
            }),
            fx('phase2c-failed-2', {
                created_at: '2026-07-02T10:00:00Z',
                clarity_score: null, total_words: null, wpm: null, accuracy: null,
                filler_words: null, pause_metrics: null,
            }),
        ];

        it('reports clarity as null — NOT "0.0" — when nothing is scorable', async () => {
            const db = await makeDb();
            await seed(db, noEvidence);
            const { overallStats } = await callRpc(db, USER);
            expect(overallStats.clarityContributorCount).toBe(0);
            expect(overallStats.avgClarity).toBeNull();
            expect(overallStats.avgAccuracy).toBeNull();
            expect(overallStats.avgClarity).not.toBe('0.0');
        });

        it('reports pace and filler rate as null when no session carries words', async () => {
            const db = await makeDb();
            await seed(db, noEvidence);
            const { overallStats } = await callRpc(db, USER);
            expect(overallStats.avgWpm).toBeNull();
            expect(overallStats.avgFillerWordsPerMin).toBeNull();
        });

        it('reports null for a user with no sessions at all', async () => {
            const db = await makeDb();
            const { overallStats } = await callRpc(db, USER);
            expect(overallStats.totalSessions).toBe(0);
            expect(overallStats.avgClarity).toBeNull();
            expect(overallStats.avgWpm).toBeNull();
            expect(overallStats.avgFillerWordsPerMin).toBeNull();
            expect(overallStats.clarityContributorCount).toBe(0);
        });

        it('does NOT report a flattering 0.0 filler rate for a wordless take', async () => {
            const db = await makeDb();
            await seed(db, [fx('silence', {
                duration: 6, total_words: 0, clarity_score: null, wpm: null,
                filler_words: { total: { count: 0 } },
            })]);
            const { overallStats } = await callRpc(db, USER);
            expect(overallStats.avgFillerWordsPerMin).toBeNull();
        });

        it('DOES report a genuine 0.0 filler rate when there were real words and no fillers', async () => {
            const db = await makeDb();
            await seed(db, [fx('clean', {
                duration: 60, total_words: 120, clarity_score: 95, transcript: words(120),
                filler_words: { total: { count: 0 } },
            })]);
            const { overallStats } = await callRpc(db, USER);
            expect(overallStats.avgFillerWordsPerMin).toBe('0.0');
            expect(overallStats.fillerRateContributorCount).toBe(1);
        });
    });

    describe('the chart series omits rather than fabricates', () => {
        it('never charts 100 for a session with no clarity and no duration', async () => {
            const db = await makeDb();
            await seed(db, [fx('unmeasured', {
                duration: 0, total_words: null, clarity_score: null, wpm: null,
                filler_words: null,
            })]);
            const { overallStats } = await callRpc(db, USER);
            expect(overallStats.chartData).toHaveLength(1);
            expect(overallStats.chartData[0].clarity).toBeNull();
            // The precise old behaviour this replaces.
            expect(overallStats.chartData[0].clarity).not.toBe(100);
        });

        it('omits the point for every non-contributor and keeps it for every contributor', async () => {
            const db = await makeDb();
            await seed(db, MATRIX);
            const { overallStats } = await callRpc(db, USER);
            const plotted = overallStats.chartData.filter(p => p.clarity !== null);
            expect(plotted).toHaveLength(overallStats.clarityContributorCount as number);
            expect(overallStats.chartData.filter(p => p.clarity === null)).toHaveLength(3);
        });

        it('keeps a genuine measured zero on the chart — absence is omitted, zero is not', async () => {
            const db = await makeDb();
            await seed(db, [fx('real-zero', {
                clarity_score: 0, total_words: 50, transcript: words(50),
            })]);
            const { overallStats } = await callRpc(db, USER);
            expect(overallStats.chartData[0].clarity).toBe(0);
        });

        it('never serves clarity under the accuracyData "accuracy" key', async () => {
            const db = await makeDb();
            await seed(db, [
                // Has clarity but NO accuracy measurement: the old function served the clarity score
                // (77) as if it were STT accuracy. It must now be omitted from the series entirely.
                fx('clarity-but-no-accuracy', {
                    clarity_score: 77, accuracy: null, engine: 'private-v2', total_words: 90,
                }),
                fx('real-accuracy', {
                    created_at: '2026-07-02T10:00:00Z',
                    clarity_score: 55, accuracy: 0.93, engine: 'private-v2', total_words: 90,
                }),
            ]);
            const summary = await callRpc(db, USER);
            expect(summary.accuracyData).toHaveLength(1);
            expect(summary.accuracyData[0].accuracy).toBeCloseTo(93, 4);
            expect(summary.accuracyData.map(d => d.accuracy)).not.toContain(77);
        });
    });

    describe('direct client path vs RPC path — parity on identical input', () => {
        // Rows where every metric was persisted. This is the state both paths are designed for, and on
        // it they must AGREE: a user must not see a different number for crossing the 20-session line.
        const fullyPersisted: Fixture[] = [
            fx('p1', { created_at: '2026-07-01T10:00:00Z', duration: 60, total_words: 120, clarity_score: 88, transcript: words(120), filler_words: { um: { count: 2 }, total: { count: 2 } } }),
            fx('p2', { created_at: '2026-07-02T10:00:00Z', duration: 120, total_words: 200, clarity_score: 71, transcript: words(200), filler_words: { um: { count: 5 }, total: { count: 5 } } }),
            fx('p3', { created_at: '2026-07-03T10:00:00Z', duration: 90, total_words: 150, clarity_score: 0, transcript: words(150), filler_words: { um: { count: 40 }, total: { count: 40 } } }),
        ];

        it('produces the SAME clarity average, pace and filler rate as calculateOverallStats', async () => {
            const db = await makeDb();
            await seed(db, fullyPersisted);
            const { overallStats } = await callRpc(db, USER);
            const client = calculateOverallStats(asPracticeSessions(fullyPersisted));

            expect(Number(overallStats.avgClarity)).toBeCloseTo(Number(client.avgClarity), 1);
            expect(Number(overallStats.avgWpm)).toBe(client.averageWPM);
            expect(Number(overallStats.avgFillerWordsPerMin))
                .toBeCloseTo(Number(client.avgFillerWordsPerMin), 1);
            expect(overallStats.totalSessions).toBe(client.totalSessions);
            expect(Number(overallStats.totalPracticeTime)).toBe(client.totalPracticeTime);
        });

        it('agrees on the contributor count implied by each path', async () => {
            const db = await makeDb();
            await seed(db, fullyPersisted);
            const { overallStats } = await callRpc(db, USER);
            const client = calculateOverallStats(asPracticeSessions(fullyPersisted));
            // All three rows are scorable on both paths.
            expect(overallStats.clarityContributorCount).toBe(3);
            expect(client.avgClarity).not.toBeNull();
        });

        it('agrees that a history with no persisted metrics is unknown on BOTH paths', async () => {
            const rows = [
                fx('n1', { clarity_score: null, total_words: null, wpm: null, transcript: null, filler_words: null, pause_metrics: null }),
                fx('n2', { created_at: '2026-07-02T10:00:00Z', clarity_score: null, total_words: null, wpm: null, transcript: null, filler_words: null, pause_metrics: null }),
            ];
            const db = await makeDb();
            await seed(db, rows);
            const { overallStats } = await callRpc(db, USER);
            const client = calculateOverallStats(asPracticeSessions(rows));

            expect(overallStats.avgClarity).toBeNull();
            expect(client.avgClarity).toBeNull();
            expect(overallStats.avgWpm).toBeNull();
            expect(client.averageWPM).toBeNull();
        });

        /**
         * KNOWN, BOUNDED DIVERGENCE — asserted rather than glossed over.
         *
         * When phase 2c fails the transcript IS persisted but clarity_score is not. The CLIENT can
         * recompute clarity from the transcript (it has the filler counter, the WPM and the error-marker
         * scanner); the RPC cannot, and refuses to guess. So on partially-persisted rows the RPC's
         * contributor set is a SUBSET of the client's.
         *
         * The direction is what matters: the RPC may report LESS evidence than exists, never more, and
         * never a fabricated value. Under-reporting degrades to "Not enough data"; over-reporting is the
         * defect this PR exists to remove.
         */
        it('RPC contributors are a SUBSET of client contributors — it under-reports, never over-reports', async () => {
            const partial: Fixture[] = [
                fx('transcript-but-no-metrics', {
                    created_at: '2026-07-01T10:00:00Z',
                    duration: 60, total_words: null, clarity_score: null, wpm: null,
                    transcript: words(120), filler_words: null, pause_metrics: null,
                }),
                fx('fully-persisted', {
                    created_at: '2026-07-02T10:00:00Z',
                    duration: 60, total_words: 120, clarity_score: 88, transcript: words(120),
                    filler_words: { um: { count: 2 }, total: { count: 2 } },
                }),
            ];
            const db = await makeDb();
            await seed(db, partial);
            const { overallStats } = await callRpc(db, USER);
            const client = calculateOverallStats(asPracticeSessions(partial));

            // The client reconstructs the missing session's clarity from its transcript; the RPC does not.
            expect(overallStats.clarityContributorCount).toBe(1);
            expect(Number(overallStats.avgClarity)).toBeCloseTo(88.0, 1);
            expect(client.avgClarity).not.toBeNull();
            // The RPC's answer is drawn only from measurements that were actually persisted, so it is
            // never HIGHER-confidence than the client's. Both are real; neither is fabricated.
            expect(overallStats.clarityContributorCount as number).toBeLessThanOrEqual(2);
        });
    });

    describe('mixed history — the realistic account shape', () => {
        it('reports a real clarity average instead of collapsing to zero', async () => {
            // 20 fully-persisted good sessions + 39 phase-2c failures = the reported 59-session shape.
            const good = Array.from({ length: 20 }, (_, i) => fx(`good-${i}`, {
                created_at: new Date(Date.UTC(2026, 5, 1 + i, 10)).toISOString(),
                duration: 60, total_words: 120, clarity_score: 80 + (i % 5), transcript: words(120),
            }));
            const broken = Array.from({ length: 39 }, (_, i) => fx(`broken-${i}`, {
                created_at: new Date(Date.UTC(2026, 4, 1 + i, 10)).toISOString(),
                duration: 60, total_words: null, clarity_score: null, wpm: null,
                transcript: null, filler_words: null, pause_metrics: null,
            }));

            const db = await makeDb();
            await seed(db, [...good, ...broken]);
            const { overallStats } = await callRpc(db, USER);

            expect(overallStats.totalSessions).toBe(59);
            expect(overallStats.clarityContributorCount).toBe(20);
            // Mean of 80,81,82,83,84 repeated = 82.0.
            expect(Number(overallStats.avgClarity)).toBeCloseTo(82.0, 1);
            // The old function would have reported 82 * 20 / 59 = 27.8 — the "Clear Delivery 0%" family
            // of false lows. Prove we are nowhere near it.
            expect(Number(overallStats.avgClarity)).toBeGreaterThan(80);
        });

        it('a 100% phase-2c-failure history reports unknown, not a confident zero', async () => {
            const broken = Array.from({ length: 25 }, (_, i) => fx(`broken-${i}`, {
                created_at: new Date(Date.UTC(2026, 4, 1 + i, 10)).toISOString(),
                total_words: null, clarity_score: null, wpm: null,
                transcript: null, filler_words: null, pause_metrics: null,
            }));
            const db = await makeDb();
            await seed(db, broken);
            const { overallStats } = await callRpc(db, USER);
            expect(overallStats.totalSessions).toBe(25);
            expect(overallStats.avgClarity).toBeNull();
            expect(overallStats.clarityContributorCount).toBe(0);
            // Duration is still real evidence and must survive.
            expect(Number(overallStats.totalPracticeTime)).toBeGreaterThan(0);
        });

        it('(#1047) the aggregate gates on EXPLICIT transcript_state — a not_captured row with real words/clarity is EXCLUDED (proves it, not total_words>0)', async () => {
            // The discriminating case: a row carrying genuine total_words + clarity_score but
            // transcript_state='not_captured'. The OLD `total_words > 0` rule would count it; the explicit
            // transcript_state gate must EXCLUDE it (a not_captured row's numbers are sentinels, not evidence).
            const db = await makeDb();
            await seed(db, [
                fx('available', { created_at: '2026-07-01T10:00:00Z', total_words: 120, wpm: 120, clarity_score: 88, transcript: words(120), transcript_state: 'available', filler_words: { um: { count: 2 }, total: { count: 2 } } }),
                fx('not_captured-with-numbers', { created_at: '2026-07-02T10:00:00Z', total_words: 200, wpm: 200, clarity_score: 40, transcript: '', transcript_state: 'not_captured', filler_words: { um: { count: 9 }, total: { count: 9 } } }),
                // expired but with genuinely-persisted measurements → still contributes (transcript NULL).
                fx('expired-persisted', { created_at: '2026-07-03T10:00:00Z', total_words: 90, wpm: 96, clarity_score: 84, transcript: null, transcript_state: 'expired', filler_words: { um: { count: 1 }, total: { count: 1 } } }),
            ]);
            const { overallStats } = await callRpc(db, USER);
            expect(overallStats.totalSessions).toBe(3);                 // all three are sessions
            // Only available + expired-persisted contribute; the not_captured-with-numbers row is excluded
            // despite total_words:200 — proof the gate is transcript_state, not total_words>0.
            expect(overallStats.wpmContributorCount).toBe(2);
            expect(overallStats.clarityContributorCount).toBe(2);
            // avg clarity = (88 + 84)/2 = 86, NOT dragged down by the excluded not_captured clarity_score:40.
            expect(Number(overallStats.avgClarity)).toBeCloseTo(86.0, 1);
        });

        it('(#1047) WPM/filler RATES and chart points exclude not_captured; total practice time stays all-session', async () => {
            // Eligible rows (available + expired-persisted) sum to words=210, duration=120s (=2 min),
            // fillers=3  ⇒  WPM = 210/2 = 105 and filler rate = 3/2 = 1.5. The not_captured row carries
            // large STALE numbers (words 1000, duration 600s, fillers 50) that would drag WPM to ~101 and
            // the filler rate to ~4.4 if its sentinel values leaked into the rate numerators/denominators.
            const db = await makeDb();
            await seed(db, [
                fx('avail', { created_at: '2026-07-01T10:00:00Z', duration: 80, total_words: 140, wpm: 105, clarity_score: 88, transcript: words(140), transcript_state: 'available', filler_words: { um: { count: 2 }, total: { count: 2 } } }),
                fx('nc-stale', { created_at: '2026-07-02T10:00:00Z', duration: 600, total_words: 1000, wpm: 100, clarity_score: 40, transcript: '', transcript_state: 'not_captured', filler_words: { um: { count: 50 }, total: { count: 50 } } }),
                fx('exp-persisted', { created_at: '2026-07-03T10:00:00Z', duration: 40, total_words: 70, wpm: 105, clarity_score: 84, transcript: null, transcript_state: 'expired', filler_words: { um: { count: 1 }, total: { count: 1 } } }),
            ]);
            const { overallStats } = await callRpc(db, USER);

            // Rates computed from provenance-eligible rows ONLY.
            expect(overallStats.avgWpm).toBe(105);
            expect(overallStats.avgFillerWordsPerMin).toBe('1.5');
            // Total practice time still spans EVERY row (80+600+40 = 720s = 12 min) — truthful, not gated.
            expect(overallStats.totalPracticeTime).toBe(12);
            expect(overallStats.wpmContributorCount).toBe(2);
            expect(overallStats.fillerRateContributorCount).toBe(2);

            // Chart points: ordered ASC by created_at → [avail, nc-stale, exp-persisted].
            const chart = overallStats.chartData as Array<{ date: string; clarity: number | null; 'FW/min': string | null }>;
            expect(chart).toHaveLength(3);
            // The not_captured row emits NULL for both rate/clarity chart values despite stale nonzero data.
            expect(chart[1].clarity).toBeNull();
            expect(chart[1]['FW/min']).toBeNull();
            // Eligible rows keep genuine derived evidence (available FW/min = 2/(80/60) = 1.5; clarity 88).
            expect(chart[0].clarity).toBe(88);
            expect(chart[0]['FW/min']).toBe('1.50');
            // Expired-with-persisted-metrics still contributes its point (FW/min = 1/(40/60) = 1.5).
            expect(chart[2].clarity).toBe(84);
            expect(chart[2]['FW/min']).toBe('1.50');
        });

        it('(#1047) >20-session history: overall rates, top fillers, filler trends and accuracy all exclude a not_captured row', async () => {
            const db = await makeDb();
            // 21 genuine sessions (words=120, duration=60s, um:2, clarity 90, accuracy 0.9) + 1 MOST-RECENT
            // not_captured row with huge stale values that would dominate every series if it leaked in.
            const many = Array.from({ length: 21 }, (_, i) => fx(`v${i}`, {
                created_at: `2026-06-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
                duration: 60, total_words: 120, clarity_score: 90, accuracy: 0.9, engine: 'private-v2',
                transcript: words(120), filler_words: { um: { count: 2 }, total: { count: 2 } },
            }));
            const ncStale = fx('nc-stale', {
                created_at: '2026-07-31T10:00:00Z', // most recent → would top every recency-limited series
                duration: 600, total_words: 99999, clarity_score: 5, accuracy: 0.01, engine: 'private-v2',
                transcript: '', transcript_state: 'not_captured',
                filler_words: { zzz: { count: 999 }, total: { count: 999 } },
            });
            await seed(db, [...many, ncStale]);
            const { overallStats, topFillerWords, fillerWordTrends, accuracyData } = await callRpc(db, USER);

            expect(overallStats.totalSessions).toBe(22);                       // the row is still a session
            // Rates from the 21 eligible rows only: 21*120 words / 21 min = 120 WPM; 21*2 fillers / 21 min = 2.0.
            expect(overallStats.avgWpm).toBe(120);
            expect(overallStats.avgFillerWordsPerMin).toBe('2.0');
            // Total practice time is all-session (21*60 + 600 = 1860s = 31 min), truthful.
            expect(overallStats.totalPracticeTime).toBe(31);
            // Top fillers exclude the stale 'zzz':999.
            const topWords = (topFillerWords as Array<{ word: string; count: number }>).map(w => w.word);
            expect(topWords).toContain('um');
            expect(topWords).not.toContain('zzz');
            // Filler trends exclude 'zzz'.
            expect(Object.keys(fillerWordTrends as Record<string, unknown>)).not.toContain('zzz');
            // Accuracy series excludes the not_captured row's retained 0.01 (→ 1%) despite it being most recent.
            expect(accuracyData.map(d => Math.round(d.accuracy))).not.toContain(1);
        });
    });
});
