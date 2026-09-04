#!/usr/bin/env node
/* global window, document */
// `window` and `document` below appear only inside `page.evaluate` callbacks, which are serialized
// and executed by the BROWSER, not by this Node process. Declared so the file lints cleanly wherever
// it is checked from.
/**
 * #1390 Stage 1 — verify a deployed internal Preview by RUNNING it.
 *
 * WHY A BROWSER. The previous version of this file inspected served HTML and bundle text and said so in
 * its own comment. That cannot decide PASS: the switch module ships in BOTH builds, so its identifiers
 * are present either way, and the install is gated at runtime. A build whose install never executes —
 * leaving `window.__SS_SWITCH_CANDIDATE__` undefined — passed every text check. The operator would then
 * be handed a "verified" Preview on which the comparison is impossible.
 *
 * So the page is loaded in a real browser and the surfaces are evaluated on the live `window`.
 *
 * FAILS CLOSED. A timeout, a navigation failure, an evaluation failure, an absent surface, a mismatched
 * release or a runtime that does not report internal-build identity all exit non-zero. There is no path
 * where "could not determine" becomes PASS.
 *
 * THE BYPASS IS A REQUEST HEADER ONLY. It is attached to browser requests and never printed, never put
 * in a URL, never written to a file.
 */
import { chromium } from 'playwright';


/**
 * #1390 RETURN — THE CHECKS ARE PREDICATES, so they can be EXECUTED with real inputs.
 *
 * The previous verifier proved release identity, the two switch surfaces and the identity receipt. None
 * of those depend on the deployment's routing or its cross-origin isolation, so it passed happily on a
 * Preview that had lost both. A Preview whose deep links 404 and whose page is not isolated is not a
 * Preview an operator can run the matrix on: the Private engine's threaded runtime needs
 * SharedArrayBuffer, which needs isolation.
 */

/** COOP must be `same-origin`. Anything else, including absence, is not isolation. */
export function coopOk(headers) {
    return (headers['cross-origin-opener-policy'] ?? '').trim().toLowerCase() === 'same-origin';
}

/** COEP must be `credentialless` or `require-corp`; both isolate, and the product configures the former. */
export function coepOk(headers) {
    const v = (headers['cross-origin-embedder-policy'] ?? '').trim().toLowerCase();
    return v === 'credentialless' || v === 'require-corp';
}

/**
 * A deep route must return the APP, not a Vercel 404.
 *
 * Status alone is not enough: Vercel's 404 page is a 404, but a misconfigured rewrite can also return
 * 200 with the platform's own HTML. The app is identified by the element the SPA mounts into.
 */
export function deepRouteServesApp({ status, bodyHasAppRoot, bodyLooksLikePlatform404 }) {
    return status === 200 && bodyHasAppRoot && !bodyLooksLikePlatform404;
}

/**
 * CLI ONLY BELOW. The predicates above are imported by test so they can be EXECUTED with real inputs;
 * without this guard that import launched a browser, read an empty argv and called `process.exit(1)`,
 * which is why importing them failed rather than proving anything.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
    const [, , previewUrl, requestedSha] = process.argv;

    if (!previewUrl || !requestedSha) {
        console.error('::error::usage: verify-internal-preview.mjs <preview-url> <requested-sha>');
        process.exit(1);
    }

    const NAV_TIMEOUT_MS = 60_000;
    const SETTLE_TIMEOUT_MS = 30_000;

    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    /** Header-only. The value never reaches stdout, a URL, or disk. */
    const extraHTTPHeaders = bypass
        ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' }
        : {};

    let browser;
    let failed = false;
    const fail = (msg) => { console.error(`::error::${msg}`); failed = true; };

    try {
        browser = await chromium.launch();
        const context = await browser.newContext({ extraHTTPHeaders });
        const page = await context.newPage();

        const response = await page.goto(previewUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        if (!response || !response.ok()) {
            throw new Error(`navigation returned HTTP ${response ? response.status() : 'no response'}`);
        }

        // The switch is installed from a lazily-imported chunk during app boot, so the surfaces appear
        // slightly after DOMContentLoaded. Wait for them, but treat the timeout as a FAILURE rather than
        // proceeding to read an undefined value.
        await page
            .waitForFunction(() => typeof window.__SS_SWITCH_CANDIDATE__ === 'function', null, { timeout: SETTLE_TIMEOUT_MS })
            .catch(() => { /* reported by the assertions below, which read the real values */ });

        const observed = await page.evaluate(() => ({
            release: window.__APP_RELEASE__ ?? null,
            switchType: typeof window.__SS_SWITCH_CANDIDATE__,
            activeType: typeof window.__SS_ACTIVE_CANDIDATE__,
            // Internal-build identity as the RUNTIME reports it: the surfaces only exist when the gated
            // installer actually ran, and the receipt is what the operator will read between takes.
            activeCandidate: typeof window.__SS_ACTIVE_CANDIDATE__ === 'function'
                ? window.__SS_ACTIVE_CANDIDATE__()
                : null,
        }));

        console.log(`runtime release: ${observed.release ?? '<absent>'}`);
        console.log(`typeof window.__SS_SWITCH_CANDIDATE__: ${observed.switchType}`);
        console.log(`typeof window.__SS_ACTIVE_CANDIDATE__: ${observed.activeType}`);
        console.log(`identity receipt available: ${observed.activeCandidate !== null}`);

        if (observed.release !== requestedSha) {
            fail(`runtime release (${observed.release ?? 'absent'}) does not equal the requested SHA (${requestedSha})`);
        }
        if (observed.switchType !== 'function') {
            fail('window.__SS_SWITCH_CANDIDATE__ is not a function — the switch did not install on the deployed page');
        }
        if (observed.activeType !== 'function') {
            fail('window.__SS_ACTIVE_CANDIDATE__ is not a function — the identity receipt is unavailable');
        }
        if (observed.activeCandidate === null) {
            fail('the running page reports no internal-build identity receipt');
        } else if (typeof observed.activeCandidate.requested !== 'string') {
            fail('the identity receipt does not name a requested candidate');
        }

        // CROSS-ORIGIN ISOLATION, read from the running page rather than from the config we hoped applied.
        const isolated = await page.evaluate(() => window.crossOriginIsolated === true);
        console.log(`window.crossOriginIsolated: ${isolated}`);
        if (!isolated) {
            fail('window.crossOriginIsolated is false — the Preview is not cross-origin isolated, so the '
                + "Private engine's threaded runtime has no SharedArrayBuffer");
        }

        // THE HEADERS THAT PRODUCE THAT ISOLATION, from the real document response. Reported separately so a
        // failure says WHICH directive is missing rather than only that isolation is off.
        const headers = response.headers();
        console.log(`COOP: ${headers['cross-origin-opener-policy'] ?? '<absent>'}`);
        console.log(`COEP: ${headers['cross-origin-embedder-policy'] ?? '<absent>'}`);
        if (!coopOk(headers)) {
            fail('Cross-Origin-Opener-Policy is not `same-origin` on the deployed document — the deploy root '
                + 'did not carry the product vercel.json');
        }
        if (!coepOk(headers)) {
            fail('Cross-Origin-Embedder-Policy is not `credentialless`/`require-corp` on the deployed document');
        }

        // A REAL NON-ROOT ROUTE. Without the SPA fallback rewrite this returns the platform's 404 while the
        // root URL keeps working, which is exactly the shape that would strand an operator mid-matrix.
        const deepUrl = new URL('/analytics', previewUrl).toString();
        const deepResponse = await page.goto(deepUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        const deepStatus = deepResponse ? deepResponse.status() : 0;
        const deep = await page.evaluate(() => ({
            bodyHasAppRoot: document.getElementById('root') !== null,
            bodyLooksLikePlatform404: /404|not_found|DEPLOYMENT_NOT_FOUND/i.test(document.title ?? ''),
        }));
        console.log(`deep route ${deepUrl} -> HTTP ${deepStatus}, app root present: ${deep.bodyHasAppRoot}`);
        if (!deepRouteServesApp({ status: deepStatus, ...deep })) {
            fail(`a non-root application route (${deepUrl}) did not serve the app (HTTP ${deepStatus}) — the SPA `
                + 'fallback rewrite is missing from the deployed root');
        }
    } catch (err) {
        // Any failure to determine is a FAILURE. "Could not check" must never read as "checked and fine".
        fail(`verification could not complete: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        await browser?.close().catch(() => {});
    }

    if (failed) {
        console.error('::error::internal Preview verification FAILED');
        process.exit(1);
    }
    console.log('internal Preview verification PASSED (evaluated on the running page)');

}
