import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import type { SttStatus } from '@/types/transcription';
import type { FillerCounts } from '@/utils/fillerWordUtils';

// #1472 (PO Production takes on 576c4712, #1399 D5) — a zero the product cannot verify must never be presented as a
// verified clean result.
//
// The saved v2 take reported `filler_measurement.completeness = unobservable` (a substantive finalized transcript with
// NO filler tokens: a fluent speaker and a decoder that dropped disfluencies look identical), yet the completed page
// said "No filler words detected this session." and the Focus Points delivery strip says "clean delivery" for any
// zero. The v4 take showed the other half: live recognition caught one filler that the final decode omitted, and the
// observed count must stay truthful (#1417 directive).
//
// These tests assert OUTCOMES on the real after-state view, not a component API, so they hold for whichever contract
// shape is accepted. Content-free: synthetic transcripts only.

const base: SessionOverhaulViewProps = {
    authUserId: 'user-1',
    isListening: false,
    sttStatus: { type: 'idle' } as SttStatus,
    elapsedTime: 0,
    micLevel: 0,
    transcriptContent: '',
    showAnalyticsPrompt: false,
    metricsFillerCount: 0,
    onStartStop: vi.fn(),
    history: [],
};

/** A substantive, filler-free finalized transcript (no um/uh/ah and no discourse markers). */
const FLUENT = Array.from({ length: 6 }, () =>
    'The quarterly plan names three priorities and every owner agreed to report progress each Tuesday morning.',
).join(' ');
const FLUENT_WORDS = FLUENT.split(/\s+/).filter(Boolean).length;
const POINTS = ['Name the price', 'State the guarantee'];

const openMicAfter = (overrides: Partial<SessionOverhaulViewProps>) => render(
    <SessionOverhaulView
        {...base}
        showAnalyticsPrompt
        reviewTranscript={{ kind: 'available', text: FLUENT }}
        finalizedWordCount={FLUENT_WORDS}
        {...overrides}
    />,
);

const focusAfter = (overrides: Partial<SessionOverhaulViewProps>) => render(
    <SessionOverhaulView
        {...base}
        objectivePoints={POINTS}
        showAnalyticsPrompt
        reviewTranscript={{ kind: 'available', text: `I will name the price now. ${FLUENT}` }}
        finalizedWordCount={FLUENT_WORDS + 6}
        elapsedTime={84}
        {...overrides}
    />,
);

const NOT_VERIFIED = /(could ?n[o']?t|can ?n[o']?t|unable to|not able to) (be )?verif/i;

describe('#1472 — unverifiable filler evidence is never shown as a clean result', () => {
    it('U1 CASUALTY: Open Mic — a substantive fluent transcript with a zero snapshot does not claim "no filler words detected"', () => {
        openMicAfter({ finalizedFillerData: {} as unknown as FillerCounts });
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(screen.queryByText(/no filler words detected/i)).toBeNull();
        expect(screen.getByText(NOT_VERIFIED)).toBeInTheDocument();
    });

    it('U2 CASUALTY: Focus Points — a zero snapshot over a fluent transcript does not claim "clean delivery"', () => {
        focusAfter({ finalizedFillerData: {} as unknown as FillerCounts });
        expect(screen.getByTestId('focus-delivery-strip')).toBeInTheDocument();
        expect(screen.queryByText(/clean delivery/i)).toBeNull();
        expect(screen.getByTestId('focus-delivery-strip')).toHaveTextContent(NOT_VERIFIED);
    });

    it('U3 CASUALTY: Focus Points — an UNAVAILABLE filler snapshot is not turned into "no fillers — clean delivery"', () => {
        focusAfter({ finalizedFillerData: null });
        expect(screen.getByTestId('focus-delivery-strip')).toBeInTheDocument();
        expect(screen.queryByText(/clean delivery/i)).toBeNull();
        expect(screen.queryByText(/no fillers this run/i)).toBeNull();
    });

    it('U4 CASUALTY: the Focus Points delivery detail does not reintroduce "no filler words detected" for the same zero', () => {
        focusAfter({ finalizedFillerData: {} as unknown as FillerCounts });
        fireEvent.click(screen.getByTestId('focus-delivery-detail-toggle'));
        expect(screen.queryByText(/no filler words detected/i)).toBeNull();
    });

    it('CONTROL (#1417 v4 shape): a filler observed live but absent from the final transcript keeps its truthful count', () => {
        openMicAfter({ finalizedFillerData: { um: { count: 1 }, total: { count: 1 } } as unknown as FillerCounts });
        const words = screen.getAllByTestId('filler-breakdown-word').map((w) => w.getAttribute('data-word'));
        expect(words).toEqual(['um']);
        expect(screen.getByTestId('filler-breakdown-count')).toHaveTextContent('×1');
        expect(screen.getByTestId('after-stats')).toHaveTextContent('1 fillers');
    });

    it('CONTROL: observed nonzero counts in Focus Points keep the existing count line', () => {
        focusAfter({ finalizedFillerData: { uh: { count: 3 }, total: { count: 3 } } as unknown as FillerCounts });
        expect(screen.getByTestId('focus-delivery-strip')).toHaveTextContent(/3 fillers/);
        expect(screen.queryByText(/clean delivery/i)).toBeNull();
    });
});
