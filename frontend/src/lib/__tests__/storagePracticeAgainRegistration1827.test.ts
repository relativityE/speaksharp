/**
 * #1827 D2 rev 4 — the take this tab creates after Practice again is registered with that attempt; a take created in a
 * tab without the intent is not. Registration never fails the save.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveSession } from '../storage';
import { getSupabaseClient } from '../supabaseClient';
import logger from '../logger';
import { clearOpenAttempt, setOpenAttempt } from '@/services/progress/openAttempt';
import { clearPracticeAgainIntent, getPracticeAgainIntent, setPracticeAgainIntent } from '@/services/progress/practiceAgainIntent';

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

describe('#1827 Practice again registers only this tab\'s next take', () => {
    it('with this tab\'s intent, the created take is registered and the intent is cleared', async () => {
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER });
        supabase.rpc.mockImplementation(async (name: string) => name === 'register_practice_again_take_v1' ? { data: true, error: null } : created('s-b'));
        const result = await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        expect(result.status).toBe('saved');
        expect(registerCalls()).toEqual([['register_practice_again_take_v1', { p_attempt: ATTEMPT, p_session: 's-b' }]]);
        expect(getPracticeAgainIntent(USER)).toBeNull();
    });

    it('another tab (no intent) never registers its take', async () => {
        openAttempt();
        supabase.rpc.mockResolvedValue(created('s-c'));
        expect((await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never)).status).toBe('saved');
        expect(registerCalls()).toHaveLength(0);
    });

    it('a refusal (e.g. another product) keeps the intent for this tab\'s next Start; an error never fails the save', async () => {
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER });
        supabase.rpc.mockImplementation(async (name: string) => name === 'register_practice_again_take_v1' ? { data: false, error: null } : created('s-c'));
        expect((await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never)).status).toBe('saved');
        expect(getPracticeAgainIntent(USER)).toEqual({ attemptId: ATTEMPT, userId: USER });
        supabase.rpc.mockImplementation(async (name: string) => name === 'register_practice_again_take_v1' ? { data: null, error: { code: '42501' } } : created('s-d'));
        expect((await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never)).status).toBe('saved');
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
