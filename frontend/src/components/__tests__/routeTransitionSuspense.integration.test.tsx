import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnimatePresence, motion } from 'framer-motion';
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
 *
 * #1545 — the route exit layer is gone altogether. `popLayout` fixed the mount, but any exit layer keeps
 * OUTGOING page instances alive and can restore them from children captured before the latest navigation:
 * Escape closed the Focus Points setup and it reopened from the old `?product=`, and the page that had just
 * appeared was remounted (a keypress lost, typed text dropped). The production shape is now a keyed
 * `motion.div` (fade-in only) directly around `Routes`, inside the one `Suspense`. The invariant protected
 * here: the incoming route mounts, the outgoing route does not stay mounted or interactive, and a search-only
 * change keeps the same page instance.
 */

const Destination: React.FC = () => {
  const [params] = useSearchParams();
  return (
    <div data-testid="destination">
      {params.get('product') === 'focus-points' && <div data-testid="setup-dialog">SETUP</div>}
      <input data-testid="destination-input" aria-label="point" />
      <Link to="/destination" data-testid="close-setup">Close</Link>
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
 * THE PRODUCTION SHAPE, as `App` renders it since #1545: one `Suspense`, a `motion.div` keyed by pathname that
 * only fades IN, and `Routes` directly inside it — no `AnimatePresence`, so nothing retains the outgoing route.
 * The source test below binds this shape to `App.tsx`.
 */
const ProductionShape: React.FC = () => {
  const location = useLocation();
  return (
    <Suspense fallback={<div data-testid="loader">LOADING</div>}>
      <motion.div key={location.pathname} data-testid="route-presence-child" className="w-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Routes location={location}>
          <Route path="/origin" element={<PageTransition><Origin /></PageTransition>} />
          <Route path="/destination" element={<PageTransition><LazyDestination /></PageTransition>} />
        </Routes>
      </motion.div>
    </Suspense>
  );
};

/** RETIRED (#1416 → #1545): `popLayout` mounted the incoming route but kept the OUTGOING one alive while it exited. */
const PopLayoutShape: React.FC = () => {
  const location = useLocation();
  return (
    <Suspense fallback={<div data-testid="loader">LOADING</div>}>
      <AnimatePresence mode="popLayout">
        <motion.div key={location.pathname} data-testid="route-presence-child" className="w-full">
          <Routes location={location}>
            <Route path="/origin" element={<PageTransition><Origin /></PageTransition>} />
            <Route path="/destination" element={<PageTransition><LazyDestination /></PageTransition>} />
          </Routes>
        </motion.div>
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

  it('CASUALTY — the retired popLayout exit layer keeps the outgoing route mounted and interactive', async () => {
    // What #1545 removes: after navigating away, the origin page is still in the document with a live link.
    // In a browser the exit eventually retires it — and that retirement is what restored stale route children.
    await drive(PopLayoutShape);
    await waitFor(() => expect(screen.getByTestId('destination')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByTestId('origin')).toBeInTheDocument();
    expect(screen.getByTestId('go')).toBeEnabled();
  });

  it('reaches the destination and renders what the query asked for', async () => {
    vi.useRealTimers();
    await drive(ProductionShape);

    await waitFor(() => expect(screen.getByTestId('destination')).toBeInTheDocument(), { timeout: 3000 });
    // The destination is mounted AND it acted on the query the link carried — which is the whole
    // point of the journey: Focus Points must actually open, not merely be navigated to.
    expect(screen.getByTestId('setup-dialog')).toBeInTheDocument();
    // #1545: nothing retains the outgoing route — it is gone the moment the destination shows, and cannot
    // be interacted with or restored later.
    expect(screen.queryByTestId('origin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('go')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('route-presence-child')).toHaveLength(1);
  });

  it('a search-only change keeps the same page instance — typed input survives, the setup closes and stays closed', async () => {
    const user = await drive(ProductionShape);
    await waitFor(() => expect(screen.getByTestId('setup-dialog')).toBeInTheDocument(), { timeout: 3000 });
    await user.type(screen.getByTestId('destination-input'), 'Name the price');
    const input = screen.getByTestId('destination-input');

    await user.click(screen.getByTestId('close-setup'));
    await waitFor(() => expect(screen.queryByTestId('setup-dialog')).not.toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByTestId('setup-dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('destination-input')).toBe(input);
    expect(input).toHaveValue('Name the price');
  });

  it('App renders exactly this shape: no route exit layer; the keyed motion.div wraps Routes', () => {
    // Asserted against `App.tsx` itself, so the behavioural tests above are bound to the file they protect —
    // a test that checks only its own composition proves only that it agrees with itself.
    const app = readFileSync(resolve(import.meta.dirname, '..', '..', 'App.tsx'), 'utf8');
    const code = app.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/AnimatePresence/);
    // The route host: a motion.div keyed by pathname whose opening tag is followed directly by `Routes`, with no exit.
    const routeHost = code.match(/<motion\.div\s+key=\{location\.pathname\}[^>]*data-testid="route-presence-child"[^>]*>\s*<Routes location=\{location\}>/);
    expect(routeHost).not.toBeNull();
    expect(routeHost?.[0]).not.toMatch(/\bexit=/);
  });
});
