/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockSetPref = vi.fn();
let prefValue = false;

vi.mock('@/hooks/useUserFillerWords', () => ({
    useUserFillerWords: () => ({
        fullVocabularyObjects: [],
        isLoading: false,
        addWord: vi.fn(),
        removeWord: vi.fn(),
        isAdding: false,
        isRemoving: false,
        maxWords: 5,
        error: null,
    }),
}));

vi.mock('@/hooks/useDiscourseMarkerPref', () => ({
    useDiscourseMarkerPref: () => ({
        includeDiscourseMarkers: prefValue,
        setIncludeDiscourseMarkers: mockSetPref,
        isSaving: false,
        error: null,
    }),
}));

import { UserFillerWordsManager } from '../UserFillerWordsManager';

describe('UserFillerWordsManager — discourse-marker toggle (#1231)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prefValue = false;
    });

    it('renders the toggle unchecked when the pref is off', () => {
        render(<UserFillerWordsManager />);
        const toggle = screen.getByTestId('discourse-marker-toggle') as HTMLInputElement;
        expect(toggle).toBeInTheDocument();
        expect(toggle.checked).toBe(false);
    });

    it('renders the toggle checked when the pref is on', () => {
        prefValue = true;
        render(<UserFillerWordsManager />);
        const toggle = screen.getByTestId('discourse-marker-toggle') as HTMLInputElement;
        expect(toggle.checked).toBe(true);
    });

    it('toggling on calls the persist setter with true', () => {
        render(<UserFillerWordsManager />);
        fireEvent.click(screen.getByTestId('discourse-marker-toggle'));
        expect(mockSetPref).toHaveBeenCalledWith(true);
    });
});
