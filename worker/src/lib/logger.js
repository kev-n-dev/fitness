// Structured debug logging for Cloudflare Workers.
//
// Configurable via env vars:
//   LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error' | 'off' (default: 'info')
//
// Usage:
//   import { createLogger, withRequestId, logMiddleware } from './lib/logger.js';
//   const log = createLogger('auth');
//   log.debug(env, 'challenge created', { cid, userId });
//   log.info(env, 'user logged in', { userId });
//   log.warn(env, 'rate limit approaching', { addr, remaining: 5 });
//   log.error(env, 'database error', { error: e.message });

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, off: 4 };

/**
 * Check if a log level is enabled for the given environment.
 * @param {object} env - Worker environment bindings
 * @param {string} level - The log level to check
 * @returns {boolean}
 */
function isLevelEnabled(env, level) {
  const configuredLevel = (env?.LOG_LEVEL || 'info').toLowerCase();
  const configuredNum = LEVELS[configuredLevel] ?? LEVELS.info;
  const levelNum = LEVELS[level] ?? LEVELS.info;
  return levelNum >= configuredNum;
}

/**
 * Format a log entry as a structured JSON string.
 * @param {string} level
 * @param {string} module
 * @param {string} message
 * @param {object} data
 * @returns {string}
 */
function formatLog(level, module, message, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    module,
    msg: message,
    ...data,
  };
  // Clean up undefined values
  for (const key of Object.keys(entry)) {
    if (entry[key] === undefined) delete entry[key];
  }
  return JSON.stringify(entry);
}

/**
 * Create a logger instance for a specific module.
 * @param {string} module - Module name (e.g., 'auth', 'sync', 'push')
 * @returns {object} Logger with debug, info, warn, error methods
 */
export function createLogger(module) {
  const log = (level, env, message, data = {}) => {
    if (!isLevelEnabled(env, level)) return;
    const formatted = formatLog(level, module, message, data);
    switch (level) {
      case 'debug':
      case 'info':
        console.log(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }
  };

  return {
    debug: (env, message, data) => log('debug', env, message, data),
    info: (env, message, data) => log('info', env, message, data),
    warn: (env, message, data) => log('warn', env, message, data),
    error: (env, message, data) => log('error', env, message, data),
    /**
     * Log with request context (adds requestId and userId if available).
     * @param {string} level
     * @param {object} c - Hono context
     * @param {string} message
     * @param {object} data
     */
    withContext: (level, c, message, data = {}) => {
      const reqId = c.get('requestId');
      const userId = c.get('userId');
      log(level, c.env, message, { ...data, requestId: reqId, userId });
    },
  };
}

/**
 * Generate a short request ID for tracing.
 * @returns {string}
 */
export function generateRequestId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hono middleware that adds request ID and logs request/response.
 * @returns {function}
 */
export function logMiddleware() {
  const log = createLogger('http');

  return async (c, next) => {
    const requestId = generateRequestId();
    c.set('requestId', requestId);

    const start = Date.now();
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;

    // Log incoming request at debug level
    log.debug(c.env, 'request started', {
      requestId,
      method,
      path,
      userAgent: c.req.header('User-Agent')?.slice(0, 100),
    });

    try {
      await next();
    } catch (err) {
      const duration = Date.now() - start;
      log.error(c.env, 'request error', {
        requestId,
        method,
        path,
        duration,
        error: err?.message,
        stack: err?.stack?.split('\n').slice(0, 3).join(' | '),
      });
      throw err;
    }

    const duration = Date.now() - start;
    const status = c.res.status;

    // Log response: info for success, warn for client errors, error for server errors
    if (status >= 500) {
      log.error(c.env, 'request completed', { requestId, method, path, status, duration });
    } else if (status >= 400) {
      log.warn(c.env, 'request completed', { requestId, method, path, status, duration });
    } else {
      log.debug(c.env, 'request completed', { requestId, method, path, status, duration });
    }
  };
}

/**
 * Log a D1 query at debug level.
 * @param {object} env
 * @param {string} operation - e.g., 'getUserById', 'updateUser'
 * @param {object} params - Query parameters (sanitized)
 * @param {number} duration - Query duration in ms
 */
export function logQuery(env, operation, params = {}, duration) {
  if (!isLevelEnabled(env, 'debug')) return;
  const log = createLogger('db');
  log.debug(env, 'query executed', { operation, ...params, duration });
}

/**
 * Log an external service call (R2, KV, etc.).
 * @param {object} env
 * @param {string} service - e.g., 'kv', 'r2', 'push'
 * @param {string} operation
 * @param {object} params
 * @param {number} duration
 * @param {boolean} success
 */
export function logExternal(env, service, operation, params = {}, duration, success = true) {
  const log = createLogger(service);
  const level = success ? 'debug' : 'warn';
  log[level](env, operation, { ...params, duration, success });
}

/**
 * Wrap a function to log its execution time at debug level.
 * @param {object} env
 * @param {string} module
 * @param {string} operation
 * @param {function} fn
 * @returns {Promise<any>}
 */
export async function withTiming(env, module, operation, fn) {
  const start = Date.now();
  const log = createLogger(module);
  try {
    const result = await fn();
    const duration = Date.now() - start;
    log.debug(env, `${operation} completed`, { duration });
    return result;
  } catch (err) {
    const duration = Date.now() - start;
    log.error(env, `${operation} failed`, { duration, error: err?.message });
    throw err;
  }
}

// Export a default logger for quick use
export const logger = {
  debug: (env, msg, data) => createLogger('app').debug(env, msg, data),
  info: (env, msg, data) => createLogger('app').info(env, msg, data),
  warn: (env, msg, data) => createLogger('app').warn(env, msg, data),
  error: (env, msg, data) => createLogger('app').error(env, msg, data),
};
