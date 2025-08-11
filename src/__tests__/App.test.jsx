import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
vi.mock('../pages/AuthPage', () => ({ default: () => <div>Auth Page</div> })); // AuthPage has a default export
vi.mock('../components/Header', () => ({ Header: () => <header>Header</header> }));


const renderWithRouter = (ui, { route = '/', authState = { user: null } } = {}) => {
    useAuth.mockReturnValue(authState);
    return render(
        <MemoryRouter initialEntries={[route]}>
            <App />
        </MemoryRouter>
    );
};


describe('App Routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the main page for the root route when authenticated', () => {
        renderWithRouter(<App />, { route: '/', authState: { user: { id: '123' } } });
        expect(screen.getByText('Main Page')).toBeInTheDocument();
        expect(screen.getByText('Header')).toBeInTheDocument();
    });

    it('renders the analytics page for the /analytics route when authenticated', () => {
        renderWithRouter(<App />, { route: '/analytics', authState: { user: { id: '123' } } });
        expect(screen.getByText('Analytics Page')).toBeInTheDocument();
    });

    it('redirects to the auth page when not authenticated', () => {
        renderWithRouter(<App />, { route: '/', authState: { user: null } });
        expect(screen.getByText('Auth Page')).toBeInTheDocument();
        expect(screen.queryByText('Main Page')).not.toBeInTheDocument();
    });
});
