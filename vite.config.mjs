import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  worker: {
    format: 'es'
  },
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
    exclude: [],
  },
  ssr: {
    external: ['@xenova/transformers'],
  },
}));
