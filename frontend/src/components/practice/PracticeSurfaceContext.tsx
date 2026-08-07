/**
 * Typed, scoped state that tells the GLOBAL Report Issue dialog which of the three closed `/practice`
 * surfaces is active, so a report is attributed to Quick vs Objective vs home WITHOUT a route change.
 *
 * Owned ABOVE both Navigation (where the Report Issue button lives) and the routed page content, so the
 * dialog and the page share one source of truth. It carries ONLY a validated `PracticeSurface` token —
 * never a query string, localStorage value, DOM scrape, transcript, or mutable global string. Off
 * `/practice` the value is null and the dialog falls back to normal route-based context.
 */

import React from 'react';
import type { PracticeSurface } from '@/services/pageContext';

interface PracticeSurfaceContextValue {
  surface: PracticeSurface | null;
  setSurface: (surface: PracticeSurface | null) => void;
}

const PracticeSurfaceContext = React.createContext<PracticeSurfaceContextValue>({
  surface: null,
  setSurface: () => { /* no-op default: safe when rendered outside the provider */ },
});

export const PracticeSurfaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [surface, setSurface] = React.useState<PracticeSurface | null>(null);
  const value = React.useMemo(() => ({ surface, setSurface }), [surface]);
  return <PracticeSurfaceContext.Provider value={value}>{children}</PracticeSurfaceContext.Provider>;
};

/** Read + set the active practice surface (PracticePage sets it; the dialog reads it). */
export const usePracticeSurface = (): PracticeSurfaceContextValue => React.useContext(PracticeSurfaceContext);
