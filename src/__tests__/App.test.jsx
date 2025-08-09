import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import App from '../App';

// Mock the custom hook
vi.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn(),
}));

// Mock child components for named exports
vi.mock('../components/SessionControl', () => ({
  SessionControl: ({ onStart, onStop, onEnd, isListening, sessionActive }) => (
    <div>
      <button onClick={onStart}>Start Session</button>
      <button onClick={() => isListening ? onStop() : onStart()}>{isListening ? 'Stop Recording' : 'Start Recording'}</button>
      <button onClick={onEnd}>End Session</button>
      <span>{sessionActive ? 'Session Active' : 'Session Inactive'}</span>
    </div>
  ),
}));
vi.mock('../components/RecordingStatus', () => ({
    RecordingStatus: ({ isListening }) => <div>{isListening ? 'Listening' : 'Not Listening'}</div>
}));
vi.mock('../components/FillerWordCounters', () => ({
    FillerWordCounters: () => <div>Filler Word Counters</div>
}));
vi.mock('../components/AnalyticsDashboard', () => ({
  AnalyticsDashboard: () => <div>Analytics Dashboard</div>,
}));
vi.mock('../components/ErrorDisplay', () => ({
    ErrorDisplay: ({ message }) => <div>{message}</div>
}));

import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

describe('App Component', () => {
  let mockStartListening;
  let mockStopListening;
  let mockReset;

  // Helper to create a complete mock object
  const getMockedHookValue = (overrides = {}) => ({
    isListening: false,
    transcript: '',
    fillerCounts: {},
    error: null,
    isSupported: true,
    startListening: mockStartListening,
    stopListening: mockStopListening,
    reset: mockReset,
    ...overrides,
  });

  beforeEach(() => {
    mockStartListening = vi.fn();
    mockStopListening = vi.fn();
    mockReset = vi.fn();
    // Set the default mock for all tests
    useSpeechRecognition.mockReturnValue(getMockedHookValue());
    vi.clearAllMocks();
  });

  test('renders initial state correctly', () => {
    render(<App />);
    expect(screen.getByText('SayLess')).toBeInTheDocument();
    expect(screen.getByText('Start Session')).toBeInTheDocument();
    expect(screen.getByText('Click "Start Session" to begin recording.')).toBeInTheDocument();
  });

  test('starts a session when "Start Session" is clicked', () => {
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByText('Start Session'));

    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(mockStartListening).toHaveBeenCalledTimes(1);
    
    // Rerender with the hook returning "listening" state
    useSpeechRecognition.mockReturnValue(getMockedHookValue({ isListening: true }));
    rerender(<App />);
    expect(screen.getByText('Listening')).toBeInTheDocument();
  });

  test('stops and resumes recording', () => {
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByText('Start Session'));
    expect(mockStartListening).toHaveBeenCalledTimes(1);

    // After starting, we are listening
    useSpeechRecognition.mockReturnValue(getMockedHookValue({ isListening: true }));
    rerender(<App />);
    fireEvent.click(screen.getByText('Stop Recording'));
    expect(mockStopListening).toHaveBeenCalledTimes(1);

    // After stopping, we are not listening
    useSpeechRecognition.mockReturnValue(getMockedHookValue({ isListening: false }));
    rerender(<App />);
    fireEvent.click(screen.getByText('Start Recording'));
    expect(mockStartListening).toHaveBeenCalledTimes(2);
  });

  test('ends a session when "End Session" is clicked', () => {
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByText('Start Session'));

    // Simulate active session state
    useSpeechRecognition.mockReturnValue(getMockedHookValue({ isListening: true, transcript: 'Final transcript.' }));
    rerender(<App />);

    fireEvent.click(screen.getByText('End Session'));
    expect(mockStopListening).toHaveBeenCalledTimes(1);

    // After session ends, analytics should be visible
    useSpeechRecognition.mockReturnValue(getMockedHookValue({ transcript: 'Final transcript.' }));
    rerender(<App/>);

    expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
  });

  test('displays an error message', () => {
    useSpeechRecognition.mockReturnValue(getMockedHookValue({ error: 'Test error message' }));
    render(<App />);
    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  test('handles custom word addition', () => {
    render(<App />);
    const input = screen.getByPlaceholderText('Add custom filler word');
    const button = screen.getByText('Add');

    fireEvent.change(input, { target: { value: 'testword' } });
    fireEvent.click(button);

    expect(useSpeechRecognition).toHaveBeenCalledWith({ customWords: ['testword'] });
  });

  test('shows transcript and filler counts during session', () => {
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByText('Start Session'));

    useSpeechRecognition.mockReturnValue(getMockedHookValue({ isListening: true, transcript: 'um, this is a test' }));
    rerender(<App />);

    expect(screen.getByText('Filler Word Counters')).toBeInTheDocument();
  });
});
