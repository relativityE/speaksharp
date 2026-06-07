/* eslint-env node */
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import tsconfigPaths from 'vite-tsconfig-paths';

import { PORTS, resolveAppModeMeta } from '../scripts/build.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  // __dirname is frontend/, so we need to go up one level to find .env files
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const isTestMode = mode === 'test';
  const buildStamp = Date.now();
  const stripSourceMapComment = (contents) =>
    contents.toString().replace(/\n?\/\/# sourceMappingURL=.*$/gm, '');
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
    return `assets/[name]-[hash]-${buildStamp}.${ext}`;
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
      viteStaticCopy({
        targets: [
          {
            src: '../node_modules/whisper-turbo/dist/session.worker.js',
            dest: 'whisper-turbo',
            transform: stripSourceMapComment,
          },
          {
            src: '../node_modules/whisper-turbo/dist/db/*.js',
            dest: 'whisper-turbo/db',
            transform: stripSourceMapComment,
          },
          {
            src: '../node_modules/whisper-webgpu/whisper-wasm_bg.wasm',
            dest: 'whisper-turbo'
          },
          {
            src: '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
            dest: 'pdfjs'
          }
        ]
      })
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
      sourcemap: isTestMode,
      minify: process.env.NODE_ENV === 'test' ? false : 'esbuild',
      outDir: 'dist',
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          privateDropin: path.resolve(__dirname, 'private-dropin.html'),
        },
        output: {
          // Add timestamp to filenames to force cache bust
          entryFileNames: `assets/[name]-[hash]-${buildStamp}.js`,
          chunkFileNames: `assets/[name]-[hash]-${buildStamp}.js`,
          assetFileNames: assetFileName,
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-utils': ['lodash', 'date-fns', 'clsx', 'tailwind-merge'],
            'vendor-transformers': ['@xenova/transformers'],
            'vendor-charts': ['recharts', 'lucide-react'],
            'vendor-pdf': ['pdfjs-dist']
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
      // Release id surfaced at runtime via window.__APP_RUNTIME_CONFIG__.release (PROD-CONFIG-1).
      // Prefer an explicit BUILD_ID, then the platform commit SHA (Vercel/GitHub set these at build),
      // falling back to a timestamp for local dev so the field is always populated.
      '__BUILD_ID__': JSON.stringify(
        process.env.BUILD_ID
        ?? process.env.VERCEL_GIT_COMMIT_SHA
        ?? process.env.GITHUB_SHA
        ?? new Date().toISOString()
      ),
      // STT release-proof config-discipline: inject the canonical mode meta (single source
      // of truth = APP_MODES in build.config.js). The app reads this to publish
      // window.__APP_RUNTIME_CONFIG__, which the test-agent proof preflight validates against.
      '__APP_MODE_META__': JSON.stringify(resolveAppModeMeta(mode)),
    },
    optimizeDeps: {
      include: [
        // Pre-bundle whisper-turbo and its dependencies for worker support
        'whisper-turbo',
        'whisper-webgpu',
        'comlink',
        'true-myth',
        'idb/with-async-ittr',
        'whisper-turbo',
        'whisper-webgpu'
      ],
      exclude: [],
    },
    ssr: {
      external: ['@xenova/transformers'],
    },
  }
});
