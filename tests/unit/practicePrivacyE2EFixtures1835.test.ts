// @vitest-environment jsdom
import type { Page } from '@playwright/test';
import { afterEach, expect, it, vi } from 'vitest';
import { programmaticLoginWithRoutes } from '../e2e/helpers';
import type { E2EWindow, PracticePrivacyFixture } from '../e2e/helpers/setupE2EManifest';

// Only the unrelated route registrations/readiness transport are faked. Invoke the real login helper,
// run the exact callback the real manifest installs at document start, then query its actual client.
vi.mock('../e2e/mock-routes', () => ({ setupE2EMocks: vi.fn() }));

const browser = window as unknown as E2EWindow;
type Client = {
    auth: { signOut: () => Promise<unknown> };
    from: (table: string) => { select: () => { eq: (key: string, value: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
    } } };
};

afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete browser.supabase;
    vi.restoreAllMocks();
});

it.each([
    ['unselected', undefined, null],
    ['saving-only', { transcriptSave: true, aiCoaching: false }, { transcript_save: true, ai_coaching: false }],
    ['explicit coaching', { transcriptSave: true, aiCoaching: true }, { transcript_save: true, ai_coaching: true }],
] as const)('routes the %s fixture only to the seeded browser owner', async (_label, privacy, expected) => {
    vi.spyOn(window, 'setInterval').mockReturnValue(0);
    let initialize: (() => void) | undefined;
    const goto = vi.fn(async () => { initialize?.(); });
    const page = {
        on: vi.fn(),
        route: vi.fn(async () => {}),
        locate: vi.fn(),
        locator: () => ({ waitFor: async () => {} }),
        waitForFunction: async () => {},
        addInitScript: async (callback: string | ((arg: unknown) => void), argument?: unknown) => {
            if (typeof callback === 'function') initialize = () => callback(argument);
        },
        goto,
    } as unknown as Page;
    const session = await programmaticLoginWithRoutes(page, { userType: 'pro', practicePrivacy: privacy as PracticePrivacyFixture | undefined });
    expect(goto).toHaveBeenCalledExactlyOnceWith('/');
    const client = browser.supabase as Client;
    const read = (owner: string) => client.from('practice_privacy_choices').select().eq('user_id', owner).maybeSingle();
    const owner = session.user.id;
    await expect(read(owner)).resolves.toMatchObject({ data: expected && {
        ...expected, user_id: owner, choice_revision: 1, consent_version: 1,
    }, error: null });
    await expect(read('unrelated-owner')).resolves.toEqual({ data: null, error: null, count: 0 });
    await client.auth.signOut();
    await expect(read(owner)).resolves.toEqual({ data: null, error: null, count: 0 });
});
