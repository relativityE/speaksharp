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
  RecordingStatus: ({ sessionActive }) => <div>{sessionActive ? 'Recording...' : 'Ready'}</div>,
}));
vi.mock('../components/FillerWordCounters', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    // Render the custom words to test the add functionality
    FillerWordCounters: ({ customWords, onAddCustomWord, setCustomWord, customWord }) => (
      <div>
        <button onClick={() => onAddCustomWord('new word')}>Add Word</button>
        <input value={customWord} onChange={e => setCustomWord(e.target.value)} />
        <div>
          {customWords.map(word => <span key={word}>{word}</span>)}
        </div>
      </div>
    ),
  }
});
vi.mock('../components/AnalyticsDashboard', () => ({
  AnalyticsDashboard: () => <div>Session Report</div>,
}));
vi.mock('../components/ErrorDisplay', () => ({
  ErrorDisplay: ({ message }) => <div>{message}</div>,
}));
vi.mock('../components/Hero', () => ({
  Hero: ({ onStartTrial }) => <button onClick={onStartTrial}>Start Recording</button>,
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

  const renderWithRouter = (ui, { route = '/' } = {}) => {
    window.history.pushState({}, 'Test page', route);
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
    expect(screen.getByText('Start Recording')).toBeInTheDocument();
  });

  test('runs trial, then shows analytics dashboard', () => {
    renderWithRouter(<App />);
    
    // 1. Start Trial
    fireEvent.click(screen.getByText('Start Recording'));

    // App should navigate to /session, where these components are rendered
    expect(screen.getByText('Recording...')).toBeInTheDocument();

    // 2. End Trial
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
    renderWithRouter(<App />);

    // Get to the analytics screen first
    fireEvent.click(screen.getByText('Start Recording'));
    act(() => { vi.advanceTimersByTime(120 * 1000); });
    fireEvent.click(screen.getByText('Just show me the results'));

    // Ensure we are on the analytics screen
    expect(screen.getByText('Session Report')).toBeInTheDocument();

    // Click "Start a New Session"
    fireEvent.click(screen.getByText('Start a New Session'));

    // Verify we are back on the welcome screen
    expect(screen.getByText('Start Recording')).toBeInTheDocument();
    expect(screen.queryByText('Session Report')).not.toBeInTheDocument();
  });

  test('adds a custom word and displays it', () => {
    renderWithRouter(<App />);

    // Navigate to session page
    fireEvent.click(screen.getByText('Start Recording'));

    // Check that the custom word is not there initially
    expect(screen.queryByText('new word')).not.toBeInTheDocument();

    // Simulate adding a new word from our mock component
    fireEvent.click(screen.getByText('Add Word'));

    // Check that the new word is now displayed because the state in App.jsx has been updated
    expect(screen.getByText('new word')).toBeInTheDocument();
  });
});
