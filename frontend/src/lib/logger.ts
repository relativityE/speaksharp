// Pino uses export = and requires esModuleInterop, which tsc sometimes misses in isolation
// Note: Vite automatically resolves this to pino/browser.js via the 'browser' field in pino/package.json
import pino from 'pino';
import { LoggerOptions } from 'pino';
import { resolveLoggerLevel } from './loggerConfig';

// DIRECT static reads: Vite replaces each `import.meta.env.<KEY>` with its literal value at build time, so
// the whole env object is never inlined into this (near-universally imported) module. A cast/computed/spread
// access would inline the entire env — including Vercel's per-deploy VITE_VERCEL_GIT_COMMIT_SHA — and rotate
// every chunk's content hash on every deploy. Guarded for non-Vite Node contexts where import.meta.env is
// undefined (in the Vite/vitest bundle these reads are already replaced with literals, so they never throw).
let viteMode: string | undefined;
try { viteMode = import.meta.env.MODE; } catch { viteMode = undefined; }
let viteLogLevel: string | undefined;
try { viteLogLevel = import.meta.env.VITE_LOG_LEVEL; } catch { viteLogLevel = undefined; }

const mode =
  viteMode ||
  (typeof process !== 'undefined' && process.env?.NODE_ENV) ||
  'production';
const explicitLevel =
  viteLogLevel ||
  (typeof process !== 'undefined' && process.env?.LOG_LEVEL) ||
  null;

const options: LoggerOptions = {
  level: resolveLoggerLevel({ explicitLevel, mode }),
};

if (mode === 'development') {
  // Only use pino-pretty if we are running in Vite (browser via import.meta.env).
  // In native Node (like Playwright test runner), it struggles to map the transport module.
  const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

  if (!isNode) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    };
  }
}

const logger = pino(options);

export default logger;
