// scripts/serve-e2e.mjs
import express from 'express';
import { resolve } from 'path';
import fs from 'fs';
import { buildSandboxEpermArtifact, isSandboxBindEperm } from './sandbox-eperm-evidence.mjs';

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

const host = process.env.E2E_HOST || '127.0.0.1';
const port = Number(process.env.E2E_PORT || 4173);
const invalidArtifactPath = resolve('test-results/sandbox-eperm-preview-bind.json');

function writeSandboxEpermArtifact(error) {
  fs.mkdirSync(resolve('test-results'), { recursive: true });
  fs.writeFileSync(
    invalidArtifactPath,
    JSON.stringify(buildSandboxEpermArtifact({
      host,
      port,
      error,
    }), null, 2)
  );
}

const server = app.listen(port, host, () => {
  console.log(`🚀 [E2E Server] Running at http://${host}:${port}`);
  console.log('🛡️  [Security] COOP: same-origin | COEP: credentialless');
});

server.on('error', (error) => {
  if (isSandboxBindEperm(error)) {
    writeSandboxEpermArtifact(error);
    console.error('Local sandbox blocked preview server bind.');
    console.error('Re-run in a normal terminal or GitHub Actions for CI-equivalent evidence.');
    console.error('This artifact cannot be used to close RC gates.');
    process.exit(78);
  }

  throw error;
});
