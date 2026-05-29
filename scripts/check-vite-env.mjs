import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { PORTS } from './build.config.js';
import { validateViteEnv } from './vite-env-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const fail = (message) => {
  console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('❌ Vite environment check failed');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.error(message);
  console.error('\nThis check runs before Vite starts so manual testers never see a broken signup screen.');
  console.error('Use `pnpm dev` for real local auth testing and `pnpm dev:test` only for mocked E2E diagnostics.');
  console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const mode = process.argv[2] || 'development';
  const port = Number(process.argv[3] || (mode === 'test' ? PORTS.TEST : PORTS.PROD));
  const env = loadEnv(mode, rootDir, '');
  const result = validateViteEnv({ mode, port, env });

  if (result.unsafeOverride) {
    console.error('\n⚠️  UNSAFE OVERRIDE ENABLED — this run cannot be used for RC/manual release evidence.\n');
  }

  if (!result.ok) {
    fail(result.message);
  }

  console.log(`✅ ${result.message}`);
}
