import { describe, it, expect, vi } from 'vitest';
import { ImmutableCallbackProxy } from '../ImmutableCallbackProxy';

describe('ImmutableCallbackProxy', () => {
    it('should forward calls to initial callbacks', () => {
        const initial = {
            onUpdate: vi.fn(),
            getValue: () => 'initial'
        };
        const proxy = new ImmutableCallbackProxy(initial);
        const wrapped = proxy.getProxy();

        wrapped.onUpdate('test');
        expect(initial.onUpdate).toHaveBeenCalledWith('test');
        expect(wrapped.getValue()).toBe('initial');
    });

    it('should forward calls to updated callbacks', () => {
        const initial = {
            onUpdate: vi.fn(),
            getValue: () => 'initial'
        };
        const proxy = new ImmutableCallbackProxy(initial);
        const wrapped = proxy.getProxy();

        const updated = {
            onUpdate: vi.fn(),
            getValue: () => 'updated'
        };
        proxy.update(updated);

        wrapped.onUpdate('new-test');
        expect(initial.onUpdate).not.toHaveBeenCalledWith('new-test');
        expect(updated.onUpdate).toHaveBeenCalledWith('new-test');
        expect(wrapped.getValue()).toBe('updated');
    });

    it('should handle non-function properties via getter', () => {
        const initial = {
            onUpdate: vi.fn(),
            config: { id: 1 }
        };
        const proxy = new ImmutableCallbackProxy(initial);
        const wrapped = proxy.getProxy();

        expect(wrapped.config.id).toBe(1);

        const updated = {
            onUpdate: vi.fn(),
            config: { id: 2 }
        };
        proxy.update(updated);

        expect(wrapped.config.id).toBe(2);
    });

    it('should maintain stable function references in the proxy', () => {
        const initial = { onUpdate: () => { } };
        const proxy = new ImmutableCallbackProxy(initial);
        const wrapped = proxy.getProxy();

        const firstRef = wrapped.onUpdate;

        proxy.update({ onUpdate: () => { } });

        const secondRef = wrapped.onUpdate;

        // This is a key requirement: the proxy function itself should be stable 
        // to prevent re-instantiation of components that depend on it.
        expect(firstRef).toBe(secondRef);
    });
});
