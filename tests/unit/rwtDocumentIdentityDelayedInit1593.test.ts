// @vitest-environment node
/**
 * #1593 Case 15 follow-up (Sam 1792503928.955419, run 39431939529 on 724c2e9d) — A DOCUMENT'S START THAT ARRIVES AFTER ITS
 * REQUESTS STILL ATTRIBUTES THEM.
 *
 * The Case 15 watchdog held 38 events behind 6 unattributed request references (unprovenPages 0, conflicts 0). Source
 * candidate: `settle()` needs the loader's `init` start; when the browser's `Page.lifecycleEvent init` arrived after the
 * commit and after a request had already joined its record, the reference was marked ambiguous and never retried, because
 * joins only ran when a request or record was added. These controls drive DocumentProvenance directly, with the browser
 * events in that order, and keep every existing fence fail-closed: a start that never arrives, a conflicting key, a lost or
 * ended source, a record frozen while its loader was unknown, and the frozen `replaced` fact.
 *
 * This proves the mechanism offline; it does not by itself establish that it caused run 39431939529's HOLD.
 */
import { describe, expect, it } from 'vitest';
import { DocumentProvenance } from '../live/helpers/rwtDocumentIdentity';

const MONO_S = 5_000;
const OFFSET_S = 1_792_500_000 - MONO_S;

function source(): DocumentProvenance {
    const p = new DocumentProvenance();
    p.attached = true;
    p.live = true;
    p.setMainFrame('main');
    p.onClock(MONO_S, MONO_S + OFFSET_S);
    return p;
}

let seq = 0;
/** One PostHog request: the browser's record (classified now) and the decoded request, in the given order. */
function request(p: DocumentProvenance, loaderId: string, order: 'record-first' | 'ref-first' = 'record-first') {
    const url = `https://us.i.posthog.com/e/?_=${++seq}`;
    const body = Buffer.from(JSON.stringify([{ event: 'journey_step', n: seq }]));
    const record = p.classify(loaderId);
    if (order === 'record-first') {
        p.onRecord(url, body, record);
        return p.refFor(url, body);
    }
    const ref = p.refFor(url, body);
    p.onRecord(url, body, record);
    return ref;
}

describe('#1593 document identity: a delayed document start', () => {
    it('CASUALTY: init AFTER the commit and the request — the request resolves to its document once the start arrives', () => {
        const p = source();
        p.onCommitted('L1', 'main'); // committed, start not yet stated
        const ref = request(p, 'L1');
        expect(ref.resolved, 'not resolvable before the start is known').toBe(false);
        p.onInit('L1', 'main', MONO_S);
        expect(ref).toMatchObject({ resolved: true, ambiguous: false, replaced: false, generation: 0 });
        expect(ref.committedAt).toBe((MONO_S + OFFSET_S) * 1000);
        expect(p.unattributed).toBe(0);
    });

    it('CASUALTY: the same with the decoded request seen before the browser record', () => {
        const p = source();
        p.onCommitted('L1', 'main');
        const ref = request(p, 'L1', 'ref-first');
        p.onInit('L1', 'main', MONO_S);
        expect(ref.resolved).toBe(true);
        expect(p.unattributed).toBe(0);
    });

    it('CONTROL: init BEFORE the commit (the existing order) still resolves at once', () => {
        const p = source();
        p.onInit('L1', 'main', MONO_S);
        p.onCommitted('L1', 'main');
        expect(request(p, 'L1').resolved).toBe(true);
    });

    it('FENCE: a start that never arrives keeps the request unattributed (fail-closed)', () => {
        const p = source();
        p.onCommitted('L1', 'main');
        const ref = request(p, 'L1');
        expect(ref.resolved).toBe(false);
        expect(p.unattributed).toBe(1);
    });

    it("FENCE: another document's start never settles this request", () => {
        const p = source();
        p.onCommitted('L1', 'main');
        const ref = request(p, 'L1');
        p.onInit('L2', 'main', MONO_S + 1);
        p.onInit('L1', 'child-frame', MONO_S); // a sub-frame's init is not the main document's start
        expect(ref.resolved).toBe(false);
        expect(p.unattributed).toBe(1);
    });

    it('FENCE: a conflicting key stays a conflict after the start arrives', () => {
        const p = source();
        p.onCommitted('L1', 'main');
        const url = 'https://us.i.posthog.com/e/?_=dup';
        const body = Buffer.from('[{"event":"journey_step"}]');
        p.onRecord(url, body, p.classify('L1'));
        p.onRecord(url, body, p.classify('L1'));
        const ref = p.refFor(url, body);
        p.onInit('L1', 'main', MONO_S);
        expect(ref).toMatchObject({ resolved: false, ambiguous: true });
        expect(p.conflicts).toBe(1);
    });

    it('FENCE: once the source is lost or ended, a late start resolves nothing', () => {
        for (const pageClosed of [false, true]) {
            const p = source();
            p.onCommitted('L1', 'main');
            const ref = request(p, 'L1');
            p.onSourceGone(pageClosed);
            p.onInit('L1', 'main', MONO_S);
            expect(ref).toMatchObject({ resolved: false, ambiguous: true });
        }
    });

    it('FENCE: a record frozen while its loader was unknown stays unattributed even after commit and start', () => {
        const p = source();
        const ref = request(p, 'L9'); // reported before the page ever committed L9
        p.onInit('L9', 'main', MONO_S);
        p.onCommitted('L9', 'main');
        expect(ref.resolved).toBe(false);
        expect(p.unattributed).toBe(1);
    });

    it('FENCE: `replaced` stays frozen at report time — a late start does not reinterpret the origin', () => {
        const p = source();
        p.onCommitted('L1', 'main');
        const record = p.classify('L1');
        p.onCommitted('L2', 'main'); // the page leaves L1 after the request was reported
        const url = 'https://us.i.posthog.com/e/?_=frozen';
        const body = Buffer.from('[{"event":"journey_step"}]');
        p.onRecord(url, body, record);
        const ref = p.refFor(url, body);
        p.onInit('L1', 'main', MONO_S);
        expect(ref).toMatchObject({ resolved: true, replaced: false, generation: 0 });
    });
});
