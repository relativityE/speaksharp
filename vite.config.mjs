import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const isTestMode = mode === 'test';

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
