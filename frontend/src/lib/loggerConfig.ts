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
