import pino from 'pino';

const logger = pino({
  level: import.meta.env.PROD ? 'warn' : 'info',
  transport:
    import.meta.env.MODE === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        }
      : undefined,
});

export default logger;
