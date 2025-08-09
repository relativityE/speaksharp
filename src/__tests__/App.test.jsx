import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

// Mock the custom hook
vi.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn(),
}));

// Mock child components
vi.mock('../components/Header', () => ({
  Header: () => <header>Mock Header</header>,
}));
vi.mock('../components/RecordingStatus', () => ({
  RecordingStatus: ({ isRecording }) => <div>{isRecording ? 'Recording...' : 'Ready'}</div>,
}));
vi.mock('../components/FillerWordCounters', () => ({
  FillerWordCounters: () => <div>Filler Counters</div>,
}));
vi.mock('../components/AnalyticsDashboard', () => ({
  AnalyticsDashboard: () => <div>Session Report</div>,
}));
vi.mock('../components/ErrorDisplay', () => ({
  ErrorDisplay: ({ message }) => <div>{message}</div>,
}));
vi.mock('../components/SessionControl', () => ({
    SessionControl: ({ onToggle }) => <button onClick={onToggle}>Start/Stop Recording</button>,
}));
vi.mock('../components/InfoCard', () => ({
    InfoCard: ({ title, children }) => <div><h2>{title}</h2><p>{children}</p></div>,
}));


import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

describe('App Component', () => {
  let mockStartListening;
  let mockStopListening;
  let mockReset;

  const getMockedHookValue = (overrides = {}) => ({
    isListening: false,
    transcript: 'This is a test transcript with um, like, you know, filler words.',
    fillerCounts: { um: 1, like: 1, 'you know': 1 },
    error: null,
    isSupported: true,
    startListening: mockStartListening,
    stopListening: mockStopListening,
    reset: mockReset,
    ...overrides,
  });

  const renderWithRouter = (ui) => {
    return render(ui, { wrapper: MemoryRouter });
  };

  beforeEach(() => {
    mockStartListening = vi.fn();
    mockStopListening = vi.fn();
    mockReset = vi.fn();
    useSpeechRecognition.mockReturnValue(getMockedHookValue());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('renders initial state correctly', () => {
    renderWithRouter(<App />);
    expect(screen.getByText('Start/Stop Recording')).toBeInTheDocument();
  });

  test('runs trial, then shows analytics dashboard', () => {
    const { rerender } = renderWithRouter(<App />);
    
    // 1. Start Trial
    fireEvent.click(screen.getByText('Start/Stop Recording'));

    useSpeechRecognition.mockReturnValue(getMockedHookValue({ isListening: true }));
    rerender(<App />);

    expect(screen.getByText('Recording...')).toBeInTheDocument();

    // 2. End Trial by timer
    act(() => {
      vi.advanceTimersByTime(120 * 1000);
    });
    expect(screen.getByText('Trial Session Ended')).toBeInTheDocument();

    // 3. Dismiss modal and view results
    fireEvent.click(screen.getByText('Just show me the results'));

    // 4. Verify analytics are shown
    expect(screen.queryByText('Trial Session Ended')).not.toBeInTheDocument();
    expect(screen.getByText('Session Report')).toBeInTheDocument();
  });

  test('returns to welcome screen from analytics view', () => {
    const { rerender } = renderWithRouter(<App />);

    // Get to the analytics screen first
    fireEvent.click(screen.getByText('Start/Stop Recording'));
    useSpeechRecognition.mockReturnValue(getMockedHookValue({ isListening: true }));
    rerender(<App />);
    act(() => { vi.advanceTimersByTime(120 * 1000); });
    fireEvent.click(screen.getByText('Just show me the results'));

    // Ensure we are on the analytics screen
    expect(screen.getByText('Session Report')).toBeInTheDocument();

    // Click "Start a New Session"
    fireEvent.click(screen.getByText('Start a New Session'));

    // Verify we are back on the welcome screen
    expect(screen.getByText('Start/Stop Recording')).toBeInTheDocument();
    expect(screen.queryByText('Session Report')).not.toBeInTheDocument();
  });
});
