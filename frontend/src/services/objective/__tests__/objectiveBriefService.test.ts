import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc }) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import { startObjectiveBrief, DEFAULT_OBJECTIVE_TIME_BUDGET_SECONDS } from '../objectiveBriefService';

const okProject = { data: 'proj-1', error: null };
const okBrief = { data: 'brief-1', error: null };

describe('#1046 objectiveBriefService.startObjectiveBrief', () => {
    beforeEach(() => rpc.mockReset());

    it('creates the project (title = goal) then the brief, and returns both ids', async () => {
        rpc.mockResolvedValueOnce(okProject).mockResolvedValueOnce(okBrief);

        const result = await startObjectiveBrief({
            goal: '  2-minute sales pitch  ',
            points: [
                { label: '  Name the price  ', cue: '  say the number  ' },
                { label: 'End with a clear ask' },
            ],
        });

        expect(result).toEqual({ ok: true, projectId: 'proj-1', briefId: 'brief-1' });
        // Project first, titled from the trimmed goal.
        expect(rpc.mock.calls[0]).toEqual(['issue_objective_project_v1', { p_title: '2-minute sales pitch' }]);
        // Brief second, attached to the new project, with a defaulted positive time budget + null audience.
        const [fn, args] = rpc.mock.calls[1];
        expect(fn).toBe('issue_objective_brief_v1');
        expect(args).toMatchObject({
            p_project_id: 'proj-1',
            p_event_goal: '2-minute sales pitch',
            p_time_budget_seconds: DEFAULT_OBJECTIVE_TIME_BUDGET_SECONDS,
            p_audience: null,
        });
        // Points are trimmed; cue collapses to null when blank; is_required defaults true; order preserved.
        expect(args.p_points).toEqual([
            { label: 'Name the price', cue: 'say the number', is_required: true },
            { label: 'End with a clear ask', cue: null, is_required: true },
        ]);
    });

    it('drops blank-labelled points before submit', async () => {
        rpc.mockResolvedValueOnce(okProject).mockResolvedValueOnce(okBrief);
        await startObjectiveBrief({ goal: 'g', points: [{ label: 'real' }, { label: '   ' }, { label: '' }] });
        expect(rpc.mock.calls[1][1].p_points).toEqual([{ label: 'real', cue: null, is_required: true }]);
    });

    it('fails fast (no RPC) when the goal is blank', async () => {
        const result = await startObjectiveBrief({ goal: '   ', points: [{ label: 'x' }] });
        expect(result).toEqual({ ok: false, reason: 'validation' });
        expect(rpc).not.toHaveBeenCalled();
    });

    it('fails fast (no RPC) when there are no labelled points', async () => {
        const result = await startObjectiveBrief({ goal: 'g', points: [{ label: '  ' }] });
        expect(result).toEqual({ ok: false, reason: 'validation' });
        expect(rpc).not.toHaveBeenCalled();
    });

    it('maps a capability failure (42501) on the project call and does NOT call the brief RPC', async () => {
        rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
        const result = await startObjectiveBrief({ goal: 'g', points: [{ label: 'x' }] });
        expect(result).toEqual({ ok: false, reason: 'capability' });
        expect(rpc).toHaveBeenCalledTimes(1); // never proceeds to the brief
    });

    it('maps an auth failure (28000) from the brief call', async () => {
        rpc.mockResolvedValueOnce(okProject).mockResolvedValueOnce({ data: null, error: { code: '28000' } });
        const result = await startObjectiveBrief({ goal: 'g', points: [{ label: 'x' }] });
        expect(result).toEqual({ ok: false, reason: 'auth' });
    });

    it('maps an unknown error to reason "error"', async () => {
        rpc.mockResolvedValueOnce(okProject).mockResolvedValueOnce({ data: null, error: { code: 'XXABC' } });
        const result = await startObjectiveBrief({ goal: 'g', points: [{ label: 'x' }] });
        expect(result).toEqual({ ok: false, reason: 'error' });
    });

    it('passes an explicit audience and time budget through when provided', async () => {
        rpc.mockResolvedValueOnce(okProject).mockResolvedValueOnce(okBrief);
        await startObjectiveBrief({ goal: 'g', points: [{ label: 'x' }], audience: '  hiring panel ', timeBudgetSeconds: 90 });
        expect(rpc.mock.calls[1][1]).toMatchObject({ p_audience: 'hiring panel', p_time_budget_seconds: 90 });
    });
});
