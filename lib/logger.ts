/**
 * StudyFlow Centralized Logging Utility
 * Supports environmental log levels, structured output, and production safety.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const IS_DEV = process.env.NODE_ENV !== 'production';

// In production, we only print warnings and errors to avoid console spam
const ENABLED_LEVELS: Record<LogLevel, boolean> = {
  debug: IS_DEV,
  info: IS_DEV, // keep info light in production, or toggle as needed
  warn: true,
  error: true,
};

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `[StudyFlow] [${timestamp}] [${level.toUpperCase()}] ${message}`;
}

export const logger = {
  debug(message: string, ...args: any[]) {
    if (ENABLED_LEVELS.debug) {
      console.log(formatMessage('debug', message), ...args);
    }
  },

  info(message: string, ...args: any[]) {
    if (ENABLED_LEVELS.info) {
      console.info(formatMessage('info', message), ...args);
    }
  },

  warn(message: string, ...args: any[]) {
    if (ENABLED_LEVELS.warn) {
      console.warn(formatMessage('warn', message), ...args);
    }
  },

  error(message: string, err?: any, ...args: any[]) {
    if (ENABLED_LEVELS.error) {
      const formatted = formatMessage('error', message);
      if (err) {
        console.error(formatted, err, ...args);
      } else {
        console.error(formatted, ...args);
      }
    }
  }
};
