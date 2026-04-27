// scripts/serve-e2e.mjs
import express from 'express';
import { resolve } from 'path';

const app = express();

app.use((req, res, next) => {
  // Strict Isolation for WASM but allow credentialless cross-origin loads
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless'); 
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// Serve the production E2E build (from frontend/dist)
app.use(express.static(resolve('frontend/dist')));

// 🛡️ SPA FALLBACK: Ensure nested routes (e.g. /auth/signup) return index.html
// This prevents raw 404s on direct navigation, allowing the React app to mount.
app.get('*', (req, res) => {
  res.sendFile(resolve('frontend/dist/index.html'));
});

// Explicit localhost binding — resolving storage access denials seen on 127.0.0.1
app.listen(4173, 'localhost', () => {
  console.log('🚀 [E2E Server] Running at http://localhost:4173');
  console.log('🛡️  [Security] COOP: same-origin | COEP: credentialless');
});
