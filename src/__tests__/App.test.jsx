import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import App from '../App';
import { useAuth } from '../contexts/AuthContext';

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

const renderWithRouter = (route, user = null) => {
    useAuth.mockReturnValue({ user: user, loading: false });
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

    it('renders the session page for the /session route when authenticated', () => {
        renderWithRouter('/session', { id: '123', email: 'test@example.com' });
        expect(screen.getByText('Session Page')).toBeInTheDocument();
    });

    it('redirects to auth page for /session route when not authenticated', () => {
        renderWithRouter('/session');
        expect(screen.getByText('Auth Page')).toBeInTheDocument();
        expect(screen.queryByText('Session Page')).not.toBeInTheDocument();
    });

    it('renders the analytics page for the /analytics route when authenticated', () => {
        renderWithRouter('/analytics', { id: '123', email: 'test@example.com' });
        expect(screen.getByText('Analytics Page')).toBeInTheDocument();
    });

    it('redirects to auth page for /analytics route when not authenticated', () => {
        renderWithRouter('/analytics');
        expect(screen.getByText('Auth Page')).toBeInTheDocument();
        expect(screen.queryByText('Analytics Page')).not.toBeInTheDocument();
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
