import '@testing-library/jest-dom';

// Polyfills for Radix UI components (DropdownMenu, Dialog, etc.)
if (typeof window !== 'undefined') {
    // PointerEvent polyfill
    if (!window.PointerEvent) {
        class PointerEvent extends MouseEvent {
            public pointerId: number;
            public pointerType: string;
            public isPrimary: boolean;
            constructor(type: string, params: PointerEventInit = {}) {
                super(type, params);
                this.pointerId = params.pointerId ?? 0;
                this.pointerType = params.pointerType ?? 'mouse';
                this.isPrimary = params.isPrimary ?? true;
            }
        }
        (window as unknown as Record<string, unknown>).PointerEvent = PointerEvent;
    }

    // ResizeObserver polyfill
    if (!window.ResizeObserver) {
        window.ResizeObserver = class ResizeObserver {
            observe() { }
            unobserve() { }
            disconnect() { }
        };
    }
}
