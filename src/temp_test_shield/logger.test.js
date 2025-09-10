import { describe, it, expect } from 'vitest';
import logger from '../logger';

describe('Logger Module', () => {
  it('should create a logger instance', () => {
    expect(logger).toBeDefined();
  });

  it('should have standard logging methods', () => {
    expect(logger.info).toBeInstanceOf(Function);
    expect(logger.error).toBeInstanceOf(Function);
    expect(logger.warn).toBeInstanceOf(Function);
    expect(logger.debug).toBeInstanceOf(Function);
  });

  it('should not throw when logging methods are called', () => {
    expect(() => logger.info('test info')).not.toThrow();
    expect(() => logger.error('test error')).not.toThrow();
    expect(() => logger.warn('test warn')).not.toThrow();
    expect(() => logger.debug('test debug')).not.toThrow();
  });
});
