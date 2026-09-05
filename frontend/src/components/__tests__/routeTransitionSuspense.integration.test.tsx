import { describe, it, expect, vi } from 'vitest';
import React, { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnimatePresence } from 'framer-motion';
import { MemoryRouter, Routes, Route, Link, useLocation, useSearchParams } from 'react-router-dom';
import { PageTransition } from '@/components/ui/PageTransition';

/**
 * #1416 — a route whose lazy chunk suspends must still MOUNT after the transition.
 *
 * `App` renders `<Suspense>` OUTSIDE `<AnimatePresence mode="wait">`, around location-keyed `<Routes>`
 * whose elements are `React.lazy`. Those two do not compose:
 *
 *   - `mode="wait"` holds the OUTGOING route mounted until its exit animation completes before it will
 *     mount the incoming one.
 *   - The incoming route suspends. Because the Suspense boundary is ABOVE `AnimatePresence`, that
 *     suspension replaces the whole presence tree with the fallback, so `AnimatePresence` never
 *     observes the exit completing.
 *
 * The observed result is not a crash and not an error: the URL changes, the destination's effects can
 * even run, and then the OLD page is what stays on screen. That is exactly what the failing
 * `public-product-discovery` proof captured — `/practice?product=focus-points` was reached, the
 * parameter was stripped (so `PracticePage` mounted and its effect ran), the final URL was `/practice`,
 * there were no console or network errors, and the Session page was still what the user was looking at.
 *
 * This reproduces that structure without the app, so the fix can be proven at the seam that causes it.
 */

const Destination: React.FC = () => {
  const [params] = useSearchParams();
  return (
    <div data-testid="destination">
      {params.get('product') === 'focus-points' && <div data-testid="setup-dialog">SETUP</div>}
    </div>
  );
};

// A lazy child that resolves on a later tick, the way a real chunk does.
const LazyDestination = React.lazy(() => new Promise<{ default: React.FC }>((resolve) => {
  setTimeout(() => resolve({ default: Destination }), 10);
}));

const Origin: React.FC = () => (
  <div data-testid="origin">
    <Link to="/destination?product=focus-points" data-testid="go">Go</Link>
  </div>
);

/** The app's current nesting: Suspense above AnimatePresence. */
const SuspenseOutside: React.FC = () => {
  const location = useLocation();
  return (
    <Suspense fallback={<div data-testid="loader">LOADING</div>}>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/origin" element={<PageTransition><Origin /></PageTransition>} />
          <Route path="/destination" element={<PageTransition><LazyDestination /></PageTransition>} />
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
};

/** The TEMPTING WRONG FIX: move the suspension inside the presence tree and keep `mode="wait"`. */
const SuspenseInside: React.FC = () => {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/origin" element={<PageTransition><Origin /></PageTransition>} />
        <Route
          path="/destination"
          element={
            <PageTransition>
              <Suspense fallback={<div data-testid="loader">LOADING</div>}><LazyDestination /></Suspense>
            </PageTransition>
          }
        />
      </Routes>
    </AnimatePresence>
  );
};

/**
 * THE PRODUCTION SHAPE, as `App` renders it: one `Suspense` OUTSIDE `AnimatePresence`, location-keyed
 * `Routes` inside, lazy route elements — and no `mode="wait"`.
 *
 * The nesting is deliberately identical to `SuspenseOutside` above. The ONLY difference between the
 * broken composition and the working one is `mode="wait"`, so this pair isolates exactly one
 * variable. A "fixed" shape that also rearranged the boundaries would leave it unclear which change
 * mattered, and would stop mirroring the file it is supposed to protect.
 */
const ProductionShape: React.FC = () => {
  const location = useLocation();
  return (
    <Suspense fallback={<div data-testid="loader">LOADING</div>}>
      <AnimatePresence>
        <Routes location={location} key={location.pathname}>
          <Route path="/origin" element={<PageTransition><Origin /></PageTransition>} />
          <Route path="/destination" element={<PageTransition><LazyDestination /></PageTransition>} />
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
};

const drive = async (Shell: React.FC) => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/origin']}><Shell /></MemoryRouter>);
  await user.click(screen.getByTestId('go'));
  return user;
};

/** CONTROL: no lazy, no suspension at all. If this fails too, the harness is measuring jsdom's
 *  animation behaviour rather than the composition under test, and proves nothing. */
const NoLazy: React.FC = () => {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/origin" element={<PageTransition><Origin /></PageTransition>} />
        <Route path="/destination" element={<PageTransition><Destination /></PageTransition>} />
      </Routes>
    </AnimatePresence>
  );
};

describe('#1416 route transition must mount the destination', () => {
  it('CONTROL — a non-lazy destination mounts under the same AnimatePresence', async () => {
    await drive(NoLazy);
    await waitFor(() => expect(screen.getByTestId('destination')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('CASUALTY — restoring mode="wait" on the production shape stops the lazy destination mounting', async () => {
    // This is the defect, reproduced. The control above proves the harness is not simply measuring
    // jsdom's animation behaviour: identical machinery, non-lazy destination, mounts fine.
    await drive(SuspenseOutside);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByTestId('destination')).not.toBeInTheDocument();
    expect(screen.getByTestId('origin')).toBeInTheDocument();
  });

  it('moving Suspense inside the presence tree is NOT sufficient — mode="wait" is the blocker', async () => {
    // Worth pinning: the nesting looks like the culprit, and correcting it alone leaves the journey
    // just as broken. Whoever revisits this should not spend the afternoon I spent on it.
    await drive(SuspenseInside);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByTestId('destination')).not.toBeInTheDocument();
  });

  it('reaches the destination and renders what the query asked for', async () => {
    vi.useRealTimers();
    await drive(ProductionShape);

    await waitFor(() => expect(screen.getByTestId('destination')).toBeInTheDocument(), { timeout: 3000 });
    // The destination is mounted AND it acted on the query the link carried — which is the whole
    // point of the journey: Focus Points must actually open, not merely be navigated to.
    expect(screen.getByTestId('setup-dialog')).toBeInTheDocument();
    // The outgoing route's removal is NOT asserted here: jsdom runs no animation frames, so an
    // exiting `AnimatePresence` child is never retired in this environment. Asserting it would be
    // measuring jsdom, not the product.
  });
});
