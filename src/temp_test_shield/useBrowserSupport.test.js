import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBrowserSupport } from '../useBrowserSupport';

// This test file relies on the global mocks for browser APIs
// being present from the test setup file (src/test/setup.tsx).

describe('useBrowserSupport', () => {
  it('should return isSupported = true when all features are available', () => {
    const { result } = renderHook(() => useBrowserSupport());
    expect(result.current.isSupported).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
