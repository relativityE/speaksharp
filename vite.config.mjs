import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    watch: {
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
        manualChunks: undefined,
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
    'global': 'globalThis'
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers'],
    // Force the test environment setup file to be included by the dev server.
    // This prevents it from being tree-shaken in test mode, which was the
    // root cause of the MSW worker failing to initialize.
    include: ['src/testEnv.ts'],
  },
  ssr: {
    external: ['@xenova/transformers'],
  },
}));