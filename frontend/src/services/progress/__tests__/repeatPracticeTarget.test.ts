import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { authEpoch, setCurrentLogin } from '@/services/loginSessionLog';
import { clearOpenAttempt, getOpenAttemptForUser, setOpenAttempt, subscribeOpenAttempt } from '../openAttempt';
import { resolveRepeatTarget, useRepeatPracticeTarget, validateDisplayedTarget, type DisplayedRepeatTarget } from '../repeatPracticeTarget';

const { rowRead, focusRead, eq } = vi.hoisted(() => ({ rowRead: vi.fn(), focusRead: vi.fn(), eq: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from: () => ({ select: () => {
    const query = { eq: (...args: unknown[]) => { eq(...args); return query; }, maybeSingle: () => rowRead() };
    return query;
} }) }) }));
vi.mock('@/services/objective/savedFocusPointsCoverage', () => ({ loadSavedFocusPointsCoverage: () => focusRead() }));
const raw = (instruction = 'Name the price first.', version = 'gemini_coaching_v1') => ({ version, what_worked: 'Clear opening.', what_to_try_next: instruction });
const focus = { projectId: 'p1', briefId: 'b1', topic: 'Pitch', points: ['One', 'Two'] };
const coverage = () => ({ kind: 'coverage', brief: { projectId: 'p1', briefId: 'b1', topic: 'Pitch' }, points: [{ label: 'One' }, { label: 'Two' }] });
const snapshot = (overrides: Partial<DisplayedRepeatTarget> = {}): DisplayedRepeatTarget => ({
    ownerId: 'owner-1', epoch: authEpoch(), sessionId: 'source-1', product: 'open_mic',
    instruction: 'Name the price first.', focus: null, isCurrent: () => true, ...overrides,
});
const handoff = async (target = snapshot()) => {
    const reference = await validateDisplayedTarget(target);
    setOpenAttempt({ userId: 'owner-1', attemptId: 'a1', sourceSessionId: 'source-1', repeatTarget: reference });
    return reference;
};
beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); setCurrentLogin('owner-1', 100);
    vi.stubGlobal('crypto', webcrypto);
    rowRead.mockResolvedValue({ data: { product: 'open_mic', ai_suggestions: raw() }, error: null });
    focusRead.mockResolvedValue(coverage());
});
afterEach(() => { vi.unstubAllGlobals(); clearOpenAttempt(); setCurrentLogin(null, null); });

describe('#1548 displayed source, canonicalization and exact retry reference', () => {
    it('rejects hidden newer advice before acceptance; server query explicitly binds owner and source', async () => {
        rowRead.mockResolvedValue({ data: { product: 'open_mic', ai_suggestions: raw('Different advice.') }, error: null });
        await expect(validateDisplayedTarget(snapshot())).rejects.toThrow('repeat-target-unavailable');
        expect(eq).toHaveBeenCalledWith('user_id', 'owner-1'); expect(eq).toHaveBeenCalledWith('id', 'source-1');
        expect(localStorage.length).toBe(0);
    });
    it('object/JSON string and surrounding trim canonicalize together; interior whitespace and version do not', async () => {
        const reference = await validateDisplayedTarget(snapshot());
        rowRead.mockResolvedValue({ data: { product: 'open_mic', ai_suggestions: JSON.stringify(raw('  Name the price first.\n')) }, error: null });
        await expect(validateDisplayedTarget(snapshot())).resolves.toEqual(reference);
        for (const changed of [raw('Name  the price first.'), raw('Name the price first.', 'gemini_coaching_focus_v1')]) {
            rowRead.mockResolvedValue({ data: { product: 'open_mic', ai_suggestions: changed }, error: null });
            await expect(resolveRepeatTarget('owner-1', 'source-1', reference, () => true)).rejects.toThrow();
        }
    });
    it('the first raw read establishes version; same-text version-only changes before it are not detectable', async () => {
        rowRead.mockResolvedValue({ data: { product: 'open_mic', ai_suggestions: raw('Name the price first.', 'gemini_coaching_focus_v1') }, error: null });
        const reference = await validateDisplayedTarget(snapshot());
        rowRead.mockResolvedValue({ data: { product: 'open_mic', ai_suggestions: raw() }, error: null });
        await expect(resolveRepeatTarget('owner-1', 'source-1', reference, () => true)).rejects.toThrow();
    });
    it.each([null, { version: 'future', what_worked: 'A', what_to_try_next: 'Name the price first.' }, { version: 'gemini_coaching_v1', what_to_try_next: 'Name the price first.' }])('missing or invalid cache fails closed: %j', async bad => {
        rowRead.mockResolvedValue({ data: { product: 'open_mic', ai_suggestions: bad }, error: null });
        await expect(validateDisplayedTarget(snapshot())).rejects.toThrow();
    });
    it('product mutation cannot turn the displayed Open Mic instruction into a Focus repeat', async () => {
        rowRead.mockResolvedValue({ data: { product: 'focus_points', ai_suggestions: raw('Name the price first.', 'gemini_coaching_focus_v1') }, error: null });
        await expect(validateDisplayedTarget(snapshot())).rejects.toThrow();
    });
    it.each(['topic', 'order', 'label', 'brief'] as const)('Focus %s change rejects the displayed snapshot', async change => {
        rowRead.mockResolvedValue({ data: { product: 'focus_points', ai_suggestions: raw('Name the price first.', 'gemini_coaching_focus_v1') }, error: null });
        const saved = coverage();
        if (change === 'topic') saved.brief.topic = 'Other';
        if (change === 'brief') saved.brief.briefId = 'b2';
        if (change === 'order') saved.points.reverse();
        if (change === 'label') saved.points[0].label = 'ONE';
        focusRead.mockResolvedValue(saved);
        await expect(validateDisplayedTarget(snapshot({ product: 'focus_points', focus }))).rejects.toThrow();
    });
    it('a legitimate empty optional Focus topic stays empty and does not become a new readiness requirement', async () => {
        rowRead.mockResolvedValue({ data: { product: 'focus_points', ai_suggestions: raw('Name the price first.', 'gemini_coaching_focus_v1') }, error: null });
        const saved = coverage(); saved.brief.topic = ''; focusRead.mockResolvedValue(saved);
        const reference = await validateDisplayedTarget(snapshot({ product: 'focus_points', focus: { ...focus, topic: '' } }));
        await expect(resolveRepeatTarget('owner-1', 'source-1', reference, () => true)).resolves.toMatchObject({ focus: { topic: '' } });
    });
    it.each(['owner', 'ABA', 'generation'] as const)('late source completion after %s change is rejected', async change => {
        let complete!: (v: unknown) => void;
        rowRead.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        let active = true;
        const pending = validateDisplayedTarget(snapshot({ isCurrent: () => active }));
        if (change === 'owner') setCurrentLogin('owner-2', 200);
        if (change === 'ABA') { setCurrentLogin('owner-2', 200); setCurrentLogin('owner-1', 100); }
        if (change === 'generation') active = false;
        complete({ data: { product: 'open_mic', ai_suggestions: raw() }, error: null });
        await expect(pending).rejects.toThrow();
    });
    it('auth change while SHA-256 is pending cannot publish the derived reference', async () => {
        let complete!: (value: ArrayBuffer) => void;
        const digest = vi.fn(() => new Promise<ArrayBuffer>(resolve => { complete = resolve; }));
        vi.stubGlobal('crypto', { subtle: { digest } });
        const pending = validateDisplayedTarget(snapshot());
        await waitFor(() => expect(digest).toHaveBeenCalledOnce());
        setCurrentLogin('owner-2', 200);
        complete(new ArrayBuffer(32));
        await expect(pending).rejects.toThrow();
    });
    it('auth change while saved Focus read is pending cannot publish its labels or reference', async () => {
        let complete!: (value: ReturnType<typeof coverage>) => void;
        rowRead.mockResolvedValue({ data: { product: 'focus_points', ai_suggestions: raw('Name the price first.', 'gemini_coaching_focus_v1') }, error: null });
        focusRead.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        const pending = validateDisplayedTarget(snapshot({ product: 'focus_points', focus }));
        await waitFor(() => expect(focusRead).toHaveBeenCalledOnce());
        setCurrentLogin('owner-2', 200); setCurrentLogin('owner-1', 100);
        complete(coverage());
        await expect(pending).rejects.toThrow();
    });
});

describe('#1548 persistence, reload, replacement and first-render masking', () => {
    it('retires inherited advice once saved repeat B is resolution-bound, preserving the pending metric attempt', async () => {
        await handoff();
        const open = getOpenAttemptForUser('owner-1')!;
        setOpenAttempt({ ...open, resolutionSessionId: 'saved-repeat-B' });
        rowRead.mockClear();
        const view = renderHook(() => useRepeatPracticeTarget('owner-1', null));
        expect(view.result.current).toEqual({ kind: 'none' });
        expect(getOpenAttemptForUser('owner-1')).toMatchObject({ attemptId: 'a1', resolutionSessionId: 'saved-repeat-B' });
        expect(rowRead).not.toHaveBeenCalled();
    });
    it('a pending source response cannot resurrect advice after the real handoff becomes resolution-bound', async () => {
        await handoff();
        let complete!: (value: unknown) => void;
        rowRead.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
        const view = renderHook(() => useRepeatPracticeTarget('owner-1', null));
        expect(view.result.current.kind).toBe('pending');
        const open = getOpenAttemptForUser('owner-1')!;
        act(() => { setOpenAttempt({ ...open, resolutionSessionId: 'saved-repeat-B' }); });
        expect(view.result.current).toEqual({ kind: 'none' });
        await act(async () => complete({ data: { product: 'open_mic', ai_suggestions: raw() }, error: null }));
        expect(view.result.current).toEqual({ kind: 'none' });
        expect(getOpenAttemptForUser('owner-1')?.resolutionSessionId).toBe('saved-repeat-B');
    });
    it('a throwing observer cannot falsely fail a durable write or erase its metric handoff', () => {
        const off = subscribeOpenAttempt(() => { throw new Error('observer-failed'); });
        try {
            expect(setOpenAttempt({ userId: 'owner-1', attemptId: 'a1', sourceSessionId: 'source-1' })).toBe(true);
            expect(getOpenAttemptForUser('owner-1')?.attemptId).toBe('a1');
        } finally { off(); }
    });
    it('only allowlisted references persist; absent/future/malformed metadata preserve the metric attempt', async () => {
        const reference = await validateDisplayedTarget(snapshot());
        for (const metadata of [undefined, { version: 2, instruction: 'SECRET' }, { version: 1, instruction: 'SECRET' }, { ...reference, instruction: 'SECRET', topic: 'SECRET', labels: ['SECRET'] }]) {
            setOpenAttempt({ userId: 'owner-1', attemptId: 'a1', sourceSessionId: 'source-1', repeatTarget: metadata } as Parameters<typeof setOpenAttempt>[0]);
            expect(getOpenAttemptForUser('owner-1')).toMatchObject({ attemptId: 'a1', sourceSessionId: 'source-1' });
            expect(JSON.stringify(localStorage)).not.toContain('SECRET');
        }
    });
    it('a reloaded Open Mic reference resolves the same instruction, then replacement immediately clears it', async () => {
        await handoff();
        const view = renderHook(() => useRepeatPracticeTarget('owner-1', null));
        await waitFor(() => expect(view.result.current).toEqual({ kind: 'ready', instruction: 'Name the price first.' }));
        act(() => { setOpenAttempt({ userId: 'owner-1', attemptId: 'a2', sourceSessionId: 'source-2' }); });
        expect(view.result.current).toEqual({ kind: 'none' });
        expect(getOpenAttemptForUser('owner-1')?.attemptId).toBe('a2');
    });
    it('late source A cannot overwrite a same-attempt replacement that already rendered source B', async () => {
        const oldReference = await validateDisplayedTarget(snapshot());
        rowRead.mockResolvedValue({ data: { product: 'open_mic', ai_suggestions: raw('Different target B.') }, error: null });
        const newReference = await validateDisplayedTarget(snapshot({ sessionId: 'source-2', instruction: 'Different target B.' }));
        setOpenAttempt({ userId: 'owner-1', attemptId: 'a1', sourceSessionId: 'source-1', repeatTarget: oldReference });
        let complete!: (value: unknown) => void;
        rowRead.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
        const view = renderHook(() => useRepeatPracticeTarget('owner-1', null));
        expect(view.result.current.kind).toBe('pending');
        act(() => { setOpenAttempt({ userId: 'owner-1', attemptId: 'a1', sourceSessionId: 'source-2', repeatTarget: newReference }); });
        await waitFor(() => expect(view.result.current).toEqual({ kind: 'ready', instruction: 'Different target B.' }));
        await act(async () => complete({ data: { product: 'open_mic', ai_suggestions: raw() }, error: null }));
        expect(view.result.current).toEqual({ kind: 'ready', instruction: 'Different target B.' });
        expect(getOpenAttemptForUser('owner-1')?.sourceSessionId).toBe('source-2');
    });
    it('Focus null after reload stays unmatched; selecting the exact saved set enables the same reference', async () => {
        rowRead.mockResolvedValue({ data: { product: 'focus_points', ai_suggestions: raw('Name the price first.', 'gemini_coaching_focus_v1') }, error: null });
        await handoff(snapshot({ product: 'focus_points', focus }));
        const view = renderHook(({ selected }) => useRepeatPracticeTarget('owner-1', selected), { initialProps: { selected: null as typeof focus | null } });
        expect(view.result.current.kind).toBe('unavailable');
        view.rerender({ selected: focus });
        await waitFor(() => expect(view.result.current.kind).toBe('ready'));
        view.rerender({ selected: { ...focus, topic: 'Deliberately selected other topic' } });
        expect(view.result.current.kind).not.toBe('ready');
        expect(focus.topic).toBe('Pitch');
    });
    it('retry never adopts changed advice and account ABA hides an already rendered target immediately', async () => {
        await handoff();
        const view = renderHook(() => useRepeatPracticeTarget('owner-1', null));
        await waitFor(() => expect(view.result.current.kind).toBe('ready'));
        rowRead.mockResolvedValue({ data: { product: 'open_mic', ai_suggestions: raw('New hidden advice.') }, error: null });
        act(() => { setCurrentLogin('owner-2', 200); setCurrentLogin('owner-1', 100); view.rerender(); });
        expect(view.result.current.kind).not.toBe('ready');
        await waitFor(() => expect(view.result.current.kind).toBe('unavailable'));
        act(() => { if (view.result.current.kind === 'unavailable') view.result.current.retry(); });
        await waitFor(() => expect(view.result.current.kind).toBe('unavailable'));
        expect(JSON.stringify(view.result.current)).not.toContain('New hidden advice.');
    });
});
