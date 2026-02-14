import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

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
    plugins: [react()],
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
      sourcemap: false,
      outDir: 'dist',
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-transformers': ['@xenova/transformers'],
            'vendor-charts': ['recharts'],
            'vendor-utils': ['html2canvas', 'jspdf', 'lucide-react', 'clsx', 'tailwind-merge'],
            'vendor-react': ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
            'vendor-supabase': ['@supabase/supabase-js'],
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
      },
    },
    define: {
      // Vite automatically exposes VITE_* prefixed env vars on import.meta.env
      // We only need to override specific values here
      'process.env': {},
      'global': 'globalThis',
      'import.meta.env.VITE_TEST_MODE': JSON.stringify(String(isTestMode)),
      '__BUILD_ID__': JSON.stringify(process.env.BUILD_ID ?? new Date().toISOString()),
    },
    optimizeDeps: {
      include: [
        // Pre-bundle comlink and other dependencies
        'comlink',
        'true-myth',
        'idb/with-async-ittr'
      ],
      exclude: ['whisper-turbo', 'whisper-webgpu'],
    },
    ssr: {
      external: ['@xenova/transformers'],
    },
  }
});
