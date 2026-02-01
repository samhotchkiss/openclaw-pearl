/**
 * Logger Tests - TDD for structured logging system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, createLogger, LogLevel, LogEntry } from '../src/utils/logger.js';

describe('Logger', () => {
  let logger: Logger;
  let mockConsole: any;
  let logEntries: LogEntry[] = [];

  beforeEach(() => {
    // Mock console methods
    mockConsole = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    };
    
    // Override global console
    global.console = mockConsole;
    
    // Clear log entries
    logEntries = [];
    
    // Create logger with custom sink for testing
    logger = createLogger('test', {
      level: LogLevel.DEBUG,
      sink: (entry: LogEntry) => logEntries.push(entry)
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Log Levels', () => {
    it('should respect minimum log level', () => {
      const prodLogger = createLogger('prod', { level: LogLevel.WARN });
      
      prodLogger.debug('debug message');
      prodLogger.info('info message'); 
      prodLogger.warn('warn message');
      prodLogger.error('error message');
      
      // Only warn and error should be logged in production
      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.info).not.toHaveBeenCalled();
      expect(mockConsole.warn).toHaveBeenCalledWith(expect.stringContaining('warn message'));
      expect(mockConsole.error).toHaveBeenCalledWith(expect.stringContaining('error message'));
    });

    it('should log all levels when set to DEBUG', () => {
      // Create a logger without custom sink to test console output
      const consoleLogger = createLogger('console-test', { level: LogLevel.DEBUG });
      
      consoleLogger.debug('debug message');
      consoleLogger.info('info message');
      consoleLogger.warn('warn message');
      consoleLogger.error('error message');
      
      expect(mockConsole.debug).toHaveBeenCalled();
      expect(mockConsole.info).toHaveBeenCalled();
      expect(mockConsole.warn).toHaveBeenCalled();
      expect(mockConsole.error).toHaveBeenCalled();
    });
  });

  describe('Structured Logging', () => {
    it('should support structured data in logs', () => {
      const context = { 
        requestId: 'req-123',
        userId: 'user-456',
        operation: 'memory-extraction'
      };
      
      logger.info('Processing request', context);
      
      expect(logEntries).toHaveLength(1);
      expect(logEntries[0]).toMatchObject({
        level: 'info',
        message: 'Processing request',
        module: 'test',
        data: context,
        timestamp: expect.any(Date),
      });
    });

    it('should handle errors with stack traces', () => {
      const error = new Error('Something went wrong');
      
      logger.error('Request failed', { error });
      
      expect(logEntries).toHaveLength(1);
      expect(logEntries[0].data.error).toMatchObject({
        message: 'Something went wrong',
        stack: expect.any(String),
      });
    });

    it('should not log sensitive data', () => {
      const sensitiveData = {
        apiKey: 'sk-1234567890',
        password: 'secret',
        authorization: 'Bearer token',
        userContent: 'private message'
      };
      
      logger.info('Request with sensitive data', sensitiveData);
      
      expect(logEntries[0].data).toMatchObject({
        apiKey: '[REDACTED]',
        password: '[REDACTED]',
        authorization: '[REDACTED]',
        userContent: '[REDACTED]',
      });
    });
  });

  describe('Request Correlation', () => {
    it('should include correlation ID when available', () => {
      const correlationId = 'corr-789';
      logger.withCorrelation(correlationId);
      
      logger.info('Correlated message');
      
      expect(logEntries[0]).toMatchObject({
        correlationId,
        message: 'Correlated message',
      });
    });

    it('should create child logger with inherited correlation', () => {
      const parentLogger = logger.withCorrelation('parent-123');
      const childLogger = parentLogger.child('child-module');
      
      childLogger.info('Child message');
      
      expect(logEntries[0]).toMatchObject({
        correlationId: 'parent-123',
        module: 'child-module',
        message: 'Child message',
      });
    });
  });

  describe('Configuration', () => {
    it('should respect PEARL_LOG_LEVEL environment variable', () => {
      const originalEnv = process.env.PEARL_LOG_LEVEL;
      process.env.PEARL_LOG_LEVEL = 'warn';
      
      const envLogger = createLogger('env-test');
      envLogger.debug('Should not appear');
      envLogger.warn('Should appear');
      
      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.warn).toHaveBeenCalled();
      
      // Restore
      if (originalEnv) {
        process.env.PEARL_LOG_LEVEL = originalEnv;
      } else {
        delete process.env.PEARL_LOG_LEVEL;
      }
    });

    it('should format logs as JSON when PEARL_LOG_FORMAT=json', () => {
      const originalFormat = process.env.PEARL_LOG_FORMAT;
      process.env.PEARL_LOG_FORMAT = 'json';
      
      const jsonLogger = createLogger('json-test');
      jsonLogger.info('JSON message', { test: true });
      
      const logCall = mockConsole.info.mock.calls[0][0];
      expect(() => JSON.parse(logCall)).not.toThrow();
      
      // Restore
      if (originalFormat) {
        process.env.PEARL_LOG_FORMAT = originalFormat;
      } else {
        delete process.env.PEARL_LOG_FORMAT;
      }
    });
  });

  describe('Performance', () => {
    it('should not evaluate expensive operations when log level filtered', () => {
      const expensiveOperation = vi.fn(() => ({ result: 'expensive' }));
      const warnLogger = createLogger('perf', { level: LogLevel.WARN });
      
      // Test that logger can accept a lazy evaluation function
      warnLogger.debug('Debug message', () => expensiveOperation());
      
      expect(expensiveOperation).not.toHaveBeenCalled();
    });
  });
});