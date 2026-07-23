/* eslint-env node */
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import tsconfigPaths from 'vite-tsconfig-paths';
import { sentryVitePlugin } from '@sentry/vite-plugin';

import { PORTS, resolveAppModeMeta } from '../scripts/build.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  // __dirname is frontend/, so we need to go up one level to find .env files
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const isTestMode = mode === 'test';
  // NOTE: asset filenames are content-addressed via Rollup's [hash] ONLY. We deliberately do NOT append
  // a per-build timestamp: that rotated EVERY asset URL on every deployment (even unchanged chunks), so a
  // long-lived tab requesting an old chunk got a 404/HTML and crashed. [hash] already busts caches when
  // (and only when) content changes, which keeps unchanged chunks stable across deploys.
  //
  // Release id = the commit SHA in prod/CI, stable 'dev' locally. It is injected into index.html (which
  // is regenerated every deploy anyway) as `window.__APP_RELEASE__` and NOT `define`-inlined into the JS
  // bundle — inlining the volatile SHA into the `main` chunk cascaded new content-hashes across the whole
  // app import graph, so every commit (even a test-only one) renamed unchanged chunks.
  const releaseId =
    process.env.BUILD_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'dev';
  console.log(`[Vite] Mode: ${mode}`);

  // EXPERIMENT TOGGLE (off by default) — scoped cross-origin-isolation proof.
  // Cross-origin isolation enables SharedArrayBuffer -> multi-thread WASM, which may
  // make the Private Whisper decode materially faster (the dominant cost in the
  // post-Stop finalize wait). That speedup is the PROVEN lever; any accuracy gain
  // (from being able to relax the final-decode audio bound) is a SECOND-ORDER
  // hypothesis that must be measured, not assumed.
  //
  // COEP `credentialless` (not the removed `require-corp`) CAN enable isolation and
  // MAY reduce third-party breakage, but it does NOT guarantee third-party
  // compatibility. Official Stripe docs still state Stripe.js does NOT support
  // cross-origin isolated sites. So this stays OFF BY DEFAULT and must pass a scoped
  // isolation proof before any production header change:
  //   - window.crossOriginIsolated === true, SharedArrayBuffer available, wasmThreadCount > 1
  //   - smoke-test Supabase auth/profile, Sentry, PostHog, model assets, fonts, the
  //     hosted Stripe checkout redirect, and confirm NO Stripe.js loads in the isolated doc
  //   - benchmark current vs isolated decodeMs/RTF/WER on the Private fixtures
  // Default OFF keeps the test-agent baseline proofs against `main` byte-for-byte
  // unchanged. Enable the experiment with: STT_CROSS_ORIGIN_ISOLATED=1
  const isolationFlag = String(env.STT_CROSS_ORIGIN_ISOLATED || process.env.STT_CROSS_ORIGIN_ISOLATED || '').toLowerCase();
  const crossOriginIsolationHeaders = ['1', 'true', 'credentialless'].includes(isolationFlag)
    ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' }
    : {};
  if (Object.keys(crossOriginIsolationHeaders).length > 0) {
    console.log('[Vite] EXPERIMENT: cross-origin isolation ENABLED (COEP credentialless). Verify Stripe/third-party + crossOriginIsolated before any production use.');
  }

  const assetFileName = (assetInfo) => {
    const sourceName = assetInfo.names?.[0] ?? assetInfo.name ?? '';
    const ext = sourceName.endsWith('.ts') ? 'js' : '[ext]';
    return `assets/[name]-[hash].${ext}`;
  };

  return {
    root: __dirname,
    envDir: path.resolve(__dirname, '..'),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    plugins: [
      tsconfigPaths(),
      react(),
      // Inject the release id into index.html (regenerated every build) as a global, so the SHA is
      // available at runtime WITHOUT being inlined into — and rotating the hash of — any JS chunk.
      {
        name: 'speaksharp-release-inject',
        transformIndexHtml() {
          return [{
            tag: 'script',
            injectTo: 'head-prepend',
            children: `window.__APP_RELEASE__=${JSON.stringify(releaseId)};`,
          }];
        },
      },
      // #891 observability: upload source maps to Sentry so captured production stacks resolve to real
      // filenames/lines instead of minified frames. Activates ONLY when SENTRY_AUTH_TOKEN is present in
      // the BUILD env — no-op locally and in any build without the token. `sourcemap: 'hidden'` (below)
      // generates maps WITHOUT a sourceMappingURL comment, and filesToDeleteAfterUpload removes the .map
      // files after upload, so maps are never publicly served.
      ...(process.env.SENTRY_AUTH_TOKEN
        ? [sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
            telemetry: false,
          })]
        : []),
    ],
    assetsInclude: ['**/*.onnx'],
    assetsInlineLimit: 0, // Prevent WASM from being base64 encoded
    worker: {
      format: 'es'
    },
    server: {
      port: isTestMode ? PORTS.TEST : PORTS.PROD,
      host: true,
      // Note: COOP/COEP headers removed - they block Stripe.js and other third-party resources
      // The whisper-turbo web worker needs a different approach (copy worker to public/)
      watch: {
        usePolling: true,
        ignored: [
          'test-results/',
          'coverage/',
          '**/*.log',
          'docs/PRD.md'
        ]
      },
      // Empty by default (no isolation). Opt-in via STT_CROSS_ORIGIN_ISOLATED=1.
      headers: { ...crossOriginIsolationHeaders }
    },
    preview: {
      host: '127.0.0.1',
      port: PORTS.PREVIEW,
      strictPort: true, // Fail fast if port is taken by a zombie
      headers: {
        // Local release review must never reuse stale bundles while we are
        // validating visual fixes from vite preview.
        'Cache-Control': 'no-store, max-age=0',
        // Empty by default; opt-in multi-thread WASM via STT_CROSS_ORIGIN_ISOLATED=1.
        ...crossOriginIsolationHeaders,
      }
    },
    build: {
      target: 'esnext',
      emptyOutDir: true,
      // test mode keeps inline maps; prod emits HIDDEN maps only when uploading to Sentry (token present),
      // so they're generated for upload + deleted after, never referenced in or served with the bundle.
      sourcemap: isTestMode ? true : (process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false),
      minify: process.env.NODE_ENV === 'test' ? false : 'esbuild',
      outDir: 'dist',
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          privateDropin: path.resolve(__dirname, 'private-dropin.html'),
        },
        output: {
          // Content-addressed filenames ([hash] only). No per-build timestamp — unchanged chunks keep
          // stable URLs across deploys, so a long-lived tab never requests a rotated-away chunk.
          entryFileNames: `assets/[name]-[hash].js`,
          chunkFileNames: `assets/[name]-[hash].js`,
          assetFileNames: assetFileName,
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-utils': ['lodash', 'date-fns', 'clsx', 'tailwind-merge'],
            'vendor-transformers': ['@xenova/transformers'],
            'vendor-charts': ['recharts', 'lucide-react']
          }
        }
      },
      treeshake: {
        moduleSideEffects: (id) => id.endsWith('testEnv.ts'),
      }
    },
    define: {
      // Vite automatically exposes VITE_* prefixed env vars on import.meta.env
      // We only need to override specific values here

      'global': 'globalThis',
      // Release id is NO LONGER define-inlined here (it is injected into index.html as
      // window.__APP_RELEASE__ — see the release-inject plugin), so the volatile SHA never enters the JS
      // import graph and never rotates unchanged chunk hashes.
      // STT release-proof config-discipline: inject the canonical mode meta (single source
      // of truth = APP_MODES in build.config.js). The app reads this to publish
      // window.__APP_RUNTIME_CONFIG__, which the test-agent proof preflight validates against.
      '__APP_MODE_META__': JSON.stringify(resolveAppModeMeta(mode)),
    },
    optimizeDeps: {
      include: [],
      exclude: [],
    },
    ssr: {
      external: ['@xenova/transformers'],
    },
  }
});
