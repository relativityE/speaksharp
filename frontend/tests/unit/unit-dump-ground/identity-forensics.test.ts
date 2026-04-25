import { describe, it, expect } from 'vitest';

/**
 * 🔬 IDENTITY FORENSICS (v2)
 * 
 * This test programmatically verifies if the Vitest runner is 
 * deduplicating modules correctly across different import strategies.
 */
describe('Module Identity Parity (Aliased vs Relative)', () => {
    it('should resolve the SAME SpeechRuntimeController instance via @/ vs relative', async () => {
        const { speechRuntimeController: aliased } = await import('@/services/SpeechRuntimeController');
        const { speechRuntimeController: relative } = await import('../../../src/services/SpeechRuntimeController');

        const aliasedId = (aliased as any).__LAST_STORE_ID__ || 'none';
        const relativeId = (relative as any).__LAST_STORE_ID__ || 'none';

        console.log(`[IDENTITY-PROBE] Aliased Controller:  ${aliasedId}`);
        console.log(`[IDENTITY-PROBE] Relative Controller: ${relativeId}`);

        expect(aliased).toBe(relative);
    });

    it('should resolve the SAME useSessionStore instance via @/ vs relative', async () => {
        const { useSessionStore: aliased } = await import('@/stores/useSessionStore');
        const { useSessionStore: relative } = await import('../../../src/stores/useSessionStore');

        console.log(`[IDENTITY-PROBE] Aliased Store:  ${aliased.name}`);
        console.log(`[IDENTITY-PROBE] Relative Store: ${relative.name}`);

        expect(aliased).toBe(relative);
    });
});
