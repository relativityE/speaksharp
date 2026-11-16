// @vitest-environment node
/**
 * J1.d browser leg (runJ1dLeg), driven offline with a page that shows nothing and answers nothing: the leg must fail closed
 * (every J1.d row HOLD, never PASS or FAIL from absent evidence), never throw, and always remove its context listeners.
 */
import { describe, expect, it } from 'vitest';
import { j1dVerdicts, J1D_ROWS } from '../live/helpers/rwtJ1dJourney';
import { runJ1dLeg } from '../live/helpers/rwtJ1dLeg';

function silentPage() {
    const listeners = new Map<string, unknown>();
    const removed: string[] = [];
    const context = {
        on: (event: string, fn: unknown) => { listeners.set(event, fn); },
        off: (event: string, fn: unknown) => { if (listeners.get(event) === fn) { listeners.delete(event); removed.push(event); } },
    };
    const fail = async () => { throw new Error('not shown'); };
    const locator: Record<string, unknown> = {};
    Object.assign(locator, {
        first: () => locator, or: () => locator, waitFor: fail, click: fail,
        isVisible: async () => false, count: async () => 0, getAttribute: async () => null,
    });
    const page = {
        context: () => context, goto: async () => null, evaluate: fail, locator: () => locator, getByTestId: () => locator,
        waitForURL: fail, waitForRequest: fail, waitForTimeout: async () => undefined, url: () => 'https://app.example/progress',
    };
    return { page, listeners, removed };
}

describe('runJ1dLeg fails closed with no evidence', () => {
    it('a failed sign-in on the shown form reaches the spec (which writes every row HOLD) and still removes all four listeners', async () => {
        const { page, listeners, removed } = silentPage();
        let signIns = 0;
        await expect(runJ1dLeg({
            page: page as never, backendOrigin: 'https://proj.supabase.co', ownerUid: 'owner-1', takeIds: ['take-a', 'take-b'],
            signInOnShownForm: async () => { signIns += 1; throw new Error('no form'); },
        })).rejects.toThrow('no form');
        expect(signIns).toBe(1);
        expect(listeners.size).toBe(0);
        expect(removed.sort()).toEqual(['request', 'requestfailed', 'requestfinished', 'response']);
    });
    it('with no saved take it never opens a deep link or signs in, and holds every row', async () => {
        const { page, listeners } = silentPage();
        let signIns = 0;
        const obs = await runJ1dLeg({
            page: page as never, backendOrigin: 'https://proj.supabase.co', ownerUid: 'owner-1', takeIds: [],
            signInOnShownForm: async () => { signIns += 1; },
        });
        expect(signIns).toBe(0);
        expect(obs.deepLink).toBeNull();
        const v = j1dVerdicts(obs);
        for (const row of J1D_ROWS) expect([row, v[row].status]).not.toEqual([row, 'PASS']);
        // An unreadable mic counter is unknown, not zero: the write row cannot PASS on absent evidence.
        expect(obs.writes).toBeNull();
        expect(listeners.size).toBe(0);
    });
});
