import { render, screen } from '../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { DesignSystemPage } from '../DesignSystemPage';
import React from 'react';

// Helper removed - using custom render from test-utils

describe('DesignSystemPage', () => {
    it('renders correctly', () => {
        render(<DesignSystemPage />);
        expect(screen.getByText('Design System Showcase')).toBeInTheDocument();
        expect(screen.getByText(/A visual reference/i)).toBeInTheDocument();
    });

    it('renders all component sections', () => {
        render(<DesignSystemPage />);
        expect(screen.getByText('Typography')).toBeInTheDocument();
        expect(screen.getByText('Buttons')).toBeInTheDocument();
        expect(screen.getByText('Inputs')).toBeInTheDocument();
        expect(screen.getByText('Badges')).toBeInTheDocument();
        expect(screen.getByText('Cards')).toBeInTheDocument();
        expect(screen.getByText('Loading States')).toBeInTheDocument();
    });

    it('renders component examples', () => {
        render(<DesignSystemPage />);
        expect(screen.getByRole('button', { name: /primary/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /destructive/i })).toBeInTheDocument();
    });
});
