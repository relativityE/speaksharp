import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

vi.mock('../pages/HomePage', () => ({
  HomePage: () => <div>Home Page</div>,
}));
vi.mock('../pages/SessionPage', () => ({
    SessionPage: () => <div>Session Page</div>,
}));
vi.mock('../pages/AnalyticsPage', () => ({
    AnalyticsPage: () => <div>Analytics Page</div>,
}));

describe('App Routing', () => {
  it('renders the home page for the root route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByText('Home Page')).toBeInTheDocument();
  });

  it('renders the session page for the /session route', () => {
    render(
      <MemoryRouter initialEntries={['/session']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByText('Session Page')).toBeInTheDocument();
  });

  it('renders the analytics page for the /analytics route', () => {
    render(
      <MemoryRouter initialEntries={['/analytics']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByText('Analytics Page')).toBeInTheDocument();
  });
});
