import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

vi.mock('../pages/MainPage', () => ({
  MainPage: () => <div>Main Page</div>,
}));
vi.mock('../components/AnalyticsDashboard', () => ({
    AnalyticsDashboard: () => <div>Analytics Page</div>,
}));


describe('App Routing', () => {
  it('renders the main page for the root route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByText('Main Page')).toBeInTheDocument();
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
