import React, { ReactElement, ReactNode } from 'react';
import { render, renderHook, RenderOptions, RenderHookOptions } from '@testing-library/react';
import { Location } from 'react-router-dom';
import { AuthContextType } from '@/contexts/AuthProvider';
import { AllTheProviders } from './components';

import { UserProfile } from '@/types/user';

interface CustomRenderOptions extends RenderOptions {
  authMock?: Partial<AuthContextType>;
  profileMock?: Partial<UserProfile>;
  route?: string | Partial<Location>;
  path?: string;
}

interface CustomRenderHookOptions<Props> extends RenderHookOptions<Props> {
  authMock?: Partial<AuthContextType>;
  profileMock?: Partial<UserProfile>;
  route?: string | Partial<Location>;
  path?: string;
}

export const renderWithAllProviders = (ui: ReactElement, options: CustomRenderOptions = {}) => {
  const { authMock, profileMock, route, path, wrapper: InnerWrapper, ...renderOptions } = options;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AllTheProviders authMock={authMock} profileMock={profileMock} route={route} path={path}>
      {InnerWrapper ? <InnerWrapper>{children}</InnerWrapper> : children}
    </AllTheProviders>
  );
  return render(ui, { wrapper: Wrapper, ...renderOptions });
};

export const renderHookWithProviders = <Result, Props>(
  render: (initialProps: Props) => Result,
  options: CustomRenderHookOptions<Props> = {}
) => {
  const { authMock, profileMock, route, path, wrapper: InnerWrapper, ...renderOptions } = options;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AllTheProviders authMock={authMock} profileMock={profileMock} route={route} path={path}>
      {InnerWrapper ? <InnerWrapper>{children}</InnerWrapper> : children}
    </AllTheProviders>
  );
  return renderHook(render, { wrapper: Wrapper, ...renderOptions });
};

