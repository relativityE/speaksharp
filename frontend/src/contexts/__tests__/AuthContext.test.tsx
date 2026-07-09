/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { useContext } from 'react';
import { renderHook } from '@testing-library/react';
import { AuthContext, type AuthContextType } from '../AuthContext';

describe('AuthContext', () => {
  it('defaults to undefined when consumed without a Provider', () => {
    const { result } = renderHook(() => useContext(AuthContext));
    expect(result.current).toBeUndefined();
  });

  it('exposes the supplied auth value through its Provider', () => {
    const value: AuthContextType = {
      session: null,
      user: null,
      profile: null,
      loading: false,
      signOut: async () => ({ error: null }),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    );
    const { result } = renderHook(() => useContext(AuthContext), { wrapper });
    expect(result.current).toBe(value);
    expect(result.current?.loading).toBe(false);
  });
});
