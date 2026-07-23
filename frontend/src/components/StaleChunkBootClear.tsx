import { useEffect } from 'react';
import { markStaleChunkBootSuccess } from '../lib/staleChunkRecovery';

/**
 * Renders nothing. Its ONLY job is to signal a genuinely successful application boot to the stale-chunk
 * recovery guard. It must be rendered INSIDE the app's route <Suspense> boundary (alongside <Routes>): a
 * component inside a Suspense subtree does not mount until that subtree stops suspending — i.e. until a
 * lazily-imported route chunk has actually resolved and rendered. So its mount effect fires only on a real
 * post-reload boot where the dynamic import that previously failed now works — never on a frame-count timer,
 * and never while the destination chunk is still 404ing (that path throws to the ErrorBoundary instead).
 */
export function StaleChunkBootClear(): null {
  useEffect(() => {
    markStaleChunkBootSuccess();
  }, []);
  return null;
}
