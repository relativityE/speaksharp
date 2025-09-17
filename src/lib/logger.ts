import pino, { LoggerOptions } from 'pino';

const options: LoggerOptions = {};

if (import.meta.env.MODE === 'development') {
  options.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  };
} else if (import.meta.env.MODE === 'test') {
  options.level = 'silent';
}

const logger = pino(options);

export default logger;
