/**
 * #1827 D2 rev 4 — the take this tab creates after Practice again is registered with that attempt; a take created in a
 * tab without the intent is not. Registration never fails the save, and nothing about which take is the repeat is stored
 * on the client: the server's registered take is read back (`readRepeatIdentity`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveSession } from '../storage';
import { getSupabaseClient } from '../supabaseClient';
import logger from '../logger';
import { clearOpenAttempt, getOpenAttemptForUser, setOpenAttempt } from '@/services/progress/openAttempt';
import { clearPracticeAgainIntent, getPracticeAgainIntent, readRepeatIdentity, setPracticeAgainIntent } from '@/services/progress/practiceAgainIntent';

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
