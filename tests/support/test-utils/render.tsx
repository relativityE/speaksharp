import React, { ReactElement, ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { Location } from 'react-router-dom';
import { AuthContextType } from '@/contexts/AuthContext';
import { AllTheProviders } from './components';

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  authMock?: Partial<AuthContextType>;
  route?: string | Partial<Location>;
  path?: string;
}

export const renderWithAllProviders = (ui: ReactElement, options: CustomRenderOptions = {}) => {
  const { authMock, route, path, ...renderOptions } = options;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AllTheProviders authMock={authMock} route={route} path={path}>
      {children}
    </AllTheProviders>
  );
  return render(ui, { wrapper: Wrapper, ...renderOptions });
};
