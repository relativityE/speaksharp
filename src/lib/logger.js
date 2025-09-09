import pino from 'pino';

const options = {};

if (import.meta.env.MODE === 'development') {
  options.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  };
} else if (import.meta.env.MODE === 'test' || process.env.NODE_ENV === 'test') {
  options.level = 'silent';
}

const logger = pino(options);

export default logger;
