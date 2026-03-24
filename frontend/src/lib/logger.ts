// Pino uses export = and requires esModuleInterop, which tsc sometimes misses in isolation
// Note: Vite automatically resolves this to pino/browser.js via the 'browser' field in pino/package.json
import pino from 'pino';
import { LoggerOptions } from 'pino';

const options: LoggerOptions = {
  level: (typeof process !== 'undefined' && process.env?.LOG_LEVEL) || 'warn'
};

// Safely determine mode regardless of whether we are in Vite or Node context (e.g. Playwright tests)
const mode = (typeof process !== 'undefined' && process.env?.NODE_ENV) || 'development';

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
} else if (mode === 'test') {
  options.level = (typeof process !== 'undefined' && process.env?.LOG_LEVEL) || 'warn';
}

const logger = pino(options);

export default logger;
