import React from 'react';
import { render, screen } from '@testing-library/react';
import { FillerWordTable } from '../components/analytics/FillerWordTable';

const mockTrendData = {
    'um': [
        { count: 5, severity: 'yellow', tooltip: '50% increase' },
        { count: 2, severity: 'green', tooltip: '50% decrease' },
    ],
    'like': [
        { count: 12, severity: 'red', tooltip: '20% increase' },
        { count: 10, severity: 'red', tooltip: 'No change' },
    ],
};

describe('FillerWordTable', () => {
    it('renders correctly with trend data', () => {
        render(<FillerWordTable trendData={mockTrendData} />);

        // Check for headers
        expect(screen.getByText('Filler Word')).toBeInTheDocument();
        expect(screen.getByText('Session 1')).toBeInTheDocument();
        expect(screen.getByText('Session 2')).toBeInTheDocument();

        // Check for filler word rows
        expect(screen.getByText('um')).toBeInTheDocument();
        expect(screen.getByText('like')).toBeInTheDocument();

        // Check for cell counts
        expect(screen.getByText('5')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByText('10')).toBeInTheDocument();
    });

    it('applies correct severity classes and tooltips', () => {
        render(<FillerWordTable trendData={mockTrendData} />);

        // Get all table cells to avoid ambiguity with queries
        const cells = screen.getAllByRole('cell');

        // Find specific cells by their content for robust testing
        const umCell1 = cells.find(cell => cell.textContent === '5');
        const umCell2 = cells.find(cell => cell.textContent === '2');
        const likeCell1 = cells.find(cell => cell.textContent === '12');
        const likeCell2 = cells.find(cell => cell.textContent === '10');

        // Check for 'um' row
        expect(umCell1).toHaveClass('bg-yellow-200');
        expect(umCell1).toHaveAttribute('title', '50% increase');
        expect(umCell2).toHaveClass('bg-green-200');
        expect(umCell2).toHaveAttribute('title', '50% decrease');

        // Check for 'like' row
        expect(likeCell1).toHaveClass('bg-red-200');
        expect(likeCell1).toHaveAttribute('title', '20% increase');
        expect(likeCell2).toHaveClass('bg-red-200');
        expect(likeCell2).toHaveAttribute('title', 'No change');
    });

    it('renders empty state when no data is provided', () => {
        render(<FillerWordTable trendData={{}} />);
        expect(screen.getByText('Not enough session data to display trends.')).toBeInTheDocument();
    });

    it('renders empty state when trendData is null', () => {
        render(<FillerWordTable trendData={null} />);
        expect(screen.getByText('Not enough session data to display trends.')).toBeInTheDocument();
    });
});
