/**
 * Focus Points is included in the active 30-day trial (PO 2026-09-28; PM 5869975833; migration 20260928120000).
 *
 * The fix is server-only: has_objective_capability() is the single authority. That is sufficient only if the client makes
 * NO tier or trial decision of its own on the Focus Points path — otherwise a trial customer would still be blocked in the
 * browser after the migration. This proves both halves: the client outcome follows the server's answer alone, and no Focus
 * Points entry module consults subscription status, trial state or usage limits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, from }) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import { startObjectiveBrief } from '../objectiveBriefService';

const brief = { goal: 'A better weekly team handoff', points: [{ label: 'Updates get lost across scattered tools.' }] };

describe('Focus Points trial parity — the server capability is the only authority', () => {
    beforeEach(() => { rpc.mockReset(); from.mockReset(); });

    it('a trial account the server grants proceeds to its brief; the client reads no profile or tier', async () => {
        rpc.mockResolvedValueOnce({ data: 'proj-1', error: null }).mockResolvedValueOnce({ data: 'brief-1', error: null });
        await expect(startObjectiveBrief(brief)).resolves.toEqual({ ok: true, projectId: 'proj-1', briefId: 'brief-1' });
        expect(rpc.mock.calls.map(([fn]) => fn)).toEqual(['issue_objective_project_v1', 'issue_objective_brief_v1']);
        expect(from).not.toHaveBeenCalled();
    });

    it('CONTROL: the same request refused by the server (42501, e.g. an expired trial) is the honest capability state', async () => {
        rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
        await expect(startObjectiveBrief(brief)).resolves.toMatchObject({ ok: false, reason: 'capability' });
        expect(from).not.toHaveBeenCalled();
    });

    it('no Focus Points entry module makes its own tier, trial or usage decision', () => {
        const root = resolve(__dirname, '../../../..');
        const files = [
            'src/components/practice/ObjectiveSetupDialog.tsx',
            'src/components/session/ObjectiveSetupForm.tsx',
            'src/services/objective/objectiveBriefService.ts',
            'src/services/objective/objectiveSessionService.ts',
        ];
        for (const file of files) {
            const code = readFileSync(resolve(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
            expect({ file, gate: /subscription_status|trial_expires_at|commercial_trial|isPro|isTrial|effectiveTier|useUsageLimit|tier\s*===/.test(code) })
                .toEqual({ file, gate: false });
        }
    });
});
