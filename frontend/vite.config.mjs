import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { viteStaticCopy } from 'vite-plugin-static-copy';

import { PORTS } from '../scripts/build.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  // __dirname is frontend/, so we need to go up one level to find .env files
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const isTestMode = mode === 'test' || env.VITE_TEST_MODE === 'true';

  console.log(`[Vite] Mode: ${mode}, REAL_WHISPER_TEST: ${process.env.REAL_WHISPER_TEST}`);
  if (process.env.REAL_WHISPER_TEST === 'true') {
    console.log('[Vite] enabling COOP/COEP headers');
  }

  return {
    envDir: path.resolve(__dirname, '..'),
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          {
            src: '../node_modules/whisper-turbo/dist/session.worker.js',
            dest: 'whisper-turbo'
          },
          {
            src: '../node_modules/whisper-turbo/dist/db/*',
            dest: 'whisper-turbo/db'
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
    assetsInlineLimit: 0, // Prevent WASM from being base64 encoded
    worker: {
      format: 'es'
    },
    server: {
      port: PORTS.DEV,
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
      headers: (process.env.REAL_WHISPER_TEST === 'true' || isTestMode) ? {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      } : undefined
    },
    preview: {
      host: '127.0.0.1',
      port: PORTS.PREVIEW,
      strictPort: true, // Fail fast if port is taken by a zombie
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      }
    },
    build: {
      target: 'esnext',
      emptyOutDir: true,
      sourcemap: true,
      minify: process.env.NODE_ENV === 'test' ? false : 'esbuild',
      outDir: 'dist',
      rollupOptions: {
        output: {
          // Add timestamp to filenames to force cache bust
          entryFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
          chunkFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
          assetFileNames: `assets/[name]-[hash]-${Date.now()}.[ext]`,
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
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@shared": path.resolve(__dirname, "../backend/supabase/functions/_shared"),
      },
    },
    define: {
      // Vite automatically exposes VITE_* prefixed env vars on import.meta.env
      // We only need to override specific values here

      'global': 'globalThis',
      'import.meta.env.VITE_TEST_MODE': JSON.stringify(String(isTestMode)),
      '__BUILD_ID__': JSON.stringify(process.env.BUILD_ID ?? new Date().toISOString()),
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
