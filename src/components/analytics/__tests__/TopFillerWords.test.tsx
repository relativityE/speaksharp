import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TopFillerWords } from '../TopFillerWords';
import { useSession } from '@/contexts/SessionContext';

// Mock the context hook
vi.mock('@/contexts/SessionContext', () => ({
  useSession: vi.fn(),
}));

// Cast the mock to be able to use .mockReturnValue
const mockedUseSession = useSession as vi.Mock;

describe('TopFillerWords', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockedUseSession.mockClear();
  });

  it('should render the top 2 filler words in correct order', () => {
    mockedUseSession.mockReturnValue({
      sessionHistory: [
        { filler_words: { 'like': { count: 5 }, 'so': { count: 10 } } },
        { filler_words: { 'um': { count: 3 }, 'like': { count: 2 } } },
      ],
      addSession: vi.fn(),
      loading: false,
      error: null,
    });

    render(<TopFillerWords />);

    // Total counts: so: 10, like: 7, um: 3. Top 2 are 'so' and 'like'.
    const listItems = screen.getAllByRole('listitem');
    expect(listItems[0].textContent).toBe('1. so');
    expect(listItems[1].textContent).toBe('2. like');
  });

  it('should render a message when there are no filler words', () => {
    mockedUseSession.mockReturnValue({
      sessionHistory: [],
      addSession: vi.fn(),
      loading: false,
      error: null,
    });

    render(<TopFillerWords />);

    expect(screen.getByText('No filler words detected in recent sessions.')).toBeInTheDocument();
  });

  it('should render only one word if only one is present', () => {
    mockedUseSession.mockReturnValue({
      sessionHistory: [
        { filler_words: { 'um': { count: 3 } } },
      ],
      addSession: vi.fn(),
      loading: false,
      error: null,
    });

    render(<TopFillerWords />);

    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(1);
    expect(listItems[0].textContent).toBe('1. um');
  });
});