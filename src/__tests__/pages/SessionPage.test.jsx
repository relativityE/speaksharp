import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { SessionPage } from '../../pages/SessionPage';

// Mock the custom hook
vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn(),
}));

vi.mock('../../components/SessionControl', () => ({
    SessionControl: ({ onToggle }) => <button onClick={onToggle}>Stop Session</button>,
}));

import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

describe('SessionPage', () => {
  let mockStartListening;
  let mockStopListening;
  let mockReset;

  beforeEach(() => {
    mockStartListening = vi.fn();
    mockStopListening = vi.fn();
    mockReset = vi.fn();
    useSpeechRecognition.mockReturnValue({
      isListening: true,
      transcript: '',
      fillerCounts: {},
      startListening: mockStartListening,
      stopListening: mockStopListening,
      reset: mockReset,
    });
  });

  it('starts listening on mount', () => {
    render(
      <MemoryRouter>
        <SessionPage />
      </MemoryRouter>
    );
    expect(mockStartListening).toHaveBeenCalledTimes(1);
  });

  it('stops listening and navigates to analytics when stop button is clicked', () => {
    const Analytics = () => <div>Analytics Page</div>;
    render(
      <MemoryRouter initialEntries={['/session']}>
        <Routes>
            <Route path="/session" element={<SessionPage />} />
            <Route path="/analytics" element={<Analytics />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('Stop Session'));
    expect(mockStopListening).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Analytics Page')).toBeInTheDocument();
  });
});
