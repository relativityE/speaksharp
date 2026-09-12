/**
 * #1390 RETURN — THE DEPLOYED ROOT MUST CARRY THE PRODUCT'S VERCEL CONFIGURATION.
 *
 * `vercel deploy <path>` makes <path> the deployment root. The previous workflow passed the built
 * `frontend/dist`, while `vercel.json` lives at the repository root — outside it. Vercel therefore saw
 * no configuration at all, and the Preview silently lost:
 *
 *   - the SPA fallback rewrite, so every deep link returned a Vercel 404 instead of the app;
 *   - the `/api/(.*)` rewrite;
 *   - `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`,
 *     which are what make `crossOriginIsolated` true — and without isolation the Private engine's
 *     threaded WASM runtime does not get SharedArrayBuffer;
 *   - the `no-cache` header on `sw.js`.
 *
 * A verifier that reads release identity and switch surfaces passes anyway, because none of those
 * things are the page's routing or its isolation. That is how a "verified" Preview could have been
 * handed to an operator with a broken speech engine.
 *
 * So this assembles a deployment root: the built artifact plus a `vercel.json` DERIVED from the
 * repository's, carrying the runtime directives verbatim. Build-time keys are deliberately dropped —
 * `buildCommand`, `installCommand`, `outputDirectory`, `ignoreCommand` and `framework` describe how to
 * BUILD, and this is a prebuilt static upload; leaving them in would ask Vercel to rebuild a directory
 * that has no source in it.
 *
 * Fails closed: a repository config missing `rewrites` or `headers` aborts rather than deploying a
 * Preview whose routing and isolation nobody chose.
 */
import { readFileSync, writeFileSync, cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** Runtime directives that must survive into the deployed root. Build-time keys are not among them. */
export const RUNTIME_CONFIG_KEYS = Object.freeze(['rewrites', 'headers', 'redirects', 'cleanUrls', 'trailingSlash']);

/**
 * Project the repository config onto the deployment root config.
 * Exported so the projection itself can be executed by test rather than described.
 */
export function deploymentConfigFrom(repoConfig) {
    if (!repoConfig || typeof repoConfig !== 'object') {
        throw new Error('vercel.json did not parse to an object');
    }
    if (!Array.isArray(repoConfig.rewrites) || repoConfig.rewrites.length === 0) {
        throw new Error('vercel.json declares no rewrites; a Preview without the SPA fallback 404s on every deep link');
    }
    if (!Array.isArray(repoConfig.headers) || repoConfig.headers.length === 0) {
        throw new Error('vercel.json declares no headers; a Preview without COOP/COEP is not cross-origin isolated');
    }
    const out = { $schema: repoConfig.$schema };
    for (const key of RUNTIME_CONFIG_KEYS) {
        if (repoConfig[key] !== undefined) out[key] = repoConfig[key];
    }
    return out;
}

export function buildDeployRoot({ repoRoot, distDir, outDir }) {
    const configPath = resolve(repoRoot, 'vercel.json');
    if (!existsSync(configPath)) throw new Error(`no vercel.json at ${repoRoot}`);
    if (!existsSync(join(distDir, 'index.html'))) throw new Error(`no index.html in ${distDir}`);

    const repoConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    const deployConfig = deploymentConfigFrom(repoConfig);

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    cpSync(distDir, outDir, { recursive: true });
    writeFileSync(join(outDir, 'vercel.json'), `${JSON.stringify(deployConfig, null, 2)}\n`);
    return { outDir, deployConfig };
}

// CLI: node scripts/ci/build-preview-deploy-root.mjs <repoRoot> <distDir> <outDir>
if (import.meta.url === `file://${process.argv[1]}`) {
    const [, , repoRoot, distDir, outDir] = process.argv;
    if (!repoRoot || !distDir || !outDir) {
        console.error('usage: build-preview-deploy-root.mjs <repoRoot> <distDir> <outDir>');
        process.exit(2);
    }
    const { deployConfig } = buildDeployRoot({ repoRoot, distDir, outDir });
    console.log(`deploy root assembled at ${outDir}`);
    console.log(`carried runtime directives: ${Object.keys(deployConfig).filter((k) => k !== '$schema').join(', ')}`);
}
