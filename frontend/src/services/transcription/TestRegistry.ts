import logger from '../../lib/logger';

// Type declaration for global usage
declare global {
    interface Window {
        __TEST_REGISTRY__?: TestRegistry;
        __TEST_REGISTRY_QUEUE__?: { key: string; factory: unknown }[];
    }
}

class TestRegistry {
    private factories = new Map<string, unknown>();

    register(key: string, factory: unknown): void {
        // Safety check: Only allow registration in test/dev modes
        if (import.meta.env.MODE === 'test' || import.meta.env.DEV) {
            this.factories.set(key, factory);
        } else {
            logger.warn('[TestRegistry] Registration blocked in production mode');
        }
    }

    get<T>(key: string): T | undefined {
        return this.factories.get(key) as T | undefined;
    }

    clear(): void {
        this.factories.clear();
    }
}

export const testRegistry = new TestRegistry();

// Hydrate from queue if exists (from addInitScript)
// This allows E2E tests to register factories before the app loads
const queue = window.__TEST_REGISTRY_QUEUE__;
if (Array.isArray(queue)) {
    logger.info({ count: queue.length }, '[TestRegistry] Hydrating from queue');
    queue.forEach((item) => {
        if (item && item.key && item.factory) {
            testRegistry.register(item.key, item.factory);
        }
    });
}

// Expose ONLY in development/test environments for E2E tests to hook into
if (import.meta.env.MODE === 'test' || import.meta.env.DEV) {
    // Use a specific global property for the registry
    window.__TEST_REGISTRY__ = testRegistry;
}
