/**
 * Default-off meaning matcher — the rail's detection note names the engine that produced the saved verdict.
 * Keyword (absent or 'keyword') stays word-for-word today's note; 'nli' says meaning; a fallback keeps the
 * keyword note and labels the verdict keyword-based.
 */
import { render, screen } from '../../../../tests/support/test-utils';
import { describe, expect, it } from 'vitest';
import { FocusPointsRail, KEYWORD_DETECTION_NOTE, MEANING_DETECTION_NOTE, MEANING_FALLBACK_NOTE } from '../FocusPointsRail';
import type { FocusCoverageRow } from '@/utils/focusCoverage';

const rows: FocusCoverageRow[] = [
    { label: 'a', status: 'covered', covered: true, coveredAtSec: null, quote: null },
    { label: 'b', status: 'missing', covered: false, coveredAtSec: null, quote: null },
];
const NOTE = 'focus-points-detection-note';
const FALLBACK = 'focus-points-detection-fallback';
const TODAY = 'We look for your point’s words in what you said. If you covered it differently, we may not spot it.';

describe('FocusPointsRail — detection note by engine', () => {
    it('no engine reported (flag off): today\'s keyword note, unchanged, with no engine attribute', () => {
        render(<FocusPointsRail rows={rows} sessionState="after" />);
        const note = screen.getByTestId(NOTE);
        expect(note.textContent).toBe(TODAY);
        expect(KEYWORD_DETECTION_NOTE).toBe(TODAY);
        expect(note).not.toHaveAttribute('data-engine');
        expect(screen.queryByTestId(FALLBACK)).not.toBeInTheDocument();
    });

    it('keyword engine without fallback: the same keyword note, no fallback label', () => {
        render(<FocusPointsRail rows={rows} sessionState="after" detection={{ engine: 'keyword', fallback: false }} />);
        expect(screen.getByTestId(NOTE).textContent).toBe(TODAY);
        expect(screen.queryByTestId(FALLBACK)).not.toBeInTheDocument();
    });

    it('nli engine: the meaning-based note replaces the keyword one', () => {
        render(<FocusPointsRail rows={rows} sessionState="after" detection={{ engine: 'nli', fallback: false }} />);
        const note = screen.getByTestId(NOTE);
        expect(note.textContent).toBe(MEANING_DETECTION_NOTE);
        expect(note).toHaveAttribute('data-engine', 'nli');
        expect(note.textContent).not.toContain('words in what you said');
        expect(screen.queryByTestId(FALLBACK)).not.toBeInTheDocument();
    });

    it('fallback (flag on, model unavailable): keyword note stays and the verdict is labelled keyword-based', () => {
        render(<FocusPointsRail rows={rows} sessionState="after" detection={{ engine: 'keyword', fallback: true }} />);
        expect(screen.getByTestId(NOTE).textContent).toBe(TODAY);
        expect(screen.getByTestId(NOTE)).toHaveAttribute('data-engine', 'keyword');
        expect(screen.getByTestId(FALLBACK).textContent).toBe(MEANING_FALLBACK_NOTE);
        expect(MEANING_FALLBACK_NOTE).toMatch(/keyword-based/);
    });

    it('no note of any kind before a verdict exists', () => {
        render(<FocusPointsRail rows={rows} sessionState="after" coveragePending detection={{ engine: 'nli', fallback: false }} />);
        expect(screen.queryByTestId(NOTE)).not.toBeInTheDocument();
        expect(screen.queryByTestId(FALLBACK)).not.toBeInTheDocument();
    });
});
