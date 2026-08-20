import { describe, it, expect, beforeEach } from 'vitest';
import { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { StaleChunkBootClear } from '../StaleChunkBootClear';

const GUARD = 'ss_stale_chunk_recovery';

// Seed a persisted recovery guard directly (as a post-reload page would have). We write sessionStorage
// rather than call recoverFromStaleChunk() so the seeding never depends on the module's in-flight flag.
beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem(GUARD, JSON.stringify({ at: 1000, count: 1 }));
});

describe('StaleChunkBootClear', () => {
  it('clears the recovery guard when it mounts (a real boot)', async () => {
    expect(window.sessionStorage.getItem(GUARD), 'guard seeded pre-render').not.toBeNull();
    render(<StaleChunkBootClear />);
    await waitFor(() => expect(window.sessionStorage.getItem(GUARD)).toBeNull());
  });

  it('inside <Suspense>, does NOT clear while a sibling suspends; clears only after the lazy child resolves', async () => {
    let resolveChunk!: () => void;
    const gate = new Promise<void>((r) => { resolveChunk = r; });
    let resolved = false;

    // A child that suspends until the gate resolves (models a lazy route chunk still loading).
    function PendingRoute() {
      if (!resolved) throw gate.then(() => { resolved = true; });
      return <div>route ready</div>;
    }

    render(
      <Suspense fallback={<div>loading</div>}>
        <StaleChunkBootClear />
        <PendingRoute />
      </Suspense>,
    );

    // While the sibling suspends, the whole Suspense subtree shows the fallback → boot-clear has NOT mounted.
    expect(screen.getByText('loading')).toBeTruthy();
    expect(window.sessionStorage.getItem(GUARD), 'guard retained while suspended').not.toBeNull();

    resolveChunk();
    await waitFor(() => expect(screen.getByText('route ready')).toBeTruthy());
    await waitFor(() => expect(window.sessionStorage.getItem(GUARD)).toBeNull()); // now genuinely booted
  });
});
