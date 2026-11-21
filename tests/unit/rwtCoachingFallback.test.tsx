// @vitest-environment jsdom
/**
 * J3 `coaching_fallback_shown` (Elon, Sam 2026-11-21): the live reader runs against the REAL review card (AISuggestions,
 * rendered after a provider outage), through a DOM-backed stand-in for the Playwright locator it uses. The verdict is PASS
 * only when all five checks hold, never presses anything, never touches the coaching row, and is NOT RUN when coaching
 * rendered.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '../../frontend/tests/support/test-utils';
import AISuggestions from '@/components/session/AISuggestions';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { grantPracticePrivacy } from '../../frontend/tests/test-utils/practicePrivacy';
import {
    COACHING_FALLBACK_ROW, IN_FLIGHT_HEADLINE, coachingFallbackRow, coachingFallbackVerdict, readCoachingFallback,
    type CardLocator, type CoachingFallbackObservation,
} from '../live/helpers/rwtCoachingFallback';

vi.mock('@/lib/supabaseClient');
const invoke = vi.fn();

/** A Playwright-shaped locator over a jsdom subtree: count, first, isVisible, isEnabled, innerText; no click exists. */
function domCard(root: Element): CardLocator & { reads: string[] } {
    const reads: string[] = [];
    const visibleNode = (el: Element | null) => {
        for (let n: Element | null = el; n; n = n.parentElement) if ((n as HTMLElement).hidden || n.getAttribute('aria-hidden') === 'true') return false;
        return el !== null;
    };
    return {
        reads,
        getByTestId: (id: string) => {
            const all = () => [...root.querySelectorAll(`[data-testid="${id}"]`)];
            const first = () => all()[0] ?? null;
            return {
                count: async () => { reads.push(`count:${id}`); return all().length; },
                first: () => ({
                    isVisible: async () => { reads.push(`visible:${id}`); return visibleNode(first()); },
                    isEnabled: async () => { reads.push(`enabled:${id}`); const el = first(); if (!el) throw new Error('no node'); return !(el as HTMLButtonElement).disabled; },
                    innerText: async () => { reads.push(`text:${id}`); const el = first(); if (!el) throw new Error('no node'); return el.textContent ?? ''; },
                }),
            } as never;
        },
    };
}

const providerOutage = () => {
    const err = new Error('Edge Function returned a non-2xx status code') as Error & { name: string; context: unknown };
    err.name = 'FunctionsHttpError';
    err.context = { status: 502, clone: () => ({ json: async () => ({ error: 'AI coaching could not be generated. Please try again.',
        reason: 'provider_http_5xx', diagnostics: { provider_status: 503 } }) }) };
    return { data: null, error: err };
};
const ok = { data: { suggestions: { version: 'gemini_coaching_v1', what_worked: 'Clear opening.', what_to_try_next: 'State the ask first.' } }, error: null };

async function failedCard(): Promise<Element> {
    invoke.mockResolvedValueOnce(providerOutage());
    render(<AISuggestions transcript="Hello world" canReview sessionId="s-fallback" retryBackoffMs={10} />);
    const card = screen.getByTestId('ai-suggestions-card');
    await waitFor(() => expect(card).toHaveAttribute('data-review-state', 'error'));
    await waitFor(() => expect(screen.getByTestId('ai-suggestions-retry')).toBeEnabled());
    return card;
}
const sink = () => { const rows: Array<{ step: string; verdict: string; detail: string; evidence?: Record<string, unknown> }> = [];
    return { rows, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, unknown>) => { rows.push({ step, verdict, detail, evidence }); } }; };

describe('J3 coaching_fallback_shown, read from the real review card', () => {
    beforeEach(() => {
        grantPracticePrivacy();
        invoke.mockReset();
        vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke } } as unknown as ReturnType<typeof getSupabaseClient>);
    });
    afterEach(() => { cleanup(); });

    it('a provider outage: the card shows message, enabled Try again and disclosure, no pair: PASS, with nothing pressed', async () => {
        const card = domCard(await failedCard());
        const o = await readCoachingFallback(card);
        expect(o).toEqual({ stillComingVisible: true, headlineVisible: true, headlineInFlight: false, retryVisible: true, retryEnabled: true,
            retryLabelExact: true, pairCount: 0, disclosureVisible: true });
        expect(coachingFallbackVerdict(o).verdict).toBe('PASS');
        expect(invoke, 'reading the fallback sends no second request').toHaveBeenCalledTimes(1);
        expect(card.reads.every((r) => /^(count|visible|enabled|text):/.test(r))).toBe(true);
    });

    it('each missing part of the fallback FAILs by name', async () => {
        const cases: Array<[string, (root: Element) => void, string]> = [
            ['no still-coming band', (r) => r.querySelector('[data-testid="ai-suggestions-still-coming"]')!.setAttribute('data-testid', 'gone'), 'the still-coming band is visible'],
            ['headline hidden', (r) => { (r.querySelector('[data-testid="ai-suggestions-headline"]') as HTMLElement).hidden = true; }, 'the headline is visible'],
            ['the in-flight line after failure', (r) => { r.querySelector('[data-testid="ai-suggestions-headline"]')!.textContent = IN_FLIGHT_HEADLINE; }, 'the headline is not the in-flight line'],
            ['no Try again', (r) => r.querySelector('[data-testid="ai-suggestions-retry"]')!.remove(), 'Try again is visible|Try again is enabled|Try again reads exactly "Try again"'],
            ['Try again disabled', (r) => { (r.querySelector('[data-testid="ai-suggestions-retry"]') as HTMLButtonElement).disabled = true; }, 'Try again is enabled'],
            ['Try again relabelled', (r) => { r.querySelector('[data-testid="ai-suggestions-retry"]')!.textContent = 'Retry'; }, 'Try again reads exactly "Try again"'],
            ['a review pair is also shown', (r) => { const d = document.createElement('div'); d.setAttribute('data-testid', 'ai-suggestions-pair'); r.appendChild(d); }, 'no review pair is rendered'],
            ['no disclosure', (r) => r.querySelector('[data-testid="ai-suggestions-disclosure"]')!.remove(), 'the coaching disclosure is visible'],
        ];
        for (const [name, mutate, check] of cases) {
            const root = await failedCard();
            mutate(root);
            const v = coachingFallbackVerdict(await readCoachingFallback(domCard(root)));
            expect(v.verdict, name).toBe('FAIL');
            expect(v.missing, name).toEqual(check.split('|'));
            cleanup();
        }
    });

    it('the card still in flight is not a fallback: headline on its way and no enabled Try again FAIL', async () => {
        invoke.mockReturnValueOnce(new Promise(() => undefined));
        render(<AISuggestions transcript="Hello world" canReview sessionId="s-in-flight" retryBackoffMs={10} />);
        await waitFor(() => expect(screen.getByTestId('ai-suggestions-headline')).toHaveTextContent(IN_FLIGHT_HEADLINE));
        const v = coachingFallbackVerdict(await readCoachingFallback(domCard(screen.getByTestId('ai-suggestions-card'))));
        expect(v.verdict).toBe('FAIL');
        expect(v.missing).toContain('the headline is not the in-flight line');
        expect(v.missing).toContain('Try again is enabled');
    });

    it('a read that fails is unknown, never absence: the verdict is HOLD, not FAIL', async () => {
        const root = await failedCard();
        const real = domCard(root);
        const broken: CardLocator = { getByTestId: (id: string) => {
            const nodes = real.getByTestId(id);
            return id === 'ai-suggestions-still-coming' ? { ...nodes, count: async () => { throw new Error('detached'); } } as never : nodes;
        } };
        const o = await readCoachingFallback(broken);
        expect(o.stillComingVisible).toBeNull();
        expect(coachingFallbackVerdict(o)).toEqual(expect.objectContaining({ verdict: 'HOLD', missing: [] }));
    });

    it('rendered coaching has no pair-free fallback to read, and the reader sees its pair', async () => {
        invoke.mockResolvedValueOnce(ok);
        render(<AISuggestions transcript="Hello world" canReview sessionId="s-ok" retryBackoffMs={10} />);
        await screen.findByText('Clear opening.');
        const o = await readCoachingFallback(domCard(screen.getByTestId('ai-suggestions-card')));
        expect(o.pairCount).toBe(1);
        expect(o.stillComingVisible).toBe(false);
    });
});

describe('J3 coaching_fallback_shown row', () => {
    const allGood: CoachingFallbackObservation = { stillComingVisible: true, headlineVisible: true, headlineInFlight: false, retryVisible: true,
        retryEnabled: true, retryLabelExact: true, pairCount: 0, disclosureVisible: true };
    const fixedRead = (o: CoachingFallbackObservation) => async () => o;
    const noCard = {} as CardLocator;

    it('coaching rendered: NOT RUN, no row written and nothing read', async () => {
        const r = sink();
        const read = vi.fn(fixedRead(allGood));
        expect(await coachingFallbackRow(r, noCard, { settled: true, rendered: true, reviewState: 'ready' }, read)).toBe('NOT RUN');
        expect(r.rows).toEqual([]);
        expect(read).not.toHaveBeenCalled();
    });

    it('a request unsettled at the coaching bound: HOLD, nothing judged', async () => {
        const r = sink();
        const read = vi.fn(fixedRead(allGood));
        expect(await coachingFallbackRow(r, noCard, { settled: false, rendered: false, reviewState: 'loading' }, read)).toBe('HOLD');
        expect(r.rows).toEqual([expect.objectContaining({ step: COACHING_FALLBACK_ROW, verdict: 'HOLD' })]);
        expect(read).not.toHaveBeenCalled();
    });

    it('settled with a review pair: not a failure ending, NOT RUN with no row', async () => {
        const r = sink();
        expect(await coachingFallbackRow(r, noCard, { settled: true, rendered: false, reviewState: 'ready' }, fixedRead({ ...allGood, pairCount: 1 }))).toBe('NOT RUN');
        expect(r.rows).toEqual([]);
    });

    it('a settled failure writes its own row only: PASS, FAIL or HOLD, with content-free evidence', async () => {
        for (const [o, want] of [[allGood, 'PASS'], [{ ...allGood, disclosureVisible: false }, 'FAIL'], [{ ...allGood, retryEnabled: null }, 'HOLD'],
            [{ ...allGood, pairCount: null }, 'HOLD'], [{ ...allGood, retryEnabled: null, disclosureVisible: false }, 'FAIL']] as const) {
            const r = sink();
            expect(await coachingFallbackRow(r, noCard, { settled: true, rendered: false, reviewState: 'error' }, fixedRead(o))).toBe(want);
            expect(r.rows.map((x) => [x.step, x.verdict])).toEqual([[COACHING_FALLBACK_ROW, want]]);
            const ev = r.rows[0].evidence!;
            expect(ev.observationId).toBe('coaching_fallback_shown');
            expect(Object.values(ev).every((v) => v === null || ['boolean', 'number'].includes(typeof v) || v === 'error' || v === 'coaching_fallback_shown')).toBe(true);
        }
    });

    it('the J3 coaching step writes the row after the coaching row, never changes it, and the reader presses nothing', () => {
        const journey = readFileSync(resolve(__dirname, '../live/helpers/rwtJourney.ts'), 'utf8');
        const fn = journey.slice(journey.indexOf('export async function focusCoachingRows('));
        const rendered = fn.indexOf("receipt.row('Focus coaching rendered', parent.verdict,");
        const fallback = fn.indexOf('await coachingFallbackRow(receipt, card, { settled: terminal, rendered: two, reviewState: state });');
        expect(rendered).toBeGreaterThan(0);
        expect(fallback).toBeGreaterThan(rendered);
        expect(fn.indexOf("receipt.row('Focus coaching rendered'", rendered + 1), 'the coaching row is written once').toBe(-1);
        const helper = readFileSync(resolve(__dirname, '../live/helpers/rwtCoachingFallback.ts'), 'utf8');
        expect(helper).not.toMatch(/\.(click|press|tap|dispatchEvent|check|fill)\(/);
        expect(helper).not.toMatch(/Focus coaching rendered'/);
    });
});
