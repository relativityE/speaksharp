import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import App from '../App';

// Mock the useAuth hook as it's used in App.jsx
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user', email: 'test@example.com' },
    session: { access_token: 'test-token' },
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

vi.mock('../components/Header', () => ({
  Header: () => <header>Mock Header</header>,
}));

vi.mock('../pages/SessionPage', () => ({
  SessionPage: () => <div>Session Page</div>,
}));
vi.mock('../pages/AnalyticsPage', () => ({
  AnalyticsPage: () => <div>Analytics Page</div>,
}));
vi.mock('../pages/AuthPage', () => ({
  default: () => <div>Auth Page</div>,
}));

vi.mock('../hooks/useBrowserSupport', () => ({
    useBrowserSupport: () => ({
        isSupported: true,
        error: null,
    }),
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

  it('should render the main page content as a smoke test', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    // Check for a key element from the MainPage to ensure it renders
    expect(screen.getByText('Start For Free')).not.toBeNull();
  });
});
