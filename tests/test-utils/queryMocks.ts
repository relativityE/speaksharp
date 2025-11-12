// tests/test-utils/queryMocks.ts
import type { QueryObserverSuccessResult } from '@tanstack/react-query';
/**
 * Build a minimal QueryObserverSuccessResult for tests.
 * We intentionally return a minimal object and cast to the full type to satisfy TS.
 */
export function makeQuerySuccess<T>(data: T | null): QueryObserverSuccessResult<T, Error> {
  // Provide commonly used properties; tests can extend or override via object spread.
  const base = {
    data,
    status: 'success' as const,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: async () => ({ data, error: null }),
    remove: () => undefined, // some code uses .remove; safe no-op for tests
    // note: add additional no-op methods if your code under test calls them
  } as unknown;

  return base as QueryObserverSuccessResult<T, Error>;
}
