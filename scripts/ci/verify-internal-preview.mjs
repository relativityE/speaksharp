#!/usr/bin/env node
/**
 * #1390 Stage 1 — verify a deployed internal Preview from the RUNNING page.
 *
 * WHY FROM THE PAGE. "The build set VITE_INTERNAL_BUILD" and "the deployed page installs the switch
 * surfaces" are different claims. Only the second one is what an operator depends on, and an earlier
 * attempt at this check grepped the built bundle for the surface identifiers — which found them in BOTH
 * builds, because the module ships either way and the install is gated at runtime. A text match on a
 * bundle is not a runtime fact.
 *
 * We cannot execute the page's JavaScript here, so we assert on what the SERVED HTML states directly:
 *
 *   - `window.__APP_RELEASE__` is injected into index.html by the release-inject plugin, so the release
 *     identity is readable without running the app.
 *   - The switch surfaces are installed by a lazily-imported chunk. Its presence is necessary but not
 *     sufficient, so we additionally require the internal-build literal to be inlined INTO that chunk —
 *     which is the condition that makes the install actually happen. A normal build ships the same
 *     chunk carrying the opposite literal, and is therefore distinguishable.
 *
 * Emits URL, deployment identity, SHA, and pass/fail ONLY. Never an environment value or a token.
 */
const [, , previewUrl, requestedSha] = process.argv;

if (!previewUrl || !requestedSha) {
    console.error('::error::usage: verify-internal-preview.mjs <preview-url> <requested-sha>');
    process.exit(1);
}

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
/** Bounded readback of a protected Preview: the bypass reaches the page under test, nothing else. */
const headers = bypass ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } : {};

const fail = (msg) => { console.error(`::error::${msg}`); process.exitCode = 1; };

const get = async (url) => {
    const res = await fetch(url, { headers, redirect: 'follow' });
    if (!res.ok) throw new Error(`GET ${new URL(url).pathname} -> HTTP ${res.status}`);
    return res.text();
};

try {
    const html = await get(previewUrl);

    // ── 1. runtime release identity equals the requested SHA ────────────────────────────────────────
    const releaseMatch = html.match(/window\.__APP_RELEASE__\s*=\s*"([0-9a-fA-F]{7,40})"/);
    const release = releaseMatch?.[1] ?? null;
    console.log(`runtime release: ${release ?? '<absent>'}`);
    if (release !== requestedSha) {
        fail(`runtime release (${release ?? 'absent'}) does not equal the requested SHA (${requestedSha})`);
    }

    // ── 2. locate the switch chunk the page actually loads ──────────────────────────────────────────
    const chunkRefs = [...html.matchAll(/["'(]([^"'()]*installRuntimeSwitch[^"'()]*\.js)["')]/g)]
        .map((m) => m[1]);
    // The chunk is lazily imported, so it is normally referenced from the module graph rather than
    // index.html. Fall back to the asset manifest when index.html does not name it directly.
    let chunkPath = chunkRefs[0] ?? null;
    if (!chunkPath) {
        const assetRefs = [...html.matchAll(/["'(]([^"'()]*\/assets\/[^"'()]+\.js)["')]/g)].map((m) => m[1]);
        for (const ref of assetRefs) {
            const body = await get(new URL(ref, previewUrl).toString()).catch(() => '');
            const nested = body.match(/["'(]([^"'()]*installRuntimeSwitch[^"'()]*\.js)["')]/);
            if (nested) { chunkPath = nested[1]; break; }
        }
    }

    if (!chunkPath) {
        fail('could not locate the candidate-switch chunk from the served page');
    } else {
        const chunkUrl = new URL(chunkPath, previewUrl).toString();
        console.log(`switch chunk: ${chunkPath.split('/').pop()}`);
        const chunk = await get(chunkUrl);

        // ── 3. both switch surfaces are present in the chunk that installs them ─────────────────────
        const hasSwitch = chunk.includes('__SS_SWITCH_CANDIDATE__');
        const hasActive = chunk.includes('__SS_ACTIVE_CANDIDATE__');
        console.log(`__SS_SWITCH_CANDIDATE__ present: ${hasSwitch}`);
        console.log(`__SS_ACTIVE_CANDIDATE__ present: ${hasActive}`);
        if (!hasSwitch || !hasActive) fail('a candidate-switch surface is missing from the deployed chunk');

        // ── 4. internal-build identity — the condition that makes the install RUN ───────────────────
        // Vite inlines the literal. `"true"` present means the guard passes and the surfaces install;
        // a normal build inlines the opposite and returns before assigning anything.
        const internal = /VITE_INTERNAL_BUILD\s*:\s*"true"/.test(chunk)
            || /"true"\s*!==\s*"true"/.test(chunk) === false && chunk.includes('VITE_INTERNAL_BUILD:"true"');
        console.log(`internal-build identity: ${internal}`);
        if (!internal) {
            fail('deployed chunk does not carry VITE_INTERNAL_BUILD=true — the switch would not install');
        }
    }

    if (process.exitCode === 1) {
        console.error('::error::internal Preview verification FAILED');
    } else {
        console.log('internal Preview verification PASSED');
    }
} catch (err) {
    fail(`verification could not complete: ${err instanceof Error ? err.message : String(err)}`);
}
