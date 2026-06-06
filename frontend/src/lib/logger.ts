// Pino uses export = and requires esModuleInterop, which tsc sometimes misses in isolation
// Note: Vite automatically resolves this to pino/browser.js via the 'browser' field in pino/package.json
import pino from 'pino';
import { LoggerOptions } from 'pino';
import { resolveLoggerLevel } from './loggerConfig';

const readViteEnv = (key: string): string | undefined => {
  return (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.[key];
};

const mode =
  readViteEnv('MODE') ||
  (typeof process !== 'undefined' && process.env?.NODE_ENV) ||
  'production';
const explicitLevel =
  readViteEnv('VITE_LOG_LEVEL') ||
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
