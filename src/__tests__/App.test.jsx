import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import App from '../App';
import { useAuth } from '../contexts/AuthContext';

vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(),
}));

// Mock the useAuth hook
vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// Mock child components to isolate the App component's routing logic
vi.mock('../pages/MainPage', () => ({ MainPage: () => <div>Main Page</div> }));
vi.mock('../pages/SessionPage', () => ({ SessionPage: () => <div>Session Page</div> }));
vi.mock('../pages/AnalyticsPage', () => ({ AnalyticsPage: () => <div>Analytics Page</div> }));
vi.mock('../pages/AuthPage', () => ({ default: () => <div>Auth Page</div> }));
vi.mock('../components/Header', () => ({ Header: () => <header>Header</header> }));

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
        vi.clearAllMocks();
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
