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
      }
    },
    preview: {
      host: '127.0.0.1',
      port: PORTS.PREVIEW
    },
    build: {
      target: 'esnext',
      sourcemap: true,
      outDir: 'dist',
      rollupOptions: {
        output: {
          // manualChunks removed to allow Vite's automatic splitting
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
    },
    optimizeDeps: {
      include: [
        // Pre-bundle whisper-turbo and its dependencies for worker support
        'whisper-turbo',
        'whisper-webgpu',
        'comlink',
        'true-myth',
        'idb/with-async-ittr'
      ],
      exclude: [],
    },
    ssr: {
      external: ['@xenova/transformers'],
    },
  }
});
