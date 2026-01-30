import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DesignSystemPage } from '../DesignSystemPage';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';

const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
};

describe('DesignSystemPage', () => {
    it('renders correctly', () => {
        renderWithRouter(<DesignSystemPage />);
        expect(screen.getByText('Design System Showcase')).toBeInTheDocument();
        expect(screen.getByText(/A visual reference/i)).toBeInTheDocument();
    });

    it('renders all component sections', () => {
        renderWithRouter(<DesignSystemPage />);
        expect(screen.getByText('Typography')).toBeInTheDocument();
        expect(screen.getByText('Buttons')).toBeInTheDocument();
        expect(screen.getByText('Inputs')).toBeInTheDocument();
        expect(screen.getByText('Badges')).toBeInTheDocument();
        expect(screen.getByText('Cards')).toBeInTheDocument();
        expect(screen.getByText('Loading States')).toBeInTheDocument();
    });

    it('renders component examples', () => {
        renderWithRouter(<DesignSystemPage />);
        expect(screen.getByRole('button', { name: /primary/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /destructive/i })).toBeInTheDocument();
    });
});
