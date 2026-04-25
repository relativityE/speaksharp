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
        (global as unknown as Record<string, unknown>).window = { __SS_E2E__: { isActive: true } };
        const { IS_TEST_ENVIRONMENT } = await import('../env');
        expect(IS_TEST_ENVIRONMENT).toBe(true);
    });

    it('should detect false if __SS_E2E__ says inactive', async () => {
        const originalTest = (globalThis as unknown as { __TEST__?: boolean }).__TEST__;
        try {
            (global as unknown as Record<string, unknown>).window = { __SS_E2E__: { isActive: false } };
            (globalThis as unknown as { __TEST__?: boolean }).__TEST__ = false;
            
            const { IS_TEST_ENVIRONMENT } = await import('../env');
            expect(IS_TEST_ENVIRONMENT).toBe(false);
        } finally {
            (globalThis as unknown as { __TEST__?: boolean }).__TEST__ = originalTest;
        }
    });
});
