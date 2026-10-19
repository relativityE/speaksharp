// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { nextTakeOnlyItselfVerdict } from '../live/helpers/rwtAbandonTakeover';
import { recoveryFence1593Verdict, type RecoveryFenceEvidence, type RecoverySession,
    type RecoverySnapshot, type RecoveryRead, type RecoveryRows } from '../live/helpers/rwtRecoveryFence1593';

const U = '11111111-1111-4111-8111-111111111111';
const L1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const L2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const FENCE = '2026-10-19T10:00:00.000Z';
const observed = <T>(value: T): RecoveryRead<T> => ({ state: 'observed', value });
const complete = <T>(value: readonly T[]): RecoveryRows<T> => ({ state: 'observed', complete: true, value });
const row = (id: string, lease: string, extra: Partial<RecoverySession> = {}): RecoverySession => ({
    id, user_id: U, status: 'active', lease_id: lease, recording_fenced_at: null,
    recording_fenced_reason: null, lease_released_at: null, ...extra,
});
const fenced = (): RecoverySession => row('left', L1, { recording_fenced_at: FENCE, recording_fenced_reason: 'displaced' });
const snapshot = (value: readonly RecoverySession[], lease: string | null): RecoverySnapshot => ({
    runId: 'synthetic-case10', ownerId: U, rows: complete(value),
    authority: observed(lease === null ? null : { user_id: U, lease_id: lease, state: 'recording' }),
});
const evidence = (): RecoveryFenceEvidence => ({
    runId: 'synthetic-case10', ownerId: U,
    beforeFirst: { runId: 'synthetic-case10', ownerId: U, rows: complete([]) },
    beforeSuccessor: { runId: 'synthetic-case10', ownerId: U, rows: complete([{ id: 'left', user_id: U }]) },
    first: { sessionId: 'left', leaseId: L1, recordingObserved: observed(true), snapshot: snapshot([row('left', L1)], L1) },
    successor: { sessionId: 'next', leaseId: L2, recordingObserved: observed(true), snapshot: snapshot([fenced(), row('next', L2)], L2) },
    afterSave: snapshot([fenced(), row('next', L2, { status: 'completed' })], null), savedSessionId: observed('next'),
});
const selected = (s: RecoverySnapshot): RecoverySession[] => {
    if (s.rows.state !== 'observed') throw new Error('test fixture rows missing');
    return s.rows.value as RecoverySession[];
};
const verdict = (e: RecoveryFenceEvidence) => recoveryFence1593Verdict(e).status;

describe('#1593 case10 strict bound recovery fence', () => {
    it('reproduces the old zero-active false negative; accepts only the bound permanently displaced exception', () => {
        const e = evidence();
        expect(nextTakeOnlyItselfVerdict([{ id: 'left', status: 'active' }], selected(e.afterSave), 'next').status).toBe('FAIL');
        expect(verdict(e)).toBe('PASS');
    });

    it.each(['completed', 'failed'])('retains the ordinary closed abandoned %s positive', (status) => {
        const e = evidence();
        for (const s of [e.successor.snapshot, e.afterSave]) selected(s)[0] = row('left', L1, { status });
        expect(verdict(e)).toBe('PASS');
    });

    it.each([null, FENCE])('does not require a successor release stamp (%s); observed absent authority is required', (stamp) => {
        const e = evidence(); selected(e.afterSave)[1].lease_released_at = stamp;
        expect(verdict(e)).toBe('PASS');
    });

    const failures: [string, (e: RecoveryFenceEvidence) => void][] = [
        ['wrong run', e => { e.successor.snapshot.runId = 'different-run'; }],
        ['wrong snapshot owner', e => { e.afterSave.ownerId = 'other'; }],
        ['wrong row owner', e => { selected(e.afterSave)[0].user_id = 'other'; }],
        ['wrong authority owner', e => { e.first.snapshot.authority = observed({ user_id: 'other', lease_id: L1, state: 'recording' }); }],
        ['first not recording', e => { e.first.recordingObserved = observed(false); }],
        ['successor not recording', e => { e.successor.recordingObserved = observed(false); }],
        ['missing bound row', e => { e.first.sessionId = 'absent'; }],
        ['first lease wrong', e => { e.first.leaseId = 'wrong'; }],
        ['first authority absent', e => { e.first.snapshot.authority = observed(null); }],
        ['successor authority still old', e => { e.successor.snapshot.authority = observed({ user_id: U, lease_id: L1, state: 'recording' }); }],
        ['successor authority stopped', e => { e.successor.snapshot.authority = observed({ user_id: U, lease_id: L2, state: 'stopped' }); }],
        ['same take reused', e => { e.successor.sessionId = 'left'; }],
        ['same lease reused', e => { e.successor.leaseId = L1; selected(e.successor.snapshot)[1].lease_id = L1;
            e.successor.snapshot.authority = observed({ user_id: U, lease_id: L1, state: 'recording' }); }],
        ['successor already in baseline', e => { e.beforeSuccessor.rows = complete([{ id: 'left', user_id: U }, { id: 'next', user_id: U }]); }],
        ['first already in initial baseline', e => { e.beforeFirst.rows = complete([{ id: 'left', user_id: U }]); }],
        ['successor reuses an initial identity lost before next baseline', e => {
            e.beforeFirst.rows = complete([{ id: 'next', user_id: U }]);
            selected(e.first.snapshot).push(row('next', 'historic', { status: 'completed' }));
        }],
        ['duplicate first row', e => { selected(e.first.snapshot).push(row('left', L1)); }],
        ['duplicate successor row', e => { selected(e.afterSave).push(row('next', L2, { status: 'completed' })); }],
        ['second completed successor', e => { selected(e.afterSave).push(row('duplicate', L2, { status: 'completed' })); }],
        ['extra new row absorbed by baseline', e => { e.beforeSuccessor.rows = complete([{ id: 'left', user_id: U }, { id: 'extra', user_id: U }]); }],
        ['unknown active before first', e => { selected(e.first.snapshot).push(row('unknown', 'unknown')); }],
        ['unknown active during successor', e => { selected(e.successor.snapshot).push(row('unknown', 'unknown')); }],
        ['unknown active final', e => { selected(e.afterSave).push(row('unknown', 'unknown')); }],
        ['pre-existing active row is not excused', e => {
            e.beforeFirst.rows = complete([{ id: 'unknown', user_id: U }]);
            e.beforeSuccessor.rows = complete([{ id: 'unknown', user_id: U }, { id: 'left', user_id: U }]);
            for (const s of [e.first.snapshot, e.successor.snapshot, e.afterSave]) selected(s).push(row('unknown', 'unknown'));
        }],
        ['a baseline row reactivated only at C is not excused', e => {
            e.beforeFirst.rows = complete([{ id: 'historical', user_id: U }]);
            e.beforeSuccessor.rows = complete([{ id: 'historical', user_id: U }, { id: 'left', user_id: U }]);
            for (const s of [e.first.snapshot, e.successor.snapshot]) selected(s).push(row('historical', 'historic', { status: 'completed' }));
            selected(e.afterSave).push(row('historical', 'historic'));
        }],
        ['an unknown baseline-row status is not treated as closed', e => {
            e.beforeFirst.rows = complete([{ id: 'historical', user_id: U }]);
            e.beforeSuccessor.rows = complete([{ id: 'historical', user_id: U }, { id: 'left', user_id: U }]);
            for (const s of [e.first.snapshot, e.successor.snapshot]) selected(s).push(row('historical', 'historic', { status: 'completed' }));
            selected(e.afterSave).push(row('historical', 'historic', { status: 'unknown-terminal' }));
        }],
        ['unfenced active old row', e => { for (const s of [e.successor.snapshot, e.afterSave]) selected(s)[0] = row('left', L1); }],
        ['save-only is not displaced', e => { for (const s of [e.successor.snapshot, e.afterSave]) selected(s)[0].recording_fenced_reason = 'save_only'; }],
        ['absent fence at B', e => { selected(e.successor.snapshot)[0].recording_fenced_at = null; }],
        ['removed fence at C', e => { selected(e.afterSave)[0].recording_fenced_at = null; }],
        ['changed fence at C', e => { selected(e.afterSave)[0].recording_fenced_at = '2026-10-19T11:00:00Z'; }],
        ['malformed fence', e => { for (const s of [e.successor.snapshot, e.afterSave]) selected(s)[0].recording_fenced_at = 'invalid'; }],
        ['old lease changed', e => { selected(e.afterSave)[0].lease_id = 'other'; }],
        ['old lease still current after save', e => { e.afterSave.authority = observed({ user_id: U, lease_id: L1, state: 'recording' }); }],
        ['successor lease still current after save', e => { e.afterSave.authority = observed({ user_id: U, lease_id: L2, state: 'recording' }); }],
        ['unrelated authority still current', e => { e.afterSave.authority = observed({ user_id: U, lease_id: 'other', state: 'recording' }); }],
        ['page bound no saved session', e => { e.savedSessionId = observed(null); }],
        ['page bound another session', e => { e.savedSessionId = observed('wrong'); }],
        ['successor incomplete', e => { selected(e.afterSave)[1].status = 'active'; }],
        ['successor failed', e => { selected(e.afterSave)[1].status = 'failed'; }],
        ['successor lease changed on save', e => { selected(e.afterSave)[1].lease_id = 'other'; }],
        ['successor displaced', e => { selected(e.afterSave)[1].recording_fenced_at = FENCE; }],
        ['abandoned closed row reopened', e => { selected(e.successor.snapshot)[0].status = 'completed'; }],
        ['unknown abandoned status', e => { selected(e.afterSave)[0].status = 'mystery'; }],
        ['permanent fence changed even after closing', e => {
            selected(e.successor.snapshot)[0].status = 'completed'; selected(e.afterSave)[0].status = 'completed';
            selected(e.afterSave)[0].recording_fenced_at = '2026-10-19T11:00:00Z';
        }],
        ['failed abandoned row revived to completed', e => {
            selected(e.successor.snapshot)[0].status = 'failed'; selected(e.afterSave)[0].status = 'completed';
        }],
    ];
    it.each(failures)('FAIL: %s', (_name, change) => { const e = evidence(); change(e); expect(verdict(e)).toBe('FAIL'); });

    const holds: [string, (e: RecoveryFenceEvidence) => void][] = [
        ['missing first binding', e => { e.first.sessionId = null; }],
        ['missing first lease', e => { e.first.leaseId = null; }],
        ['missing recording observation', e => { e.first.recordingObserved = { state: 'unavailable' }; }],
        ['unavailable baseline', e => { e.beforeFirst.rows = { state: 'unavailable' }; }],
        ['incomplete next baseline', e => { e.beforeSuccessor.rows = { state: 'observed', complete: false, value: [] }; }],
        ['failed final rows read', e => { e.afterSave.rows = { state: 'unavailable' }; }],
        ['partial final rows', e => { e.afterSave.rows = { state: 'observed', complete: false, value: selected(e.afterSave) }; }],
        ['unavailable authority is not absent', e => { e.afterSave.authority = { state: 'unavailable' }; }],
        ['unselected authority is not absent', e => { e.afterSave.authority = { state: 'observed' } as RecoveryRead<null>; }],
        ['missing saved page read', e => { e.savedSessionId = { state: 'unavailable' }; }],
        ['unselected session field', e => { delete (selected(e.afterSave)[0] as Partial<RecoverySession>).recording_fenced_at; }],
        ['unreadable session status', e => { selected(e.afterSave)[0].status = null; }],
        ['missing snapshot run binding', e => { e.afterSave.runId = ''; }],
    ];
    it.each(holds)('HOLD: %s', (_name, change) => { const e = evidence(); change(e); expect(verdict(e)).toBe('HOLD'); });

    it('preserves input evidence and does not emit owner/session/lease identities', () => {
        const e = evidence(); const before = JSON.stringify(e); const result = recoveryFence1593Verdict(e);
        expect(JSON.stringify(e)).toBe(before);
        for (const identity of [U, L1, L2, 'synthetic-case10']) expect(JSON.stringify(result)).not.toContain(identity);
    });
});

/** Reuse the actual retained #1476 fixture declarations/SQL verbatim; do not import its describe blocks. */
function retainedDatabaseFixture(): { db: () => Promise<PGlite>; acquire: (d: PGlite, lease: string, force?: boolean) => Promise<Record<string, unknown>>;
    start: (d: PGlite, lease: string) => Promise<Record<string, unknown>>; sessionId: (r: Record<string, unknown>) => string } {
    const path = 'tests/db/one-active-engine-1476.integration.test.ts';
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const firstDescribe = file.statements.find(s => ts.isExpressionStatement(s) && s.expression.getText(file).startsWith('describe('));
    if (!firstDescribe) throw new Error('retained migration fixture boundary missing');
    const declarations = file.statements.filter(s => s.end <= firstDescribe.pos && !ts.isImportDeclaration(s))
        .map(s => s.getText(file)).join('\n');
    const js = ts.transpileModule(declarations + '\nObject.assign(module.exports, { db, acquire, start, sessionId });', {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const module = { exports: {} };
    runInNewContext(js, { module, exports: module.exports, PGlite, readFileSync, existsSync, resolve, process });
    return module.exports as ReturnType<typeof retainedDatabaseFixture>;
}

describe('#1593 actual retained migration fixture → new oracle (not hosted current-schema proof)', () => {
    it.each(['complete-then-release', 'release-then-complete'])('accepts %s with real row/lease/fence reads and preserves the NULL-stamp control', async order => {
        const fixture = retainedDatabaseFixture(); const d = await fixture.db();
        try {
            const read = async (): Promise<RecoverySnapshot> => {
                const sessions = (await d.query<RecoverySession>('SELECT id,user_id,status,lease_id,recording_fenced_at::text,recording_fenced_reason,lease_released_at::text FROM public.sessions WHERE user_id=$1', [U])).rows;
                const lease = (await d.query<{ user_id: string; lease_id: string; state: string }>('SELECT user_id,lease_id,state FROM public.active_recording_lease WHERE user_id=$1', [U])).rows;
                return { runId: 'synthetic-case10', ownerId: U, rows: complete(sessions), authority: observed(lease[0] ?? null) };
            };
            const e = evidence(); e.beforeFirst = await read();
            expect(await fixture.acquire(d, L1)).toMatchObject({ acquired: true });
            const firstId = fixture.sessionId(await fixture.start(d, L1));
            // Synthetic recording observations exercise the oracle; RPC controls do not prove a browser microphone.
            e.first = { sessionId: firstId, leaseId: L1, recordingObserved: observed(true), snapshot: await read() };
            e.beforeSuccessor = await read();
            expect(await fixture.acquire(d, L2, true)).toMatchObject({ acquired: true, took_over: true });
            const nextId = fixture.sessionId(await fixture.start(d, L2));
            e.successor = { sessionId: nextId, leaseId: L2, recordingObserved: observed(true), snapshot: await read() };
            const finish = () => d.query(`SELECT public.complete_session_v2(p_session_id=>$1::uuid,p_status=>'completed',
                p_final_duration=>42,p_reason=>NULL,p_next_action=>'{"kind":"practice_again","reason":"synthetic"}'::jsonb,
                p_total_words=>7,p_clarity_score=>0.9,p_wpm=>120,p_filler_counts=>'{}'::jsonb,p_pause_metrics=>NULL,
                p_final_transcript=>'synthetic take words') AS r`, [nextId]);
            const release = async () => {
                const r = (await d.query<{ r: { released: boolean } }>('SELECT public.release_recording_lease($1::uuid) AS r', [L2])).rows[0].r;
                expect(r.released).toBe(true);
            };
            if (order === 'complete-then-release') { await finish(); await release(); }
            else { await release(); await finish(); }
            e.afterSave = await read(); e.savedSessionId = observed(nextId);
            expect(verdict(e)).toBe('PASS');
            const saved = selected(e.afterSave).find(r => r.id === nextId)!;
            expect(saved.lease_released_at === null).toBe(order === 'complete-then-release');
            // Point-in-time absent authority is not the sole discriminator: the actual permanent trigger
            // rejects a displaced take's duration update even after the new holder released.
            await expect(d.query('UPDATE public.sessions SET duration=duration+1 WHERE id=$1', [firstId])).rejects.toThrow(/lease_revoked/);
            await expect(d.query('UPDATE public.sessions SET recording_fenced_at=NULL,recording_fenced_reason=NULL WHERE id=$1', [firstId])).rejects.toThrow(/recording_fenced/);
            const unproven = structuredClone(e);
            const old = selected(unproven.afterSave).find(r => r.id === firstId)!;
            old.recording_fenced_at = null; old.recording_fenced_reason = null;
            expect(verdict(unproven)).toBe('FAIL');
        } finally { await d.close(); }
    });
});
