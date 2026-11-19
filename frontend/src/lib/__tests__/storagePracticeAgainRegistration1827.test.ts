/**
 * #1827 D2 rev 4 — the take this tab creates after Practice again is registered with that attempt; a take created in a
 * tab without the intent is not. Registration never fails the save.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveSession } from '../storage';
import { getSupabaseClient } from '../supabaseClient';
import logger from '../logger';
import { clearOpenAttempt, getOpenAttemptForUser, setOpenAttempt } from '@/services/progress/openAttempt';
import { clearPracticeAgainIntent, confirmCandidateRegistration, getPracticeAgainIntent, registeredTakeFor, releaseDiscardedTake, setPracticeAgainIntent } from '@/services/progress/practiceAgainIntent';

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
    it('with this tab\'s intent, the created take is registered; the intent stays while the attempt is open', async () => {
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER });
        supabase.rpc.mockImplementation(async (name: string) => name === 'register_practice_again_take_v1' ? { data: true, error: null } : created('s-b'));
        const result = await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        expect(result.status).toBe('saved');
        expect(registerCalls()).toEqual([['register_practice_again_take_v1', { p_attempt: ATTEMPT, p_session: 's-b' }]]);
        // Kept so a take that replaces a discarded registered take can re-register (the server refuses a second one).
        expect(getPracticeAgainIntent(USER)).toEqual({ attemptId: ATTEMPT, userId: USER });
        // Every tab's resolution now binds only this take (Codex P2 on 1025cac7).
        expect(getOpenAttemptForUser(USER)?.registeredSessionId).toBe('s-b');
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
        expect(getOpenAttemptForUser(USER)?.registeredSessionId).toBeUndefined();
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

    it('Codex P1: before the migration (no registration function), this tab\'s take is still recorded as the repeat', async () => {
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER });
        supabase.rpc.mockImplementation(async (name: string) => name === 'register_practice_again_take_v1'
            ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } : created('s-legacy'));
        expect((await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never)).status).toBe('saved');
        expect(getOpenAttemptForUser(USER)?.registeredSessionId).toBe('s-legacy');
    });

    it('Codex P2: a failed handoff write keeps the server registration in this tab, and it is written back later', async () => {
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER });
        supabase.rpc.mockImplementation(async (name: string) => name === 'register_practice_again_take_v1' ? { data: true, error: null } : created('s-held'));
        const realSet = Storage.prototype.setItem;
        const failOnce = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            if (this === localStorage && key === 'ss_progress_open_attempt_v1') throw new Error('QuotaExceededError');
            return realSet.call(this, key, value);
        });
        expect((await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never)).status).toBe('saved');
        failOnce.mockRestore();
        expect(getOpenAttemptForUser(USER)?.registeredSessionId).toBeUndefined();
        expect(getPracticeAgainIntent(USER)?.registeredSessionId).toBe('s-held');
        expect(registeredTakeFor(USER)).toBe('s-held');                 // restored once storage accepts it
        expect(getOpenAttemptForUser(USER)?.registeredSessionId).toBe('s-held');
    });

    it('Codex P2: a registration whose response was lost is confirmed for the SAME take, and a later take is not registered', async () => {
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER });
        let committed = false;
        supabase.rpc.mockImplementation(async (name: string, args: Record<string, string>) => {
            if (name !== 'register_practice_again_take_v1') return created(args?.p_session ? 'never' : (committed ? 's-c' : 's-b'));
            if (!committed) { committed = true; throw new Error('network: response lost'); }   // B committed server-side
            return { data: args.p_session === 's-b', error: null };                               // idempotent for B only
        });
        expect((await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never)).status).toBe('saved');
        expect(getOpenAttemptForUser(USER)?.registeredSessionId).toBeUndefined();
        expect(getPracticeAgainIntent(USER)?.candidateSessionId).toBe('s-b');
        // The next take in this tab first confirms B (the same session), and is itself never registered.
        expect((await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never)).status).toBe('saved');
        expect(getOpenAttemptForUser(USER)?.registeredSessionId).toBe('s-b');
        expect(supabase.rpc.mock.calls.filter((c) => c[0] === 'register_practice_again_take_v1').map((c) => (c[1] as Record<string, string>).p_session))
            .toEqual(['s-b', 's-b']);
    });

    it('Codex P2: before the migration, a later take never overwrites the recorded repeat; a discarded repeat releases it', async () => {
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER });
        let next = 's-b';
        supabase.rpc.mockImplementation(async (name: string) => name === 'register_practice_again_take_v1'
            ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } : created(next));
        await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        next = 's-c';
        await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        expect(getOpenAttemptForUser(USER)?.registeredSessionId).toBe('s-b');
        releaseDiscardedTake('s-b');                                      // B discarded (marked failed) by this client
        next = 's-d';
        await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        expect(getOpenAttemptForUser(USER)?.registeredSessionId).toBe('s-d');
    });

    it('Sam: B commits, its response AND the first confirmation fail; C starts unregistered; a later confirmation still targets B', async () => {
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER });
        let next = 's-b';
        let failures = 2;                                                 // B's own response, then the first confirmation
        supabase.rpc.mockImplementation(async (name: string, args: Record<string, string>) => {
            if (name !== 'register_practice_again_take_v1') return created(next);
            if (failures > 0) { failures -= 1; throw new Error('network: response lost'); }
            return { data: args.p_session === 's-b', error: null };     // B committed; only B is registered
        });
        await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);   // B: registration sent, reply lost
        next = 's-c';
        expect((await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never)).status).toBe('saved'); // C starts
        const registrationsSent = () => supabase.rpc.mock.calls.filter((c) => c[0] === 'register_practice_again_take_v1')
            .map((c) => (c[1] as Record<string, string>).p_session);
        expect(registrationsSent()).toEqual(['s-b', 's-b']);             // B's request, then its confirmation; C not registered
        expect(getPracticeAgainIntent(USER)?.candidateSessionId).toBe('s-b');            // B is still the candidate
        expect(getOpenAttemptForUser(USER)?.registeredSessionId).toBeUndefined();
        expect(await confirmCandidateRegistration(USER)).toBe('confirmed');               // the later confirmation: B
        expect(getOpenAttemptForUser(USER)?.registeredSessionId).toBe('s-b');
        expect(registrationsSent()).toEqual(['s-b', 's-b', 's-b']);      // C was never registered
    });

    it('a definitive refusal of the candidate frees the next take to register', async () => {
        openAttempt();
        setPracticeAgainIntent({ attemptId: ATTEMPT, userId: USER, candidateSessionId: 's-b' });
        supabase.rpc.mockImplementation(async (name: string, args: Record<string, string>) => name === 'register_practice_again_take_v1'
            ? { data: args.p_session === 's-c', error: null } : created('s-c'));
        await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        expect(getOpenAttemptForUser(USER)?.registeredSessionId).toBe('s-c');
    });
});

