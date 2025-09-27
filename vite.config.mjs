import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import tailwindcss from '@tailwindcss/vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    watch: {
      ignored: [
        'test-results/',
        'coverage/',
        '**/*.log',
        'docs/PRD.md',
        'vite.config.mjs'
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
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      'jimp': process.env.VITEST
        ? 'jimp'
        : path.resolve(__dirname, 'node_modules/jimp/browser/lib/jimp.js'),
    },
  },
  define: {
    'process.env': {},
    'global': 'globalThis'
  },
  optimizeDeps: {
    exclude: ['jimp', '@xenova/transformers'],
  },
  ssr: {
    external: ['@xenova/transformers'],
  },
}));
