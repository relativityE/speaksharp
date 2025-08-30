import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import App from '../App';

// Mock the useAuth hook as it's used in App.jsx
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    session: null,
  }),
}));

// [JULES] Per user's instruction, mock the entire audioUtils module.
// The new implementation of audioUtils makes this simple mock possible.
vi.mock('../services/transcription/utils/audioUtils', () => ({
  createMicStream: vi.fn().mockImplementation(() =>
    Promise.resolve({
      sampleRate: 16000,
      onFrame: vi.fn(),
      offFrame: vi.fn(),
      stop: vi.fn(),
    })
  ),
}));


describe('App Component', () => {
  it('should render the main content area', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    // Check for the main element to confirm the app shell renders
    expect(screen.getByTestId('app-main')).not.toBeNull();
  });

});
