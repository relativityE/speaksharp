/**
 * #1593 (Sam, #1662 RETURNs on 2cab5b0c / 65dd8b8f) — WHICH DOCUMENT OF A PAGE SENT EACH EVENT, and from when that
 * document existed, both stated by the browser on the page's own CDP session.
 *
 * Neither navigation timing nor the harness's clock can establish an event's document: Playwright's `framenavigated` fires
 * for same-document changes too, URL equality proves nothing, and a host callback's arrival time is not the browser's
 * capture boundary. Chromium states it directly (verified locally on Playwright's Chromium):
 * - `Network.requestWillBeSent` carries the `loaderId` of the document that sent the request — page fetches, a request
 *   after a same-document hash change and the `pagehide` beacon each carry their own document's loader;
 * - `Page.frameNavigated` carries the main frame's committed `loaderId`, after the replaced document's beacon on the session;
 * - `Page.lifecycleEvent` `init` marks the new document's start on the browser's monotonic clock, and every
 *   `requestWillBeSent` pairs that clock with wall time — so the document's start is known on the SAME clock the page's own
 *   event timestamps use. The replaced document's `pagehide` capture fell before it; the new document's first capture after.
 *
 * Each decoded PostHog request is joined to the browser's record of it by exact URL and body bytes, a CANDIDATE match:
 * exactly one record and one decoded request for a key settle it; a second record or request for the same key at any time
 * makes the key a conflict (HOLD), never a first-come pairing. A settled request belongs to its loader's document, whose
 * start (`committedAt`, browser wall clock) still gates each event's boot binding — so an earlier boot's queued events
 * flushed by a later document can neither claim its boot slot nor suppress its fatal. A request the browser sent from a
 * document the page had already left is `replaced`: proven old-document evidence, excluded by the watchdog. Both facts come
 * from one CDP session, which delivers the target's Network and Page events in the order the browser emitted them.
 *
 * Everything else stays unattributed and the page cannot finish clean: no CDP source, a refused enable, a lost or crashed
 * session, a body the browser would not expose, a loader the page never committed or whose start is unknown, or a worker's
 * request (empty loader). Only the FIRST session given for a page is its authority; a later one is ignored.
 */
import { createHash } from 'node:crypto';
import type { CDPSession, Page } from '@playwright/test';

/** Which document an event belongs to. `replaced`: proven to come from a document the page had already left. */
export interface DocumentRef {
    resolved: boolean;
    ambiguous: boolean;
    replaced: boolean;
    generation: number;
    /** The document's start on the browser's wall clock (ms): no event captured before it can bind its boot. */
    committedAt: number;
}

/** The part of a Playwright `CDPSession` the provenance source needs. */
export type DocumentCdpSession = Pick<CDPSession, 'on' | 'send'>;

interface CdpRequestWillBeSent {
    requestId: string;
    loaderId: string;
    timestamp: number;
    wallTime: number;
    request: { url: string; method: string; hasPostData?: boolean; postDataEntries?: { bytes?: string }[] };
}
interface CdpFrameNavigated { frame: { id: string; parentId?: string; loaderId: string } }
interface CdpLifecycleEvent { frameId: string; loaderId: string; name: string; timestamp: number }

const POSTHOG_HOST = /posthog\.com$/i;

export const isPosthogPost = (url: string, method: string): boolean => {
    if (method !== 'POST') return false;
    try { return POSTHOG_HOST.test(new URL(url).host); } catch { return false; }
};

const keyOf = (url: string, body: Buffer): string => `${url}\n${createHash('sha256').update(body).digest('hex')}`;

const unresolvedRef = (ambiguous: boolean): DocumentRef =>
    ({ resolved: false, ambiguous, replaced: false, generation: Number.NaN, committedAt: Number.NaN });

/** Who sent a request, frozen when the browser reported it — including the browser's monotonic→wall mapping then (ms). */
export interface BrowserRecord { loaderId: string; known: boolean; replaced: boolean; offsetMs: number | null }

export class DocumentProvenance {
    /** A CDP source was given for the page. */
    attached = false;
    /** The source answered every enable and the frame tree: requests from now on carry provenance. */
    live = false;
    /** The source was lost (detached or crashed while the page was open). */
    lost = false;
    /** The page closed normally: its source ended with it. */
    ended = false;
    /** Keys with more than one browser record or decoded request: no pairing is proven. */
    conflicts = 0;
    private mainFrameId: string | null = null;
    private current: string | null = null;
    private readonly loaders = new Map<string, { generation: number; initMono: number | null }>();
    /** Browser wall-clock ms minus monotonic ms, from the latest request record (frozen into each record when reported). */
    private offsetMs: number | null = null;
    private readonly records = new Map<string, BrowserRecord[]>();
    private readonly refs = new Map<string, DocumentRef[]>();
    private readonly conflicted = new Set<string>();
    /**
     * #1593 Case 15 follow-up (Sam 1792503928): keys whose single request and single record are paired, waiting only for
     * their committed loader's `init` start. The start used to be required at the moment of joining, so a browser that
     * stated `init` after the commit and after the page's first requests left those requests ambiguous for good.
     */
    private readonly awaitingStart = new Map<string, Set<string>>();

    /** Whether everything this page sent can be attributed: a live source that was never lost. */
    get proven(): boolean {
        return this.live && !this.lost;
    }

    /** Decoded requests whose document is not proven (waiting, conflicted, or never joinable). */
    get unattributed(): number {
        let n = 0;
        for (const refs of this.refs.values()) for (const ref of refs) if (!ref.resolved) n += 1;
        return n + this.detachedRefs;
    }

    private detachedRefs = 0;

    /** The reference for one decoded page request; it settles when the browser's own record of the request is joined. */
    refFor(url: string, body: Buffer): DocumentRef {
        if (!this.attached || this.lost || this.ended) { this.detachedRefs += 1; return unresolvedRef(true); }
        const key = keyOf(url, body);
        const ref = unresolvedRef(false);
        this.refs.set(key, [...(this.refs.get(key) ?? []), ref]);
        this.join(key);
        return ref;
    }

    setMainFrame(frameId: string): void {
        this.mainFrameId = frameId;
    }

    /** The main frame's committed document. */
    onCommitted(loaderId: string, frameId?: string): void {
        if (frameId && this.mainFrameId && frameId !== this.mainFrameId) return;
        if (!this.loaders.has(loaderId)) this.loaders.set(loaderId, { generation: this.loaders.size, initMono: null });
        this.current = loaderId;
    }

    /** `Page.lifecycleEvent` `init` of the main frame: the document's start on the browser's monotonic clock (seconds). */
    onInit(loaderId: string, frameId: string, monotonicS: number): void {
        if (this.mainFrameId && frameId !== this.mainFrameId) return;
        const known = this.loaders.get(loaderId);
        if (known) known.initMono = monotonicS * 1000;
        else this.loaders.set(loaderId, { generation: this.loaders.size, initMono: monotonicS * 1000 });
        // The start arrived after requests of this document were paired: settle them now. Each record's loader and
        // `replaced` fact stay as frozen when the browser reported it; only the document's stated start is filled in.
        // Nothing settles once the source is lost or ended (their references are already ambiguous).
        const waiting = this.awaitingStart.get(loaderId);
        this.awaitingStart.delete(loaderId);
        if (waiting && !this.lost && !this.ended) for (const key of waiting) this.join(key);
    }

    /** Any request record: pairs the browser's monotonic clock with its wall clock. */
    onClock(monotonicS: number, wallS: number): void {
        this.offsetMs = wallS * 1000 - monotonicS * 1000;
    }

    /**
     * Who sent a request, frozen at the moment the browser REPORTED it: its loader, and whether the page had already left
     * that document then. Sam, #1662 RETURN on a81fbb97: a body fetched later attaches to this record unchanged — a
     * commit that happens while the bytes are fetched never reinterprets the request's origin.
     */
    classify(loaderId: string): BrowserRecord {
        const known = loaderId !== '' && this.loaders.has(loaderId);
        // Sam, #1662 RETURN on 45c57909: the clock mapping is frozen with the origin, so a pairing that changes while
        // the body is fetched cannot move the document's start under an already-reported request.
        return { loaderId, known, replaced: known && loaderId !== this.current, offsetMs: this.offsetMs };
    }

    /** The browser's record of a PostHog request, classified when the browser reported it. */
    onRecord(url: string, body: Buffer, record: BrowserRecord): void {
        if (this.lost) return;
        const key = keyOf(url, body);
        this.records.set(key, [...(this.records.get(key) ?? []), record]);
        this.join(key);
    }

    /** The source is gone. A closed page ends it normally; otherwise provenance is lost. Unjoined requests stay unattributed. */
    onSourceGone(pageClosed: boolean): void {
        if (pageClosed) this.ended = true;
        else this.lost = true;
        for (const refs of this.refs.values()) for (const ref of refs) if (!ref.resolved) ref.ambiguous = true;
    }

    private join(key: string): void {
        const refs = this.refs.get(key) ?? [];
        const records = this.records.get(key) ?? [];
        if (refs.length > 1 || records.length > 1) {
            // A candidate match is not a proven pairing: every request for this key loses its document, now and later.
            if (!this.conflicted.has(key)) { this.conflicted.add(key); this.conflicts += 1; }
            for (const ref of refs) Object.assign(ref, unresolvedRef(true));
            return;
        }
        if (refs.length === 1 && records.length === 1) this.settle(refs[0], records[0], key);
    }

    private settle(ref: DocumentRef, record: BrowserRecord, key: string): void {
        const loader = record.known ? this.loaders.get(record.loaderId) : undefined;
        if (loader && loader.initMono == null && record.offsetMs !== null) {
            // A committed document whose start is not stated YET: wait for its `init` (still unresolved, so the page
            // cannot finish clean while it waits). A start that never arrives leaves it unattributed.
            const keys = this.awaitingStart.get(record.loaderId) ?? new Set<string>();
            keys.add(key);
            this.awaitingStart.set(record.loaderId, keys);
            return;
        }
        const start = loader?.initMono != null && record.offsetMs !== null ? loader.initMono + record.offsetMs : null;
        if (!loader || start === null) { ref.ambiguous = true; return; }
        Object.assign(ref, { resolved: true, ambiguous: false, replaced: record.replaced, generation: loader.generation, committedAt: start });
    }
}

const sources = new WeakMap<object, DocumentProvenance>();

const bodyOf = (entries: { bytes?: string }[] | undefined): Buffer =>
    Buffer.concat((entries ?? []).map((e) => Buffer.from(e.bytes ?? '', 'base64')));

/**
 * Proven document provenance for a page, for the page's lifetime, from its CDP session. Idempotent; resolves once the
 * source is live. Callers await it BEFORE the page's first navigation (the RWT fixture does, through `applyRwtIdentity`).
 */
export async function trackDocuments(page: Page, cdp: DocumentCdpSession): Promise<void> {
    const provenance = documentTrackerOf(page);
    if (provenance.attached) return;
    provenance.attached = true;
    const closed = () => { try { return page.isClosed(); } catch { return false; } };
    cdp.on('Page.frameNavigated', ((e: CdpFrameNavigated) => { if (!e.frame.parentId) provenance.onCommitted(e.frame.loaderId, e.frame.id); }) as never);
    cdp.on('Page.lifecycleEvent', ((e: CdpLifecycleEvent) => { if (e.name === 'init') provenance.onInit(e.loaderId, e.frameId, e.timestamp); }) as never);
    cdp.on('Network.requestWillBeSent', ((e: CdpRequestWillBeSent) => {
        provenance.onClock(e.timestamp, e.wallTime);
        if (!isPosthogPost(e.request.url, e.request.method)) return;
        const record = provenance.classify(e.loaderId);
        const inline = bodyOf(e.request.postDataEntries);
        if (inline.length > 0) { provenance.onRecord(e.request.url, inline, record); return; }
        if (!e.request.hasPostData) return;
        // A body the browser did not inline is fetched; a failed fetch leaves the decoded request unattributed (HOLD).
        void cdp.send('Network.getRequestPostData', { requestId: e.requestId }).then((r) => {
            const { postData, base64Encoded } = r as { postData?: string; base64Encoded?: boolean };
            if (postData) provenance.onRecord(e.request.url, Buffer.from(postData, base64Encoded ? 'base64' : 'utf8'), record);
        }, () => undefined);
    }) as never);
    cdp.on('Inspector.detached', (() => provenance.onSourceGone(closed())) as never);
    cdp.on('Inspector.targetCrashed', (() => provenance.onSourceGone(false)) as never);
    page.on('crash', () => provenance.onSourceGone(false));
    try {
        await cdp.send('Inspector.enable');
        await cdp.send('Page.enable');
        await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true });
        await cdp.send('Network.enable');
        const tree = await cdp.send('Page.getFrameTree') as { frameTree?: { frame?: { id?: string; loaderId?: string } } };
        const frame = tree.frameTree?.frame;
        if (frame?.id) provenance.setMainFrame(frame.id);
        if (frame?.loaderId && !provenance.lost) provenance.onCommitted(frame.loaderId);
        provenance.live = !provenance.lost && Boolean(frame?.loaderId);
    } catch {
        provenance.live = false;
    }
}

/** The page's provenance source. A page with no CDP source gets one whose every request stays unattributed. */
export function documentTrackerOf(page: Page): DocumentProvenance {
    let provenance = sources.get(page);
    if (!provenance) { provenance = new DocumentProvenance(); sources.set(page, provenance); }
    return provenance;
}

/** The page's provenance source if the harness ever tracked the page (never creates one). */
export function documentTrackerIfAny(page: unknown): DocumentProvenance | undefined {
    return typeof page === 'object' && page !== null ? sources.get(page) : undefined;
}
