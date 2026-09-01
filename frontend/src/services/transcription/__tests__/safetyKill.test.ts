/**
 * #1263 — THE KILL SWITCH IS ONE-WAY, AND THAT MUST BE PROVABLE.
 *
 * The retired mechanism let a remote flag PAYLOAD name a variant, a device or a cohort, so which model
 * a visitor ran was a property of PostHog state rather than of anything reviewable. The replacement
 * keeps exactly one remote power — forcing the configured fallback — and these tests exist to prove
 * the power cannot be pointed anywhere else.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import posthog from 'posthog-js';
import { CANDIDATES } from '../candidateRegistry';
import { effectiveCandidate } from '../candidateSelection';
import {
    isRemoteSafetyKillEngaged, SAFETY_KILL_FLAG, SAFETY_KILL_TARGET, FALLBACK_CAUSE_REMOTE_KILL,
} from '../safetyKill';

vi.mock('posthog-js', () => ({ default: { isFeatureEnabled: vi.fn() } }));
const flag = posthog.isFeatureEnabled as unknown as ReturnType<typeof vi.fn>;

describe('the kill can only ever force v2:base.en', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => vi.clearAllMocks());

    it('CASUALTY: engaged, it forces v2:base.en even though config names something else', () => {
        flag.mockReturnValue(true);
        const sel = effectiveCandidate({ candidate: 'v4:distil:q4' });
        expect(sel.candidate.id).toBe('v2:base.en');
        expect(sel.fallbackCause).toBe(FALLBACK_CAUSE_REMOTE_KILL);
    });

    it('CASUALTY: disengaged, CONFIG decides — the kill has no positive power', () => {
        flag.mockReturnValue(false);
        const sel = effectiveCandidate({ candidate: 'v4:distil:q4' });
        expect(sel.candidate.id).toBe('v4:distil:q4');
        expect(sel.fallbackCause).toBeNull();
    });

    it('CASUALTY: the destination is a CONSTANT — no flag input can name a model', () => {
        // Whatever the flag layer returns, the only reachable kill destination is this one id.
        for (const payload of ['v4:distil:q4', 'moonshine:streaming-medium', 'base_int8', 'webgpu']) {
            flag.mockReturnValue(payload as unknown as boolean);
            const sel = effectiveCandidate({ candidate: 'v2:base.en' });
            // A non-`true` payload must not even engage the kill, let alone steer it.
            expect(sel.candidate.id).toBe('v2:base.en');
            expect(sel.fallbackCause).toBeNull();
        }
        expect(SAFETY_KILL_TARGET).toBe('v2:base.en');
    });

    it('CASUALTY: a truthy non-true value does NOT engage it', () => {
        flag.mockReturnValue('true' as unknown as boolean);
        expect(isRemoteSafetyKillEngaged()).toBe(false);
        flag.mockReturnValue(1 as unknown as boolean);
        expect(isRemoteSafetyKillEngaged()).toBe(false);
    });

    it('CASUALTY: it still works when the CONFIG is broken — a bad config is when you need it', () => {
        flag.mockReturnValue(true);
        const sel = effectiveCandidate({ candidate: 'not-a-real-candidate' });
        expect(sel.candidate.id).toBe('v2:base.en');
        expect(sel.fallbackCause).toBe(FALLBACK_CAUSE_REMOTE_KILL);
    });

    it('an unreadable flag FAILS OFF — the configured candidate still runs', () => {
        flag.mockImplementation(() => { throw new Error('posthog exploded'); });
        expect(isRemoteSafetyKillEngaged()).toBe(false);
        const sel = effectiveCandidate({ candidate: 'v4:distil:q4' });
        expect(sel.candidate.id).toBe('v4:distil:q4');
    });

    it('flags not yet loaded (undefined) read as NOT engaged', () => {
        flag.mockReturnValue(undefined as unknown as boolean);
        expect(isRemoteSafetyKillEngaged()).toBe(false);
    });

    it('the kill reads its OWN key, not a retired positive-selection flag', () => {
        flag.mockReturnValue(true);
        isRemoteSafetyKillEngaged();
        expect(flag).toHaveBeenCalledWith(SAFETY_KILL_FLAG);
        expect(SAFETY_KILL_FLAG).not.toMatch(/v4|distil|allowlist|internal/);
    });

    it('the forced target is a REGISTERED, activation-ready candidate', () => {
        const target = CANDIDATES[SAFETY_KILL_TARGET];
        expect(target).toBeTruthy();
        expect(target.activationReady).toBe(true);
        expect(target.browser.ok).toBe(true);
    });
});
