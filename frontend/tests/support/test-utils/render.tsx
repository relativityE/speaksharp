import React, { ReactElement, ReactNode } from 'react';
import { render, renderHook, RenderOptions } from '@testing-library/react';
import { Location } from 'react-router-dom';
import { AuthContextType } from '@/contexts/AuthProvider';
import { AllTheProviders } from './components';

import { UserProfile } from '@/types/user';

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  authMock?: Partial<AuthContextType>;
  profileMock?: Partial<UserProfile>;
  route?: string | Partial<Location>;
  path?: string;
}

export const renderWithAllProviders = (ui: ReactElement, options: CustomRenderOptions = {}) => {
  const { authMock, profileMock, route, path, ...renderOptions } = options;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AllTheProviders authMock={authMock} profileMock={profileMock} route={route} path={path}>
      {children}
    </AllTheProviders>
  );
  return render(ui, { wrapper: Wrapper, ...renderOptions });
};

export const renderHookWithProviders = <TProps, TResult>(
  hook: (props: TProps) => TResult,
  options: CustomRenderOptions = {}
) => {
  const { authMock, profileMock, route, path, ...renderOptions } = options;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AllTheProviders authMock={authMock} profileMock={profileMock} route={route} path={path}>
      {children}
    </AllTheProviders>
  );
  return renderHook(hook, { wrapper: Wrapper, ...renderOptions });
};

