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
