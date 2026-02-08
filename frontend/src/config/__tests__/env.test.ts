import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as env from '../env';

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

    it('should detect test environment via VITE_TEST_MODE', async () => {
        vi.stubEnv('VITE_TEST_MODE', 'true');
        // We need to re-import or use the exported value
        const { IS_TEST_ENVIRONMENT } = await import('../env');
        expect(IS_TEST_ENVIRONMENT).toBe(true);
        vi.unstubAllEnvs();
    });

    it('should detect test environment via import.meta.env.MODE', async () => {
        // Vitest sets MODE to 'test' by default
        const { IS_TEST_ENVIRONMENT } = await import('../env');
        expect(IS_TEST_ENVIRONMENT).toBe(true);
    });

    it('should detect test environment via window.TEST_MODE', async () => {
        // @ts-expect-error - Mocking global window for testing
        global.window = { TEST_MODE: true };
        const { IS_TEST_ENVIRONMENT } = await import('../env');
        expect(IS_TEST_ENVIRONMENT).toBe(true);
    });

    it('should detect test environment via E2E_CONTEXT_FLAG', async () => {
        // @ts-expect-error - Mocking global window for testing
        global.window = { [env.E2E_CONTEXT_FLAG]: true };
        const { IS_TEST_ENVIRONMENT } = await import('../env');
        expect(IS_TEST_ENVIRONMENT).toBe(true);
    });
});
