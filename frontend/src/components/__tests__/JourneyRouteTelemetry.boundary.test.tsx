/**
 * #1421 P1 — THE ENTRY EVENT MUST BE INSIDE THE JOURNEY IT ANNOUNCES.
 *
 * `useJourneyBoundary` runs in App; this emitter is a descendant. React flushes descendant passive
 * effects BEFORE ancestor ones, so on every re-entry into a product the entry `route_change` was
 * captured under the journey being LEFT, and only afterwards did App mint the id that everything else
 * would carry. The one event that names the transition sat on the wrong side of it.
 *
 * WHY THIS TEST AND NOT THE MODULE TEST NEXT TO IT. A test that calls `ensureJourneyBoundary` directly
 * proves the function works and says nothing about whether the emitter calls it — removing the call
 * from this component left such a test passing. The call site is the finding, so the call site is what
 * is driven here: only this component is rendered, with no ancestor boundary hook to cover for it.
 */
// The shared test-utils render already provides a Router; this test supplies its own MemoryRouter so it
// can control the route, so it uses the bare renderer rather than nesting two routers.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { JourneyRouteTelemetry } from '../JourneyRouteTelemetry';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { currentJourneyId, __resetJourneyIdentityForTests } from '@/services/telemetry/journeyIdentity';
import { __resetJourneyBoundaryForTests } from '@/hooks/useJourneyBoundary';

function Navigator({ to }: { to: string }) {
    const navigate = useNavigate();
    return <button data-testid="go" onClick={() => navigate(to)}>go</button>;
}

/** The journey in force AT THE MOMENT the emitter ran — which is the whole question. */
let journeyAtEmit: string[] = [];

beforeEach(() => {
    __resetJourneyIdentityForTests();
    __resetJourneyBoundaryForTests();
    journeyAtEmit = [];
    vi.spyOn(analyticsBuffer, 'push').mockImplementation(((name: string) => {
        if (name === 'journey_step') journeyAtEmit.push(currentJourneyId());
    }) as never);
});

const enter = (from: string, to: string) => {
    render(
        <MemoryRouter initialEntries={[from]}>
            <JourneyRouteTelemetry />
            <Navigator to={to} />
        </MemoryRouter>,
    );
    // The first render only establishes a starting point; a mount is not a navigation.
    const before = currentJourneyId();
    fireEvent.click(screen.getByTestId('go'));
    return before;
};

describe('#1421 P1 — journey boundary ordering at the emitter', () => {
    it('CASUALTY: entering a product emits the entry event under the NEW journey', () => {
        const outsideJourney = enter('/', '/practice');

        expect({ emitted: journeyAtEmit.length }).toEqual({ emitted: 1 });
        expect({ entryUnderOutgoingJourney: journeyAtEmit[0] === outsideJourney })
            .toEqual({ entryUnderOutgoingJourney: false });
    });

    it('CONTROL: moving between product routes keeps the same journey', () => {
        const productJourney = enter('/practice', '/analytics');

        // Session -> Analytics is one visit. Splitting it would hide exactly the post-session
        // navigation these events exist to describe.
        expect({ emitted: journeyAtEmit.length }).toEqual({ emitted: 1 });
        expect({ sameJourney: journeyAtEmit[0] === productJourney }).toEqual({ sameJourney: true });
    });
});
