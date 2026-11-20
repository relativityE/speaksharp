/**
 * #1827 D2 rev 4 — the take this tab creates after Practice again is registered with that attempt; a take created in a
 * tab without the intent is not. Registration never fails the save, and nothing about which take is the repeat is stored
 * on the client: the server's registered take is read back (`readRepeatIdentity`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { completeSession, saveSession } from '../storage';
import { getSupabaseClient } from '../supabaseClient';
import logger from '../logger';
import { clearOpenAttempt, getOpenAttemptForUser, setOpenAttempt } from '@/services/progress/openAttempt';
import { REGISTRATION_RETRY_DEADLINE_MS, clearPracticeAgainIntent, notePendingRegistration, getPracticeAgainIntent, readRepeatIdentity, setPracticeAgainIntent } from '@/services/progress/practiceAgainIntent';

vi.mock('../supabaseClient');

const USER = '00000000-0000-4000-8000-000000000001';
const ATTEMPT = '00000000-0000-4000-8000-0000000000a1';
const supabase = { rpc: vi.fn(), from: vi.fn() };
const created = (id: string) => ({ data: { new_session: { id } }, error: null });
const registerCalls = () => supabase.rpc.mock.calls.filter((c) => c[0] === 'register_practice_again_take_v1');
const openAttempt = () => setOpenAttempt({ attemptId: ATTEMPT, userId: USER, sourceSessionId: 's-a', acceptedAtIso: new Date().toISOString() });

beforeEach(() => {
    vi.clearAllMocks();
    supabase.rpc.mockReset();
    vi.mocked(getSupabaseClient).mockReturnValue(supabase as unknown as SupabaseClient);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
});
afterEach(() => { clearPracticeAgainIntent(); clearOpenAttempt(); vi.restoreAllMocks(); });

describe('#1827 Practice again registers only this tab\'s Start; the client stores no repeat identity', () => {
    it('this tab: the created take is registered, and nothing about it is stored locally', async () => {
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER });
        supabase.rpc.mockImplementation(async (name: string) => name === 'register_practice_again_take_v1' ? { data: true, error: null } : created('s-b'));
        expect((await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never)).status).toBe('saved');
        expect(registerCalls()).toEqual([['register_practice_again_take_v1', { p_attempt: ATTEMPT, p_session: 's-b' }]]);
        expect(getOpenAttemptForUser(USER)).toEqual({ attemptId: ATTEMPT, userId: USER, sourceSessionId: 's-a', acceptedAtIso: expect.any(String) });
        expect(getPracticeAgainIntent(USER)).toEqual({ attemptId: ATTEMPT, userId: USER });
    });

    it('another tab (no intent) never registers its take', async () => {
        openAttempt();
        supabase.rpc.mockResolvedValue(created('s-c'));
        expect((await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never)).status).toBe('saved');
        expect(registerCalls()).toHaveLength(0);
    });

    it('a lost reply, a refusal, a thrown error or a database before the migration never fails the save and stores nothing', async () => {
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER });
        for (const answer of [
            async () => { throw new Error('network: response lost'); },
            async () => ({ data: false, error: null }),
            async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
        ]) {
            supabase.rpc.mockImplementation(async (name: string) => name === 'register_practice_again_take_v1' ? answer() : created('s-x'));
            expect((await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never)).status).toBe('saved');
            expect(getOpenAttemptForUser(USER)).toEqual({ attemptId: ATTEMPT, userId: USER, sourceSessionId: 's-a', acceptedAtIso: expect.any(String) });
        }
    });

    it('an intent for another account, or for an attempt that is no longer open, is dropped and not sent', async () => {
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER });   // no open attempt
        supabase.rpc.mockResolvedValue(created('s-e'));
        await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: 'someone-else' });
        await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        expect(registerCalls()).toHaveLength(0);
    });
});

describe('#1827 Codex P2 — a registration that failed before committing is retried once, for the same take, before it completes', () => {
    it('B\'s registration fails before commit; completing B re-sends it for B (not another take), once', async () => {
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER });
        let fail = true;
        supabase.rpc.mockImplementation(async (name: string) => {
            if (name === 'register_practice_again_take_v1') {
                if (fail) { fail = false; throw new Error('network: failed before commit'); }
                return { data: true, error: null };
            }
            if (name === 'complete_session_v2') return { data: null, error: { code: 'XX000', message: 'stop here' } };
            return created('s-b');
        });
        await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        await completeSession('s-b', { status: 'completed', duration: 1 } as never);
        const order = supabase.rpc.mock.calls.map((c) => [c[0], (c[1] as Record<string, unknown>)?.p_session ?? (c[1] as Record<string, unknown>)?.p_session_id]);
        expect(order.filter(([n]) => n !== 'create_session_and_update_usage')).toEqual([
            ['register_practice_again_take_v1', 's-b'], ['register_practice_again_take_v1', 's-b'], ['complete_session_v2', 's-b']]);
        await completeSession('s-b', { status: 'completed', duration: 1 } as never);   // a replay does not retry again
        expect(registerCalls()).toHaveLength(2);
    });

    it('Sam: a stalled retry does not hold up the save — complete_session_v2 is still attempted after the deadline', async () => {
        notePendingRegistration(ATTEMPT, 's-stall');                       // B's first request got no answer
        supabase.rpc.mockImplementation((name: string) => {
            if (name === 'register_practice_again_take_v1') return new Promise(() => undefined);   // the retry stalls
            if (name === 'complete_session_v2') return Promise.resolve({ data: null, error: { code: 'XX000', message: 'stop here' } });
            return Promise.resolve({ data: null, error: null });
        });
        const completedStall = () => supabase.rpc.mock.calls.some((c) => c[0] === 'complete_session_v2'
            && (c[1] as Record<string, unknown>)?.p_session_id === 's-stall');
        const started = Date.now();
        const completion = completeSession('s-stall', { status: 'completed', duration: 1 } as never);
        await new Promise((r) => setTimeout(r, REGISTRATION_RETRY_DEADLINE_MS - 500));
        expect(completedStall()).toBe(false);                               // held only within the bound
        await completion;
        expect(completedStall()).toBe(true);                                // then the normal save proceeds
        expect(Date.now() - started).toBeLessThan(REGISTRATION_RETRY_DEADLINE_MS + 2000);
        expect(registerCalls().map((c) => (c[1] as Record<string, unknown>).p_session)).toEqual(['s-stall']);   // same take only
    }, 15_000);

    it('a definitive answer (registered, refused, or no function before the migration) leaves nothing to retry', async () => {
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER });
        supabase.rpc.mockImplementation(async (name: string) => name === 'register_practice_again_take_v1' ? { data: false, error: null }
            : name === 'complete_session_v2' ? { data: null, error: { code: 'XX000', message: 'stop here' } } : created('s-c'));
        await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        await completeSession('s-c', { status: 'completed', duration: 1 } as never);
        expect(registerCalls()).toHaveLength(1);
    });
});

describe('#1827 readRepeatIdentity — the server\'s answer, read-only', () => {
    const row = (data: unknown, error: unknown = null) => {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data, error }) };
        supabase.from.mockReturnValue(q);
    };
    it.each([
        ['registered', { registered_session_id: 's-b', registration_required: true }, null, { kind: 'registered', sessionId: 's-b' }],
        ['awaiting (nothing committed)', { registered_session_id: null, registration_required: true }, null, { kind: 'awaiting' }],
        ['legacy (older client)', { registered_session_id: null, registration_required: false }, null, { kind: 'legacy' }],
        ['legacy (before the migration)', null, { code: '42703', message: 'column registered_session_id does not exist' }, { kind: 'legacy' }],
        ['unknown (read failed)', null, { code: '08006', message: 'connection failure' }, { kind: 'unknown' }],
        ['unknown (no row)', null, null, { kind: 'unknown' }],
    ])('%s', async (_label, data, error, expected) => {
        row(data, error);
        expect(await readRepeatIdentity(ATTEMPT)).toEqual(expected);
        expect(supabase.rpc).not.toHaveBeenCalled();               // a read never registers
    });
});
