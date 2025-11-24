import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');
  const isTestMode = mode === 'test' || env.VITE_TEST_MODE === 'true';

  return {
    plugins: [react()],
    worker: {
      format: 'es'
    },
    server: {
      port: 5173,
      host: true,
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
    build: {
      target: 'esnext',
      sourcemap: true,
      outDir: 'dist',
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'analytics-vendor': ['posthog-js', '@sentry/react'],
            'ui-vendor': ['lucide-react', '@radix-ui/react-slot', '@radix-ui/react-dialog', 'sonner'],
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
      // Expose env vars on import.meta.env (Vite handles this automatically for VITE_* vars)
      'process.env': {},
      'global': 'globalThis',
      'import.meta.env.VITE_TEST_MODE': JSON.stringify(isTestMode),
    },
    optimizeDeps: {
      exclude: [],
    },
    ssr: {
      external: ['@xenova/transformers'],
    },
  }
});
