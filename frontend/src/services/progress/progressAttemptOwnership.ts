/**
 * RWT-20 — cross-tab exclusive ownership of one Progress-debt attempt (Codex 4003281159).
 *
 * Every tab of an account runs its own retry schedule over the same durable queue, so an in-memory lock cannot stop two
 * tabs attempting one debt at once. Web Locks are shared by all browsing contexts of the origin: with `ifAvailable`, the
 * owner+session lock goes to exactly one context and every contender is called back with `null` — which means SKIP.
 * The lock is held until `work` settles and is dropped by the browser if the owning tab dies.
 *
 * Without Web Locks, `work` runs with only the caller's in-tab guard — no cross-tab exclusivity (P2 #1399 5661248198).
 */
interface LockManagerLike {
    request(name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<unknown>): Promise<unknown>;
}

/** `unavailable`: the lock API itself failed before answering (Codex 4004302937) — neither owned nor contended; `work` never ran. */
export type AttemptOwnership<T> = { owned: true; value: T } | { owned: false; unavailable?: true };

export async function withAttemptOwnership<T>(userId: string, sessionId: string, work: () => Promise<T>): Promise<AttemptOwnership<T>> {
    const locks = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
    if (!locks || typeof locks.request !== 'function') return { owned: true, value: await work() };
    let ownership: AttemptOwnership<T> = { owned: false };
    const answered = { value: false };
    try {
        await locks.request(`ss-progress-attempt:${userId}:${sessionId}`, { ifAvailable: true }, async (lock) => {
            answered.value = true;
            if (lock) ownership = { owned: true, value: await work() };
        });
    } catch (err) {
        if (answered.value) throw err;
        return { owned: false, unavailable: true };
    }
    return ownership;
}
