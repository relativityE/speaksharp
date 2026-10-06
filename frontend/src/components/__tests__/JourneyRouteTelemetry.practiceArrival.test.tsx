/**
 * #1258 (Codex r4191751371) — a saved-review practice press must be PROVABLY the cause of its arrival.
 *
 * The press records `saved_review_practice_action{action_seq}` and navigates with that sequence in router state
 * (memory only, never the URL). This emitter, mounted beside the routes, emits `saved_review_practice_arrived`
 * {action_seq, route_class} once for that history entry. A navigation WITHOUT that state (any later, unrelated move)
 * emits nothing, so received telemetry cannot attribute a later route to an earlier press.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { JourneyRouteTelemetry } from '../JourneyRouteTelemetry';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { projectEventProps } from '@/services/telemetryAllowlist';
import { __resetJourneyIdentityForTests } from '@/services/telemetry/journeyIdentity';
import { __resetJourneyBoundaryForTests } from '@/hooks/useJourneyBoundary';

let arrivals: Array<Record<string, unknown>> = [];
beforeEach(() => {
    __resetJourneyIdentityForTests();
    __resetJourneyBoundaryForTests();
    arrivals = [];
    vi.spyOn(analyticsBuffer, 'push').mockImplementation(((name: string, props: Record<string, unknown>) => {
        if (name === 'saved_review_practice_arrived') arrivals.push(props);
    }) as never);
});

function Go({ id, to, state }: { id: string; to: string; state?: unknown }) {
    const navigate = useNavigate();
    return <button data-testid={id} onClick={() => navigate(to, state === undefined ? undefined : { state })}>{id}</button>;
}
const mount = (buttons: Array<{ id: string; to: string; state?: unknown }>) => render(
    <MemoryRouter initialEntries={['/analytics/s1']}>
        <JourneyRouteTelemetry />
        {buttons.map((b) => <Go key={b.id} {...b} />)}
    </MemoryRouter>,
);

describe('#1258 saved_review_practice_arrived', () => {
    it.each([
        ['/session', 'session'],
        ['/practice?product=focus-points', 'focus_setup'],
        ['/practice', 'practice'],
        ['/analytics', 'other'],
    ])('a press that lands on %s arrives as %s, with the press sequence', (to, routeClass) => {
        mount([{ id: 'press', to, state: { practiceActionSeq: 7 } }]);
        fireEvent.click(screen.getByTestId('press'));
        expect(arrivals).toEqual([{ action_seq: 7, route_class: routeClass }]);
        expect(projectEventProps('saved_review_practice_arrived', arrivals[0] as never).dropped).toEqual([]);
    });

    it('CASUALTY: a later navigation WITHOUT the press state emits no arrival, so it cannot be attributed to the press', () => {
        mount([{ id: 'press', to: '/session', state: { practiceActionSeq: 1 } }, { id: 'later', to: '/analytics' }]);
        fireEvent.click(screen.getByTestId('press'));
        fireEvent.click(screen.getByTestId('later'));
        expect(arrivals).toEqual([{ action_seq: 1, route_class: 'session' }]);
    });

    it('CASUALTY: a missing, malformed or out-of-range sequence emits nothing', () => {
        mount([
            { id: 'none', to: '/session' },
            { id: 'string', to: '/session', state: { practiceActionSeq: '3' } },
            { id: 'zero', to: '/session', state: { practiceActionSeq: 0 } },
            { id: 'big', to: '/session', state: { practiceActionSeq: 101 } },
            { id: 'other-state', to: '/session', state: { from: '/analytics' } },
        ]);
        for (const id of ['none', 'string', 'zero', 'big', 'other-state']) fireEvent.click(screen.getByTestId(id));
        expect(arrivals).toEqual([]);
    });

    it('CASUALTY: content in the state never reaches the event; only the sequence and the closed route class do', () => {
        mount([{ id: 'press', to: '/practice?product=focus-points&topic=secret', state: { practiceActionSeq: 2, sessionId: 'sess-1' } }]);
        fireEvent.click(screen.getByTestId('press'));
        expect(arrivals).toEqual([{ action_seq: 2, route_class: 'focus_setup' }]);
        expect(JSON.stringify(arrivals)).not.toMatch(/secret|sess-1|topic/);
    });
});
