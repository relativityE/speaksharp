// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusNotificationBar } from '../StatusNotificationBar';
import { useSessionStore } from '../../../stores/useSessionStore';

vi.mock('../../../stores/useSessionStore', () => ({
    useSessionStore: vi.fn(),
}));

describe('StatusNotificationBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('displays the padlock icon (Vault Mode) when active engine is private', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'private',
                modelLoadingProgress: null,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'recording', message: 'Recording' }} />);

        // Check for the padlock title or icon
        const padlock = screen.getByTitle(/Vault Mode: On-Device Processing/i);
        expect(padlock).toBeDefined();
    });

    it('does NOT display the padlock icon when active engine is NOT private', () => {
        vi.mocked(useSessionStore).mockImplementation((selector: unknown) => {
            const state = {
                activeEngine: 'native',
                modelLoadingProgress: null,
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        render(<StatusNotificationBar status={{ type: 'recording', message: 'Recording' }} />);

        expect(screen.queryByTitle(/Vault Mode: On-Device Processing/i)).toBeNull();
    });
});
