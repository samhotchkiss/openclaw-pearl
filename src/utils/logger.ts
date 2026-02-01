/**
 * Structured Logging System for Pearl
 * Provides correlation IDs, log levels, and structured data
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: Date;
  level: string;
  module: string;
  message: string;
  data?: any;
  correlationId?: string;
  error?: {
    message: string;
    stack: string;
    name: string;
  };
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: 'text' | 'json';
  sink?: (entry: LogEntry) => void;
}

const SENSITIVE_KEYS = [
  'apikey', 'api_key', 'password', 'secret', 'token', 
  'authorization', 'usercontent', 'content', 'credential'
];

function redactSensitiveData(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const redacted = Array.isArray(data) ? [] : {};
  
  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();
    
    if (SENSITIVE_KEYS.some(sensitiveKey => keyLower.includes(sensitiveKey))) {
      (redacted as any)[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      (redacted as any)[key] = redactSensitiveData(value);
    } else {
      (redacted as any)[key] = value;
    }
  }
  
  return redacted;
}

function serializeError(error: any): any {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return error;
}

export class Logger {
  private module: string;
  private level: LogLevel;
  private format: 'text' | 'json';
  private sink?: (entry: LogEntry) => void;
  private correlationId?: string;

  constructor(module: string, options: LoggerOptions = {}) {
    this.module = module;
    this.level = options.level ?? this.getLogLevelFromEnv();
    this.format = options.format ?? this.getLogFormatFromEnv();
    this.sink = options.sink;
  }

  private getLogLevelFromEnv(): LogLevel {
    const level = process.env.PEARL_LOG_LEVEL?.toLowerCase();
    switch (level) {
      case 'debug': return LogLevel.DEBUG;
      case 'info': return LogLevel.INFO;
      case 'warn': return LogLevel.WARN;
      case 'error': return LogLevel.ERROR;
      default: return LogLevel.INFO;
    }
  }

  private getLogFormatFromEnv(): 'text' | 'json' {
    return process.env.PEARL_LOG_FORMAT === 'json' ? 'json' : 'text';
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private log(level: LogLevel, levelName: string, message: string, data?: any): void {
    if (!this.shouldLog(level)) {
      return;
    }

    // Lazy evaluation: if data is a function, call it only when logging
    if (typeof data === 'function') {
      data = data();
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level: levelName,
      module: this.module,
      message,
      ...(this.correlationId && { correlationId: this.correlationId }),
    };

    if (data) {
      // Handle errors specially
      if (data.error) {
        entry.error = serializeError(data.error);
        entry.data = redactSensitiveData({ ...data, error: undefined });
      } else {
        entry.data = redactSensitiveData(data);
      }
      
      // If data contains an error at root level, put it in entry.data.error
      if (entry.error) {
        entry.data = { ...entry.data, error: entry.error };
      }
    }

    // Use custom sink if provided (for testing)
    if (this.sink) {
      this.sink(entry);
    }

    // Always output to console as well (unless using sink for testing)
    if (!this.sink || process.env.NODE_ENV !== 'test') {
      // Format and output to console
      const output = this.format === 'json' 
        ? JSON.stringify(entry)
        : this.formatTextLog(entry);

      // Use appropriate console method
      const consoleMethod = levelName === 'debug' ? console.debug :
                           levelName === 'info' ? console.info :
                           levelName === 'warn' ? console.warn :
                           console.error;

      consoleMethod(output);
    }
  }

  private formatTextLog(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const correlation = entry.correlationId ? ` [${entry.correlationId}]` : '';
    const data = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
    const error = entry.error ? ` ERROR: ${entry.error.message}` : '';
    
    return `${timestamp} [${entry.level.toUpperCase()}] [${entry.module}]${correlation} ${entry.message}${data}${error}`;
  }

  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, 'debug', message, data);
  }

  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, 'info', message, data);
  }

  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, 'warn', message, data);
  }

  error(message: string, data?: any): void {
    this.log(LogLevel.ERROR, 'error', message, data);
  }

  withCorrelation(correlationId: string): Logger {
    this.correlationId = correlationId;
    return this;
  }

  child(module: string): Logger {
    const childLogger = new Logger(module, {
      level: this.level,
      format: this.format,
      sink: this.sink,
    });
    childLogger.correlationId = this.correlationId;
    return childLogger;
  }
}

export function createLogger(module: string, options?: LoggerOptions): Logger {
  return new Logger(module, options);
}

// Default logger for the Pearl system
export const logger = createLogger('pearl');