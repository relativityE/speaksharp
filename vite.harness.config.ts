import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'playwright-tests/harness'),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'playwright-tests/dist'),
    emptyOutDir: true,
  }
});
