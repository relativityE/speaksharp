import { AuthProvider } from '../contexts/AuthContext';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// This test helper is used to wrap components under test with necessary providers.
// The key part is `enableSubscription={false}`, which prevents the real Supabase
// auth listener from being created, solving the memory leak in the test environment.
export function renderWithProviders(ui, { session = null, ...renderOptions } = {}) {
  const Wrapper = ({ children }) => (
    <MemoryRouter>
      <AuthProvider enableSubscription={false} initialSession={session}>
        {children}
      </AuthProvider>
    </MemoryRouter>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
