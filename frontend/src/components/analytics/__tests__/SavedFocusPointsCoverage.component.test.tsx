import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { SavedFocusPointsCoverage as Coverage } from '@/services/objective/savedFocusPointsCoverage';

const load = vi.fn<(id: string) => Promise<Coverage>>();
vi.mock('@/services/objective/savedFocusPointsCoverage', () => ({ loadSavedFocusPointsCoverage: (id: string) => load(id) }));

const { SavedFocusPointsCoverage } = await import('../SavedFocusPointsCoverage');

beforeEach(() => load.mockReset());

describe('SavedFocusPointsCoverage (Analytics session detail)', () => {
    it('shows every saved point with its verdict in words and the detected total', async () => {
        load.mockResolvedValue({
            kind: 'coverage', detected: 2, total: 4,
            points: [
                { label: 'Updates get lost', status: 'detected', detectedAtSeconds: 5 },
                { label: 'Shared board', status: 'detected', detectedAtSeconds: 74 },
                { label: 'Pilot', status: 'not_detected', detectedAtSeconds: null },
                { label: 'Measure', status: 'unavailable', detectedAtSeconds: null },
            ],
        });
        render(<SavedFocusPointsCoverage sessionId="s1" />);
        await waitFor(() => expect(screen.getByTestId('saved-focus-points')).toBeInTheDocument());
        expect(load).toHaveBeenCalledWith('s1');
        expect(screen.getByTestId('saved-coverage-total')).toHaveTextContent('2/4 points detected');
        expect(screen.getByTestId('focus-point-0')).toHaveAttribute('data-status', 'covered');
        expect(screen.getByTestId('focus-point-0')).toHaveTextContent('Detected at 0:05');
        expect(screen.getByTestId('focus-point-1')).toHaveTextContent('Detected at 1:14');
        expect(screen.getByTestId('focus-point-2')).toHaveAttribute('data-status', 'missing');
        expect(screen.getByTestId('focus-point-2')).toHaveTextContent('Not detected');
        expect(screen.getByTestId('focus-point-2')).toHaveTextContent('You may have covered it in different words.');
        expect(screen.getByTestId('focus-point-3')).toHaveAttribute('data-status', 'pending');
        expect(screen.getByTestId('focus-point-3')).toHaveTextContent('Not evaluated');
        // No point is shown as detected unless it was saved as detected.
        expect(screen.getAllByText(/^Detected/)).toHaveLength(2);
    });

    it('renders nothing for an Open Mic session', async () => {
        load.mockResolvedValue({ kind: 'none' });
        const { container } = render(<SavedFocusPointsCoverage sessionId="s2" />);
        await waitFor(() => expect(load).toHaveBeenCalledWith('s2'));
        expect(container).toBeEmptyDOMElement();
    });

    it('says the result could not be loaded instead of showing nothing', async () => {
        load.mockResolvedValue({ kind: 'error' });
        render(<SavedFocusPointsCoverage sessionId="s3" />);
        await waitFor(() => expect(screen.getByTestId('saved-focus-points-error')).toHaveTextContent('couldn’t be loaded'));
    });
});
