import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

// Keep the real isChunkLoadError classifier; spy on the recovery action.
vi.mock('../../lib/staleChunkRecovery', async (orig) => {
  const actual = await orig<typeof import('../../lib/staleChunkRecovery')>();
  return { ...actual, recoverFromStaleChunk: vi.fn() };
});
import { recoverFromStaleChunk } from '../../lib/staleChunkRecovery';
const recoverSpy = vi.mocked(recoverFromStaleChunk);

function Boom({ msg }: { msg: string }): JSX.Element {
  throw new Error(msg);
}

let consoleErr: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  recoverSpy.mockClear();
  window.sessionStorage.clear();
  consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {}); // silence React boundary noise
});
afterEach(() => consoleErr.mockRestore());

describe('ErrorBoundary — stale-chunk vs normal errors', () => {
  it('a NON-chunk error takes the normal path: generic fallback shown, recovery NOT claimed', () => {
    render(<ErrorBoundary><Boom msg="TypeError: something unrelated broke" /></ErrorBoundary>);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(recoverSpy).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('ss_stale_chunk_recovery')).toBeNull();
  });

  it('a stale-chunk import error routes to recovery and does NOT show the generic Oops page', () => {
    render(<ErrorBoundary><Boom msg="Failed to fetch dynamically imported module: /assets/SessionPage-abc.js" /></ErrorBoundary>);
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(recoverSpy).toHaveBeenCalledTimes(1);
  });
});
