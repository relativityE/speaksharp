// Pino uses export = and requires esModuleInterop, which tsc sometimes misses in isolation
// Note: Vite automatically resolves this to pino/browser.js via the 'browser' field in pino/package.json
import pino from 'pino';
import { LoggerOptions } from 'pino';

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

export const resolveLoggerLevel = ({
  explicitLevel,
  mode,
}: {
  explicitLevel?: string | null;
  mode?: string | null;
}): LoggerOptions['level'] => {
  if (explicitLevel && LOG_LEVELS.has(explicitLevel)) {
    return explicitLevel as LoggerOptions['level'];
  }

  if (mode === 'development') {
    return 'info';
  }

  return 'warn';
};

const readViteEnv = (key: string): string | undefined => {
  return (import.meta.env as Record<string, string | undefined>)[key];
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
