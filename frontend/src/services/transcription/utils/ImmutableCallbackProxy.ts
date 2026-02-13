/**
 * ImmutableCallbackProxy
 * 
 * Provides a stable, immutable reference to a set of callbacks that can be
 * passed to a service (like TranscriptionService). The actual implementations
 * are stored in a mutable ref, so they can be updated by React without 
 * triggering service re-instantiation or having the service hold stale closures.
 */

export class ImmutableCallbackProxy<T extends object> {
    private callbacks: T;

    constructor(initialCallbacks: T) {
        this.callbacks = initialCallbacks;
    }

    /**
     * Updates the internal callback implementations.
     * This should be called inside a useEffect in the hook.
     */
    public update(newCallbacks: T) {
        this.callbacks = newCallbacks;
    }

    /**
     * Returns a proxy object where every function call is forwarded
     * to the latest version of the internal callbacks.
     */
    public getProxy(): T {
        const proxy = {} as Record<string | symbol, unknown>;

        (Object.keys(this.callbacks) as Array<keyof T>).forEach(key => {
            // We use a dynamic lookup inside the proxy call to ensure
            // we always use the latest implementation from this.callbacks
            const currentVal = this.callbacks[key];
            if (typeof currentVal === 'function') {
                proxy[key as string] = (...args: unknown[]) => {
                    const latestFn = this.callbacks[key];
                    if (typeof latestFn === 'function') {
                        return (latestFn as (...args: unknown[]) => unknown).apply(this.callbacks, args);
                    }
                };
            } else {
                // For non-function properties, we allow direct access
                // but these won't be "reactive" in the proxy sense
                Object.defineProperty(proxy, key, {
                    get: () => this.callbacks[key],
                    enumerable: true,
                    configurable: true
                });
            }
        });

        return proxy as unknown as T;
    }
}
