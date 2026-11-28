// @vitest-environment node
import type { Page, Route } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { CoachingGenerationTap } from '../live/helpers/coachingGenerationTap';
import { runSavedTakeCoaching } from '../live/helpers/rwtSavedTakeCoaching';
import type { ChoiceClient } from '../live/helpers/rwtPracticeConsent';

vi.mock('@playwright/test', () => ({
    expect: { poll: (read: () => Promise<unknown>) => ({
        toBe: async (want: unknown) => expect(await read()).toBe(want),
    }) },
}));

const ownerId = 'owner';
const takeId = '00000000-0000-4000-8000-000000000002';
const client = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { user_id: ownerId, transcript_save: true, ai_coaching: false, consent_version: 1 },
        error: null,
    }) }) }) }),
} as unknown as ChoiceClient;

function setup(verify: (request: () => Promise<ReturnType<typeof vi.fn>>) => Promise<boolean>) {
    const tap = new CoachingGenerationTap();
    let routeHandler: ((route: Route) => Promise<void>) | null = null;
    const goto = vi.fn();
    const page = {
        route: vi.fn(async (_pattern: RegExp, fn: (route: Route) => Promise<void>) => { routeHandler = fn; }),
        goto,
    } as unknown as Page;
    const request = async () => {
        const forward = vi.fn();
        expect(routeHandler).not.toBeNull();
        const abort = vi.fn();
        tap.sentCount += 1;
        await routeHandler!({
            request: () => ({
                method: () => 'POST',
                postDataJSON: () => ({ sessionId: takeId, product: 'focus_points',
                    diagnostic_request_id: 'request', diagnostic_attempt_id: 'attempt' }),
            }),
            continue: forward,
            abort,
        } as unknown as Route);
        expect(abort).toHaveBeenCalledWith('blockedbyclient');
        return forward;
    };
    return { goto, run: () => runSavedTakeCoaching({ page, client, tap, ownerId, takeId, product: 'focus_points',
        readSavedTake: vi.fn(), verifyBeforeOptIn: () => verify(request) }) };
}

describe('saved Focus repeat admission before the first tab navigation', () => {
    it('blocks a surprise coaching POST during the saved coverage visit and fails without forwarding it', async () => {
        const h = setup(async (request) => {
            expect(await request()).not.toHaveBeenCalled();
            return true;
        });
        await expect(h.run()).rejects.toThrow('request before opt-in');
        expect(h.goto).not.toHaveBeenCalled();
    });

    it('does not enter the generation path while saved coverage is loading, or when it cannot be proved', async () => {
        let complete!: (value: boolean) => void;
        let started!: () => void;
        const pending = new Promise<boolean>((resolve) => { complete = resolve; });
        const reading = new Promise<void>((resolve) => { started = resolve; });
        const h = setup(() => { started(); return pending; });
        const result = h.run();
        await reading;
        expect(h.goto).not.toHaveBeenCalled();
        complete(false);
        await expect(result).resolves.toMatchObject({ outcome: 'HOLD', reason: 'saved_coverage_not_verified',
            proof: { browserPosts: 0, providerAttempts: 0 } });
        expect(h.goto).not.toHaveBeenCalled();
    });
});
