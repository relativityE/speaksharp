import pino from 'pino';

const logger = pino(
  import.meta.env.MODE === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        },
      }
    : {}
);

export default logger;
