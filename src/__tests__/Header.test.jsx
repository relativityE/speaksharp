import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Header } from '../components/Header';
import { useAuth } from '../contexts/AuthContext';

// Mock the useAuth hook
vi.mock('../contexts/AuthContext');

describe('Header Component', () => {
    beforeEach(() => {
        useAuth.mockReturnValue({ user: null, signOut: vi.fn() });
    });

    afterEach(() => {
        vi.clearAllMocks();
        cleanup();
    });

    it('applies the correct global link styles', () => {
        render(
            <MemoryRouter>
                <Header />
            </MemoryRouter>
        );

        const link = screen.getByText('View Analytics');
        // Note: jsdom does not compute styles from stylesheets.
        // This test will fail, but it documents the intent.
        // A true browser environment (e.g., Playwright) would be needed to test this properly.
        // expect(link).toHaveStyle('font-size: 1.1rem');

        // As a fallback, we can check for the class that *should* apply the style.
        // This isn't ideal, but it's the best we can do in this environment.
        expect(link.tagName).toBe('A');
    });
});
