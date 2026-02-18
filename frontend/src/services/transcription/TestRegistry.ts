/**
 * Industry Standard: Dependency Injection Container
 * Pattern: Singleton Registry with Type Safety
 * Priority Order: Registry > Config > Real
 */

import logger from '../../lib/logger';

export type STTMode = 'native' | 'private' | 'cloud';

export interface RegistryEntry {
    implementation: unknown;
    priority: number;
    testName: string;
    timestamp: number;
}

declare global {
    interface Window {
        __TEST_REGISTRY__?: TestRegistryClass;
        __TEST_REGISTRY_QUEUE__?: { key: string; factory: unknown; opts?: unknown }[];
    }
}

class TestRegistryClass {
    private registry = new Map<string, RegistryEntry>();
    private isEnabled = true; // Default to true in test environments

    /**
     * Enable registry (called by test setup)
     */
    enable(): void {
        this.isEnabled = true;
        logger.info('[TestRegistry] Enabled');
    }

    /**
     * Disable registry (called by test cleanup)
     */
    disable(): void {
        this.isEnabled = false;
        this.clear();
        logger.info('[TestRegistry] Disabled and cleared');
    }

    /**
     * Register a custom implementation (factory)
     * 
     * @param mode - STT mode (native, private, cloud)
     * @param factory - Factory function that returns an implementation
     * @param options - Registration options
     */
    register(
        mode: STTMode,
        factory: unknown,
        options?: {
            priority?: number;
            testName?: string;
        }
    ): void {
        const key = `${mode}STT`;
        const entry: RegistryEntry = {
            implementation: factory,
            priority: options?.priority ?? 100,
            testName: options?.testName ?? 'unknown',
            timestamp: Date.now()
        };

        this.registry.set(key, entry);

        logger.info({
            key,
            priority: entry.priority,
            testName: entry.testName
        }, '[TestRegistry] Registered factory');
    }

    /**
     * Get implementation factory for a mode
     */
    get<T>(mode: STTMode): T | undefined {
        // Dynamic Hydration from queue (for early injections)
        this.hydrateFromQueue();

        if (!this.isEnabled) {
            return undefined;
        }

        const key = `${mode}STT`;
        const entry = this.registry.get(key);

        if (entry) {
            logger.info({
                key,
                testName: entry.testName,
                age: Date.now() - entry.timestamp
            }, '[TestRegistry] Retrieved factory');
            return entry.implementation as T;
        }

        return undefined;
    }

    /**
     * Check if implementation is registered
     */
    has(mode: STTMode): boolean {
        this.hydrateFromQueue();
        const key = `${mode}STT`;
        return this.isEnabled && this.registry.has(key);
    }

    /**
     * Hydrate from __TEST_REGISTRY_QUEUE__ if it exists
     */
    private hydrateFromQueue(): void {
        if (typeof window !== 'undefined' && Array.isArray(window.__TEST_REGISTRY_QUEUE__)) {
            const queue = window.__TEST_REGISTRY_QUEUE__;
            while (queue.length > 0) {
                const item = queue.shift();
                if (item && item.key && item.factory) {
                    const mode = item.key.replace('STT', '') as STTMode;
                    logger.info({ mode, key: item.key }, '[TestRegistry] Hydrating from queue');
                    this.register(mode, item.factory, { testName: 'queued-injection' });
                }
            }
        }
    }

    /**
     * Clear all registrations
     */
    clear(): void {
        this.registry.clear();
        logger.info('[TestRegistry] Cleared all registrations');
    }

    /**
     * Get diagnostic info
     */
    getInfo() {
        return {
            enabled: this.isEnabled,
            registrations: Array.from(this.registry.entries()).map(([key, entry]) => ({
                mode: key,
                priority: entry.priority,
                testName: entry.testName,
                age: Date.now() - entry.timestamp
            }))
        };
    }
}

// Singleton instance
export const testRegistry = new TestRegistryClass();

// Expose to window for E2E tests
if (typeof window !== 'undefined') {
    window.__TEST_REGISTRY__ = testRegistry;
}
