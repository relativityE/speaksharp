/**
 * Industry Standard: Dependency Injection Container
 * Pattern: Singleton Registry with Type Safety
 * Priority Order: Registry > Config > Real
 */

import logger from '../../lib/logger';

export type STTMode = 'native' | 'private' | 'cloud' | 'whisper-turbo' | 'transformers-js' | 'mock-engine';

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

export class TestRegistryClass {
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
        if (typeof window !== 'undefined') {
            const win = window as unknown as {
                __TEST_REGISTRY_ENABLE__?: boolean;
                __TEST_REGISTRY_QUEUE__?: { key: string; factory: unknown; opts?: unknown }[];
            };

            // Handle early enable flag
            if (win.__TEST_REGISTRY_ENABLE__) {
                this.enable();
                delete win.__TEST_REGISTRY_ENABLE__;
            }

            if (Array.isArray(win.__TEST_REGISTRY_QUEUE__)) {
                const queue = win.__TEST_REGISTRY_QUEUE__;
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
const registryInstance = new TestRegistryClass();

// Expose to window for E2E tests (Industrial Strength Re-hydration)
if (typeof window !== 'undefined') {
    if (window.__TEST_REGISTRY__) {
        // If a registry already exists (e.g. from addInitScript), we must preserve it.
        // We do NOT overwrite it, instead we'll make our exported constant point to it
        // so that the app uses the same instance that the test configured.
        logger.info('[TestRegistry] Re-using existing registry from window');
    } else {
        window.__TEST_REGISTRY__ = registryInstance;
    }
}

/**
 * EXPORTED REGISTRY SINGLETON
 * Always favors the one on the window if available (for E2E compatibility)
 */
export const testRegistry = (typeof window !== 'undefined' && window.__TEST_REGISTRY__)
    ? (window.__TEST_REGISTRY__ as TestRegistryClass)
    : registryInstance;
