/**
 * #1593 (Sam, #1662 RETURN on 2cab5b0c) — WHICH COMMITTED DOCUMENT OF A PAGE SENT EACH EVENT.
 *
 * Playwright's `framenavigated` fires for a new document AND for every same-document change (pushState, hash, a route
 * notification to the same URL), so inferring commits from it — matched against navigation responses by URL — can never
 * prove which document is current: a superseded or failed navigation cannot prove the predecessor, and URL equality cannot
 * prove a new document. Document ownership comes from the browser instead. Chromium's DevTools `Page.frameNavigated` fires
 * for a main-frame CROSS-DOCUMENT commit only (`Page.navigatedWithinDocument` reports the same-document kind, so it is never
 * a boundary). The live RWT harness is Chromium-only and already keeps a page-lifetime CDP session (`applyRwtIdentity`).
 *
 * Anything that cannot be proven makes the PAGE uncertain — page-level state, held whether or not an event has arrived —
 * until the next proven commit: a main-frame commit seen while the CDP source is not live yet (or on a page that has none),
 * and a back/forward-cache restore (an earlier document returns). Events captured while uncertain keep an unresolved,
 * ambiguous reference that never resolves: the watchdog judges a known boot's event as that boot's own evidence (fail
 * closed) and holds an unknown boot's (HOLD, never PASS).
 *
 * Residual, stated rather than claimed away: an event's document is the one current when the harness observes the event's
 * request. The request and the commit come from the same browser connection in the order the browser emitted them; nothing
 * here reorders them by timestamp.
 */
import type { Frame, Page } from '@playwright/test';

/** Which document an event belongs to; `ambiguous` (and never resolved) when the page's document could not be proven. */
export interface DocumentRef {
    resolved: boolean;
    ambiguous: boolean;
    generation: number;
    committedAt: number;
}

/** The CDP `Page.frameNavigated` parameters the tracker reads. */
export interface FrameNavigatedEvent {
    frame: { id: string; parentId?: string };
    type?: string;
}

/** The part of a Playwright `CDPSession` the tracker needs. */
export interface DocumentCdpSession {
    on(event: 'Page.frameNavigated', listener: (event: FrameNavigatedEvent) => void): unknown;
    send(method: 'Page.enable'): Promise<unknown>;
}

export class CommittedDocumentTracker {
    generation = 0;
    committedAt = Date.now();
    /** Whether a supported commit source (CDP) is live for this page; until then every main-frame commit is unproven. */
    proven = false;
    private uncertainRef: DocumentRef | null = null;
    private settledRef: DocumentRef | null = null;

    /** The document an event captured NOW belongs to — the page-level ambiguous reference while the page is uncertain. */
    currentRef(): DocumentRef {
        if (this.uncertainRef) return this.uncertainRef;
        if (!this.settledRef || this.settledRef.generation !== this.generation) {
            this.settledRef = { resolved: true, ambiguous: false, generation: this.generation, committedAt: this.committedAt };
        }
        return this.settledRef;
    }

    /** Whether the page's current document is unproven. */
    get uncertain(): boolean {
        return this.uncertainRef !== null;
    }

    /** A proven cross-document commit of the main frame: a new document, and the page is certain again. */
    onDocumentCommitted(now = Date.now()): void {
        this.generation += 1;
        this.committedAt = now;
        this.uncertainRef = null;
    }

    /** A main-frame commit whose document cannot be proven: the page is uncertain until the next proven commit. */
    onUnprovenCommit(): void {
        if (!this.uncertainRef) this.uncertainRef = { resolved: false, ambiguous: true, generation: Number.NaN, committedAt: Number.NaN };
    }

    /** Playwright's `framenavigated` for the main frame: proves nothing, so it only matters while no CDP source is live. */
    onFrameNavigated(): void {
        if (!this.proven) this.onUnprovenCommit();
    }

    /** CDP `Page.frameNavigated`: a main-frame cross-document commit (a back/forward-cache restore is not a new document). */
    onCdpFrameNavigated(event: FrameNavigatedEvent, now = Date.now()): void {
        if (event.frame.parentId) return;
        if (event.type === 'BackForwardCacheRestore') this.onUnprovenCommit();
        else this.onDocumentCommitted(now);
    }
}

const trackers = new WeakMap<object, { tracker: CommittedDocumentTracker; ready: Promise<void>; cdp: boolean }>();

function listenForCommits(page: Page, tracker: CommittedDocumentTracker): void {
    page.on('framenavigated', (frame: Frame) => { if (frame === page.mainFrame()) tracker.onFrameNavigated(); });
}

/**
 * Proven document tracking for a page, for the page's lifetime: CDP commits plus the Playwright fallback above. Idempotent;
 * resolves once the CDP source is live. Callers await it BEFORE the page's first navigation (the RWT fixture does, through
 * `applyRwtIdentity`); a commit before that leaves the page uncertain, never silently on its previous document.
 */
export function trackDocuments(page: Page, cdp: DocumentCdpSession): Promise<void> {
    const existing = trackers.get(page);
    if (existing?.cdp) return existing.ready;
    const tracker = existing?.tracker ?? new CommittedDocumentTracker();
    if (!existing) listenForCommits(page, tracker);
    // A CDP commit is authoritative whenever it arrives, even before `Page.enable` has answered.
    cdp.on('Page.frameNavigated', (event) => tracker.onCdpFrameNavigated(event));
    const ready = cdp.send('Page.enable').then(() => { tracker.proven = true; }, () => { /* no CDP source: stays unproven */ });
    trackers.set(page, { tracker, ready, cdp: true });
    return ready;
}

/** The page's tracker. A page with no CDP source still gets one, whose every main-frame commit leaves it uncertain. */
export function documentTrackerOf(page: Page): CommittedDocumentTracker {
    const existing = trackers.get(page);
    if (existing) return existing.tracker;
    const tracker = new CommittedDocumentTracker();
    listenForCommits(page, tracker);
    trackers.set(page, { tracker, ready: Promise.resolve(), cdp: false });
    return tracker;
}
