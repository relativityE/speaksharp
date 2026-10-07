/**
 * #1258 (boundary table 6044288308) — a failed review names the boundary the server reported.
 *
 * The PO's take failed `unavailable` after 13.9 s and nothing in the browser said why: the client read only the HTTP
 * status and dropped the closed `reason` get-ai-suggestions returns on its provider/output exit (502). The failure
 * event now carries that closed reason and the status, and still never anything from the body that is not closed.
 */
import React from 'react';
import { render, screen, cleanup, waitFor } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AISuggestions from '@/components/session/AISuggestions';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { projectEventProps } from '@/services/telemetryAllowlist';

vi.mock('@/lib/supabaseClient');

const invoke = vi.fn();
const httpError = (status: number, body: unknown) => {
    const err = new Error('Edge Function returned a non-2xx status code') as Error & { name: string; context: unknown };
    err.name = 'FunctionsHttpError';
    err.context = { status, clone: () => ({ json: async () => body }) };
    return { data: null, error: err };
};
const failed = () => vi.mocked(analyticsBuffer.push).mock.calls
    .filter(([event]) => event === 'practice_loop_review_failed')
    .map(([, props]) => (props ?? {}) as Record<string, unknown>);

describe('#1258 — failed review telemetry names the server boundary', () => {
    beforeEach(() => {
        invoke.mockReset();
        vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke } } as unknown as ReturnType<typeof getSupabaseClient>);
        vi.spyOn(analyticsBuffer, 'push');
    });
    afterEach(() => { cleanup(); vi.restoreAllMocks(); });

    it('CASUALTY: a 502 provider failure records server_reason=provider_http_5xx and http_status=502', async () => {
        invoke.mockResolvedValue(httpError(502, { error: 'AI coaching could not be generated. Please try again.', reason: 'provider_http_5xx' }));
        render(<AISuggestions transcript="Hello world" canReview sessionId="s-502" product="open_mic" />);
        await waitFor(() => expect(failed()).toHaveLength(1));
        expect(failed()[0]).toMatchObject({ reason: 'unavailable', server_reason: 'provider_http_5xx', http_status: 502 });
        expect(projectEventProps('practice_loop_review_failed', failed()[0]).dropped).toEqual([]);
        expect(await screen.findByText(/unavailable right now/i)).toBeInTheDocument();
    });

    it('a save/read-back 503 with no reason records the status only', async () => {
        invoke.mockResolvedValue(httpError(503, { error: 'AI coaching could not be saved. Please try again.' }));
        render(<AISuggestions transcript="Hello world" canReview sessionId="s-503" product="open_mic" />);
        await waitFor(() => expect(failed()).toHaveLength(1));
        expect(failed()[0]).toMatchObject({ reason: 'unavailable', http_status: 503 });
        expect(failed()[0]).not.toHaveProperty('server_reason');
    });

    it('a reason that is not one of the closed codes is never forwarded (no prose crosses the boundary)', async () => {
        invoke.mockResolvedValue(httpError(502, { reason: 'Gemini said the transcript mentioned layoffs' }));
        render(<AISuggestions transcript="Hello world" canReview sessionId="s-prose" product="open_mic" />);
        await waitFor(() => expect(failed()).toHaveLength(1));
        expect(failed()[0]).not.toHaveProperty('server_reason');
        expect(JSON.stringify(failed()[0])).not.toMatch(/layoffs/);
    });

    it('the allowlist refuses an unknown server_reason and an out-of-range status', () => {
        expect(projectEventProps('practice_loop_review_failed', { server_reason: 'quota_blown', http_status: 999 }).dropped.sort())
            .toEqual(['http_status', 'server_reason']);
    });
});
