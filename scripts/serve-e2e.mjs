// scripts/serve-e2e.mjs
import express from 'express';
import { resolve } from 'path';
import fs, { realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import { buildSandboxEpermArtifact, isSandboxBindEperm } from './sandbox-eperm-evidence.mjs';
import { modelAssetHeadersMiddleware, MODEL_ASSET_PREFIX } from './lib/modelAssetHeaders.mjs';

/** The E2E server's app, exported so its serving contract is tested on the real handler chain. */
export function createE2eApp(distDir = resolve('frontend/dist')) {
  const app = express();

  app.use((req, res, next) => {
    // Strict Isolation for WASM but allow credentialless cross-origin loads
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  });

  // Model assets: an explicit non-executable type and nosniff on every response (release review of 1816ec61).
  app.use(modelAssetHeadersMiddleware({ root: distDir, modelDirs: [resolve(distDir, 'models')] }));

  // Serve the production E2E build (from frontend/dist)
  app.use(express.static(distDir));

  // A missing model asset is a 404, never the SPA document.
  app.use(MODEL_ASSET_PREFIX, (_req, res) => {
    res.status(404).end();
  });

  // 🛡️ SPA FALLBACK: Ensure nested routes (e.g. /auth/signup) return index.html
  // This prevents raw 404s on direct navigation, allowing the React app to mount.
  app.get('*', (req, res) => {
    res.sendFile(resolve(distDir, 'index.html'));
  });

  return app;
}

const host = process.env.E2E_HOST || '127.0.0.1';
const port = Number(process.env.E2E_PORT || 4173);
const invalidArtifactPath = resolve('test-results/sandbox-eperm-preview-bind.json');
const fallbackInvalidArtifactPath = '/private/tmp/speaksharp-sandbox-eperm-preview-bind.json';

function writeSandboxEpermArtifact(error) {
  const content = JSON.stringify(buildSandboxEpermArtifact({
    host,
    port,
    error,
  }), null, 2);

  try {
    fs.mkdirSync(resolve('test-results'), { recursive: true });
    fs.writeFileSync(invalidArtifactPath, content);
    console.error(`Sandbox EPERM evidence written to ${invalidArtifactPath}`);
    return;
  } catch (writeError) {
    console.error(`Could not write sandbox EPERM evidence to ${invalidArtifactPath}: ${writeError.message}`);
  }

  try {
    fs.writeFileSync(fallbackInvalidArtifactPath, content);
    console.error(`Sandbox EPERM evidence written to ${fallbackInvalidArtifactPath}`);
  } catch (fallbackError) {
    console.error(`Could not write sandbox EPERM fallback evidence: ${fallbackError.message}`);
  }
}

// Listen only when run as the server, so tests can import createE2eApp.
function runAsServer() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (runAsServer()) {
  const server = createE2eApp().listen(port, host, () => {
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
}
