import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('env.ts (Environment Detection)', () => {
    const originalWindow = global.window;
    const originalProcess = global.process;

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        global.window = originalWindow;
        global.process = originalProcess;
    });

    it('should detect test environment via import.meta.env.MODE', async () => {
        // Vitest sets MODE to 'test' by default
        const { IS_TEST_ENVIRONMENT } = await import('../env');
        expect(IS_TEST_ENVIRONMENT).toBe(true);
    });

    it('should detect test environment via window.__SS_E2E__', async () => {
        // @ts-expect-error - Mocking global window for testing
        global.window = { __SS_E2E__: { isActive: true } };
        const { IS_TEST_ENVIRONMENT } = await import('../env');
        expect(IS_TEST_ENVIRONMENT).toBe(true);
    });

    it('should detect false if __SS_E2E__ says inactive', async () => {
        // @ts-expect-error - Mocking global window for testing
        global.window = { __SS_E2E__: { isActive: false } };
        const { IS_TEST_ENVIRONMENT } = await import('../env');
        expect(IS_TEST_ENVIRONMENT).toBe(false);
    });
});
