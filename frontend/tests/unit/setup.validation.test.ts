import { describe, it, expect, vi } from 'vitest';

describe('Test environment polyfills', () => {
    it('provides IntersectionObserver with full contract', () => {
        // @ts-ignore - IntersectionObserver is globally polyfilled
        const obs = new IntersectionObserver(() => {});
        expect(obs.root).toBeDefined();
        expect(obs.rootMargin).toBeDefined();
        expect(obs.thresholds).toBeDefined();
        expect(obs.takeRecords).toBeTypeOf('function');
    });

    it('provides ResizeObserver', () => {
        expect(global.ResizeObserver).toBeTypeOf('function');
    });

    it('provides matchMedia', () => {
        expect(window.matchMedia).toBeTypeOf('function');
        expect(window.matchMedia('(max-width: 768px)').matches).toBe(false);
    });

    it('provides scrollTo', () => {
        expect(window.scrollTo).toBeTypeOf('function');
    });

    it('provides CSS.supports', () => {
        expect(window.CSS.supports).toBeTypeOf('function');
        expect(window.CSS.supports('display', 'grid')).toBe(false); // Mock returns false
    });
});
