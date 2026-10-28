import type { Page } from '@playwright/test';

/**
 * HUMAN REFLEX (PO 2026-10-12, #1258). The RWT journeys are what a PERSON does, and a person does not press the next
 * control within milliseconds of it appearing. Alpha runs 38298685079 and 38304068207 pressed the review's repeat action
 * 97 ms and 87 ms after Stop. A journey row must reflect human timing, so every press, fill, check, select and key press
 * the RWT specs make waits this think-time first.
 *
 * 500 ms is the default. 1000 ms is used only when 500 ms still fails, and otherwise the runs hold at 500 ms. A faster
 * setting (250 ms) is deliberately NOT offered yet; the PO reserved it as a future exercise if the situation demands it.
 * Machine-speed presses are a separate robustness question and never a journey row.
 */
export const HUMAN_REFLEX_CHOICES = [500, 1000] as const;
export type HumanReflexMs = (typeof HUMAN_REFLEX_CHOICES)[number];
export const DEFAULT_HUMAN_REFLEX_MS: HumanReflexMs = 500;

/** `RWT_HUMAN_REFLEX_MS` from the dispatch; empty means the default. Any other value fails closed before a write. */
export function resolveHumanReflexMs(raw: string | undefined = process.env.RWT_HUMAN_REFLEX_MS): HumanReflexMs {
    if (raw === undefined || raw.trim() === '') return DEFAULT_HUMAN_REFLEX_MS;
    const ms = Number(raw.trim());
    const choice = HUMAN_REFLEX_CHOICES.find((c) => c === ms);
    if (choice === undefined) {
        throw new Error(`RWT_HUMAN_REFLEX_MS must be one of ${HUMAN_REFLEX_CHOICES.join(', ')} (got "${raw}")`);
    }
    return choice;
}

/** The user actions that wait. Reads, waits and navigation by URL do not: they are not a person reacting. */
const LOCATOR_ACTIONS = ['click', 'dblclick', 'tap', 'fill', 'press', 'pressSequentially', 'check', 'uncheck', 'selectOption'] as const;
const KEYBOARD_ACTIONS = ['press', 'type', 'insertText'] as const;

let activeReflexMs = 0;
const patched = new WeakSet<object>();

/** The think-time currently applied (0 outside an RWT test), so a receipt records the timing it ran with. */
export function activeHumanReflexMs(): number {
    return activeReflexMs;
}

const pause = (): Promise<void> => (activeReflexMs > 0 ? new Promise((resolve) => setTimeout(resolve, activeReflexMs)) : Promise.resolve());

function wrap(proto: Record<string, unknown>, names: readonly string[]): void {
    if (patched.has(proto)) return;
    patched.add(proto);
    for (const name of names) {
        const original = proto[name];
        if (typeof original !== 'function') continue;
        proto[name] = async function humanReflexAction(this: unknown, ...args: unknown[]) {
            await pause();
            return (original as (...a: unknown[]) => unknown).apply(this, args);
        };
    }
}

/**
 * Apply `ms` to every Locator and Keyboard action in this worker until the returned release runs. The prototypes are
 * shared by every page, including tabs the journey opens later, so one install covers the whole test.
 */
export function applyHumanReflex(page: Page, ms: HumanReflexMs): () => void {
    wrap(Object.getPrototypeOf(page.locator('body')) as Record<string, unknown>, LOCATOR_ACTIONS);
    wrap(Object.getPrototypeOf(page.keyboard) as Record<string, unknown>, KEYBOARD_ACTIONS);
    activeReflexMs = ms;
    return () => { activeReflexMs = 0; };
}
