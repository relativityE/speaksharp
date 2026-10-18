type Phase = 'ready' | 'pending' | 'reconciliation' | 'completed';
interface Snapshot { phase: Phase; message: string | null }
const ready: Snapshot = { phase: 'ready', message: null };
const attempts = new Map<string, { id: symbol; snapshot: Snapshot }>();
const listeners = new Set<() => void>();

// Application-lifetime state, deliberately outside the route. No emailed secret is
// stored here. This prevents SPA remounts from turning an uncertain write into a retry;
// it does not establish server reconciliation or protection across browser reloads.
export const accountDeletionAttempts = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  snapshot(ownerId: string | null): Snapshot {
    return ownerId ? attempts.get(ownerId)?.snapshot ?? ready : ready;
  },
  begin(ownerId: string): symbol | null {
    if (this.snapshot(ownerId).phase !== 'ready') return null;
    const id = Symbol();
    attempts.set(ownerId, { id, snapshot: {
      phase: 'pending',
      message: 'Deletion confirmation is pending. Do not request another link or retry deletion.',
    } });
    listeners.forEach((listener) => listener());
    return id;
  },
  finish(ownerId: string, id: symbol, snapshot: Snapshot) {
    const attempt = attempts.get(ownerId);
    if (attempt?.id !== id || attempt.snapshot.phase !== 'pending') return;
    attempts.set(ownerId, { id, snapshot });
    listeners.forEach((listener) => listener());
  },
};
