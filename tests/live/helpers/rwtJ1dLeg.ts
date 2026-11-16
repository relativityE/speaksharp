/**
 * J1.d in the browser: the steps that produce `J1dObservations` (rwtJ1dJourney.ts judges them). Sam (16 Nov), option 1a: J1.d
 * runs in J1.a's worker, on J1.a's run-owned account and J1.a's known saved takes, reusing J1.a's in-memory sign-in closure and
 * the real sign-in form. No password file, magic link, new account or prior bearer.
 *
 * Order: owner reads the exact take (paired control, before) → sign out through the app with the recorder armed → anonymous probe
 * of the exact take from the page's own signed-out state → open the take's deep link signed out → sign in on the shown form →
 * the exact deep link renders that take → the mic stays off → every known take is listed and reopens → owner reopens the exact
 * take (paired control, after) → final sign-out. Content-free: digests, counts, booleans, routes and statuses only.
 */
import type { Page, Request } from '@playwright/test';
import { extractUidFromAuthStorage } from './proofAuthority';
import { waitForAppVisibleReady } from '../../e2e/helpers';
import { liveMicTracks, micAcquisitions, signOutThroughProduct } from './rwtJourney';
import { classifyJourneyWrite, digestOf, pollUntil, type J1dObservations, loadedReviewSessionId, type MicState } from './rwtJ1dJourney';
import { routeOf, SignOutRecorder } from './rwtSignOutRecorder';

export interface J1dLegContext {
    page: Page;
    /** The Supabase origin the page talks to. */
    backendOrigin: string;
    /** J1.a's run-owned account (its UID, in memory only). */
    ownerUid: string;
    /** J1.a's saved takes, in memory only; the first is the deep link's requested take. */
    takeIds: readonly string[];
    /** J1.a's closure: sign in on the auth form the page already shows. */
    signInOnShownForm: () => Promise<void>;
}

/** Bound on waiting for the product's logout call to answer after the sign-out click. */
const LOGOUT_WAIT_MS = 30_000;
const AUTH_TOKEN_KEY = /^sb-.*-auth-token$/;

async function pageUid(page: Page): Promise<string | null> {
    return page.evaluate(() => Object.keys(localStorage).map((k) => ({ key: k, value: localStorage.getItem(k) ?? '' })))
        .then((entries) => extractUidFromAuthStorage(entries)).catch(() => null);
}

async function micState(page: Page): Promise<MicState> {
    const runtime = await page.locator('html').getAttribute('data-runtime-state').catch(() => null);
    const tracks = await liveMicTracks(page).catch(() => null);
    return { recording: runtime === null ? null : runtime === 'RECORDING', liveTracks: tracks };
}

/**
 * One read of `sessions?id=eq.<take>` from the page itself, with whatever session the page holds now (its own stored access token,
 * or the anon key alone when signed out). The anon key is taken from the page's own earlier requests; nothing is injected.
 */
async function readTakeFromPage(page: Page, origin: string, anonKey: string, takeId: string): Promise<{ status: number | null; rows: number | null; wellFormed: boolean }> {
    return page.evaluate(async ({ origin: o, anon, id, tokenKey }) => {
        const key = Object.keys(localStorage).find((k) => new RegExp(tokenKey).test(k));
        let bearer = anon;
        try { const t = key ? JSON.parse(localStorage.getItem(key) ?? 'null')?.access_token : null; if (typeof t === 'string' && t) bearer = t; } catch { /* anon */ }
        try {
            const r = await fetch(`${o}/rest/v1/sessions?select=id&id=eq.${encodeURIComponent(id)}`, { headers: { apikey: anon, authorization: `Bearer ${bearer}` } });
            const body: unknown = await r.json().catch(() => undefined);
            return { status: r.status, rows: Array.isArray(body) ? body.length : null, wellFormed: Array.isArray(body) };
        } catch { return { status: null, rows: null, wellFormed: false }; }
    }, { origin, anon: anonKey, id: takeId, tokenKey: AUTH_TOKEN_KEY.source });
}

export async function runJ1dLeg(ctx: J1dLegContext): Promise<J1dObservations> {
    const { page, backendOrigin, ownerUid } = ctx;
    const known = ctx.takeIds.filter((id) => id);
    const requestedId = known[0] ?? null;
    const knownTakeDigests = known.map(digestOf);
    const recorder = new SignOutRecorder<Request>(backendOrigin);
    let anonKey: string | null = null;
    /** The page sent an authenticated backend request (a bearer that is not the anon key) since arming. */
    let authenticatedSeen = false;
    let recordingStarts = 0;
    let sessionWrites = 0;
    const context = page.context();
    const onRequest = (r: Request) => {
        let url: URL;
        try { url = new URL(r.url()); } catch { return; }
        if (url.origin !== backendOrigin) return;
        const headers = r.allHeaders();
        recorder.onRequest(r, r.url(), r.method(), headers);
        void headers.then((h) => {
            const key = typeof h.apikey === 'string' && h.apikey ? h.apikey : null;
            if (!anonKey && key) anonKey = key;
            const bearer = /^Bearer\s+(.+)$/i.exec(h.authorization ?? '')?.[1] ?? null;
            if (key && bearer && bearer !== key) authenticatedSeen = true;
        }, () => undefined);
        const kind = classifyJourneyWrite(r.method(), url.pathname);
        if (kind === 'session-write') sessionWrites += 1;
        if (kind === 'recording-start') recordingStarts += 1;
    };
    /** The final sign-out's own logout answer (the recorder's window is closed by then). */
    let finalPhase = false;
    let finalLogoutStatus: number | null = null;
    const onResponse = (res: { request(): Request; status(): number }) => {
        recorder.onResponse(res.request(), res.status());
        const r = res.request();
        let path = '';
        try { path = routeOf(new URL(r.url()).pathname); } catch { /* not a URL */ }
        if (finalPhase && r.method() === 'POST' && path === '/auth/v1/logout' && finalLogoutStatus === null) finalLogoutStatus = res.status();
    };
    const signedOutWithin = async (ms: number) => {
        let signedOut = false;
        await pollUntil(() => signedOut, async (wait) => { signedOut = (await pageUid(page)) === null; if (!signedOut) await page.waitForTimeout(wait); }, ms);
        return signedOut || (await pageUid(page)) === null;
    };
    const onFailed = (r: Request) => recorder.onFailed(r);
    context.on('request', onRequest);
    context.on('response', onResponse);
    context.on('requestfailed', onFailed);
    /**
     * Mic acquisitions per document, read before leaving it (the counter is per document). Keyed by the document's time origin, so
     * reading the same document twice never counts it twice.
     */
    const acquisitionsByDocument = new Map<number, number>();
    /** A document whose counter could not be read leaves recording starts unknown: the write row is then HOLD, never PASS. */
    let acquisitionReadFailed = false;
    const countAcquisitions = async () => {
        const doc = await page.evaluate(() => performance.timeOrigin).catch(() => null);
        const list = doc === null ? null : await micAcquisitions(page).catch(() => null);
        if (doc === null || list === null) { acquisitionReadFailed = true; return; }
        acquisitionsByDocument.set(doc, Math.max(list.length, acquisitionsByDocument.get(doc) ?? 0));
    };
    const micStarts = () => [...acquisitionsByDocument.values()].reduce((a, b) => a + b, 0);

    const obs: J1dObservations = {
        knownTakeDigests, ownerBefore: null, ownerAfterReturn: null, listedAfterReturn: null, reopened: null, micAfterSignOut: null,
        signOut: null, deepLink: null, rendered: null, requestedTakeDigest: requestedId ? digestOf(requestedId) : null,
        micAtReturnEntry: null, micOnDeepLink: null, writes: null, finalSignOut: null, recorder: null,
    };
    try {
        // Owner and the paired control (before): the signed-in owner reads the exact take.
        // Wait for the shared visible-readiness signal and the page's own authenticated traffic (which also yields the anon key),
        // so the owner control and the click never run before the page has hydrated (Codex, #1883).
        await page.goto('/progress');
        await waitForAppVisibleReady(page, 45_000).catch(() => undefined);
        await pollUntil(() => anonKey !== null && authenticatedSeen, (ms) => page.waitForTimeout(ms), 30_000);
        const before = await pageUid(page);
        obs.ownerBefore = before ? digestOf(before) : null;
        if (anonKey && requestedId && before === ownerUid) {
            const read = await readTakeFromPage(page, backendOrigin, anonKey, requestedId);
            recorder.recordOwnerRead('before', read.status === 200 && read.rows === 1);
        }
        await recorder.settled();

        // Sign out through the product, with the recorder armed.
        recorder.markClick();
        await signOutThroughProduct(page as never).catch(() => undefined);
        // The app clears local storage BEFORE its logout call answers (AuthProvider.signOut), so wait for the observed logout
        // answer before judging sign-out or starting the post-logout window and probe (Codex, #1883).
        await pollUntil(() => recorder.snapshot().logout?.completedSeq != null, (ms) => page.waitForTimeout(ms), LOGOUT_WAIT_MS);
        const signedOut = await signedOutWithin(30_000);
        const logout = recorder.snapshot().logout;
        obs.signOut = { logoutCompleted: logout?.status == null ? null : logout.status >= 200 && logout.status < 300, sessionAfter: !signedOut };
        obs.micAfterSignOut = await micState(page);

        // The anonymous probe of the exact take, from the page's own signed-out state.
        await recorder.observeAtLeast();
        if (anonKey && requestedId) {
            const sent = page.waitForRequest((r) => r.url().includes('/rest/v1/sessions?') && r.url().includes(encodeURIComponent(requestedId)), { timeout: 15_000 });
            const probe = await readTakeFromPage(page, backendOrigin, anonKey, requestedId);
            const request = await sent.catch(() => null);
            if (request) recorder.designateProbe(request);
            recorder.recordProbe({ status: probe.status, dataRows: probe.rows, wellFormed: probe.wellFormed, boundToTake: request !== null });
        }
        await recorder.settled();
        await countAcquisitions();

        // Signed out, open the take's deep link; the product shows the sign-in form; sign in there.
        const requested = requestedId ? `/progress/${requestedId}` : null;
        if (requested) {
            await page.goto(requested);
            recorder.markWindowEnd();
            await recorder.settled();
            obs.recorder = recorder.snapshot();
            await ctx.signInOnShownForm();
            await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30_000 }).catch(() => undefined);
            await waitForAppVisibleReady(page, 45_000).catch(() => undefined);
            obs.micAtReturnEntry = await micState(page);
            // The post-auth continue step may pass through another route first: give the return its bounded chance to settle on
            // the requested link before judging where it landed.
            const here = () => { const u = new URL(page.url()); return `${u.pathname}${u.search}`; };
            await pollUntil(() => here() === requested, (ms) => page.waitForTimeout(ms), 15_000);
            const landedUrl = new URL(page.url());
            obs.deepLink = { requested, landed: `${landedUrl.pathname}${landedUrl.search}` };
            const after = await pageUid(page);
            obs.ownerAfterReturn = after ? digestOf(after) : null;
            const renderedId = await loadedReviewSessionId(page);
            obs.rendered = { takeDigest: renderedId ? digestOf(renderedId) : null, ownerDigest: renderedId && after ? digestOf(after) : null };
            obs.micOnDeepLink = await micState(page);
            await countAcquisitions();
        }

        // History after the return: every known take listed, and each reopens to its own detail.
        await page.goto('/progress');
        await waitForAppVisibleReady(page, 45_000).catch(() => undefined);
        const listed: string[] = [];
        for (const id of known) {
            const row = page.getByTestId(`download-pdf-btn-${id}`).or(page.getByTestId(`download-pdf-btn-mobile-${id}`)).first();
            if (await row.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false)) listed.push(digestOf(id));
        }
        obs.listedAfterReturn = listed;
        await countAcquisitions();
        const reopened: Record<string, boolean> = {};
        for (const id of known) {
            await page.goto(`/progress/${id}`);
            reopened[digestOf(id)] = (await loadedReviewSessionId(page)) === id;
            await countAcquisitions();
        }
        obs.reopened = reopened;

        // The paired control (after): the same owner reads the exact take again.
        if (anonKey && requestedId && (await pageUid(page)) === ownerUid) {
            const read = await readTakeFromPage(page, backendOrigin, anonKey, requestedId);
            recorder.recordOwnerRead('after', read.status === 200 && read.rows === 1);
        }
        obs.recorder = recorder.snapshot();

        // Finish signed out (the write window closes after the final sign-out's answer).
        await countAcquisitions();
        finalPhase = true;
        await signOutThroughProduct(page as never).catch(() => undefined);
        await pollUntil(() => finalLogoutStatus !== null, (ms) => page.waitForTimeout(ms), LOGOUT_WAIT_MS);
        const finallySignedOut = await signedOutWithin(30_000);
        obs.finalSignOut = {
            logoutCompleted: finalLogoutStatus === null ? null : finalLogoutStatus >= 200 && finalLogoutStatus < 300,
            sessionAfter: !finallySignedOut,
        };
        // Writes are judged only when every visited document's mic counter was read (Codex-style fail-closed: unread is not zero).
        obs.writes = acquisitionReadFailed || acquisitionsByDocument.size === 0
            ? null : { recordingStarts: recordingStarts + micStarts(), sessionWrites, windowClosed: true };
    } finally {
        context.off('request', onRequest);
        context.off('response', onResponse);
        context.off('requestfailed', onFailed);
    }
    return obs;
}
