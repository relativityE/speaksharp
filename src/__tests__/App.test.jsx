import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import App from '../App';
import { useAuth } from '../contexts/AuthContext';

jest.mock('@xenova/transformers', () => ({
  pipeline: jest.fn(),
}));

// Mock the useAuth hook
jest.mock('../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// Mock child components to isolate the App component's routing logic
jest.mock('../pages/MainPage', () => ({
  __esModule: true,
  MainPage: () => <div>Main Page</div>
}));
jest.mock('../pages/SessionPage', () => ({
  __esModule: true,
  SessionPage: () => <div>Session Page</div>
}));
jest.mock('../pages/AnalyticsPage', () => ({
  __esModule: true,
  AnalyticsPage: () => <div>Analytics Page</div>
}));
jest.mock('../pages/AuthPage', () => ({
  __esModule: true,
  default: () => <div>Auth Page</div>
}));
jest.mock('../components/Header', () => ({
  __esModule: true,
  Header: () => <header>Header</header>
}));

const renderWithRouter = (route) => {
    // Set a default mock return value for useAuth
    useAuth.mockReturnValue({ user: null, session: null });
    return render(
        <MemoryRouter initialEntries={[route]}>
            <App />
        </MemoryRouter>
    );
};

describe('App Routing', () => {
    afterEach(() => {
        jest.clearAllMocks();
        cleanup();
    });

    it('renders the main page for the root route', () => {
        renderWithRouter('/');
        expect(screen.getByText('Main Page')).toBeInTheDocument();
    });

    it('renders the session page for the /session route', () => {
        renderWithRouter('/session');
        expect(screen.getByText('Session Page')).toBeInTheDocument();
    });

    it('renders the analytics page for the /analytics route', () => {
        renderWithRouter('/analytics');
        expect(screen.getByText('Analytics Page')).toBeInTheDocument();
    });

    it('renders the auth page for the /auth route', () => {
        renderWithRouter('/auth');
        expect(screen.getByText('Auth Page')).toBeInTheDocument();
    });

    it('always renders the header', () => {
        renderWithRouter('/');
        expect(screen.getByText('Header')).toBeInTheDocument();
    });
});
