// Debug logger with 1000 line buffer
const MAX_LOGS = 1000;
const logs: string[] = [];

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function formatLog(level: LogLevel, component: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] [${component}] ${message}${dataStr}`;
}

export function debugLog(level: LogLevel, component: string, message: string, data?: unknown) {
  const logLine = formatLog(level, component, message, data);
  
  // Add to buffer
  logs.push(logLine);
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
  
  // Also console log
  const consoleFn = level === 'error' ? console.error : 
                    level === 'warn' ? console.warn : 
                    level === 'debug' ? console.debug : console.log;
  consoleFn(`[${component}]`, message, data ?? '');
}

export function getLogs(): string[] {
  return [...logs];
}

export function getLogsAsString(): string {
  return logs.join('\n');
}

export function clearLogs() {
  logs.length = 0;
}

// Convenience functions
export const logger = {
  debug: (component: string, message: string, data?: unknown) => debugLog('debug', component, message, data),
  info: (component: string, message: string, data?: unknown) => debugLog('info', component, message, data),
  warn: (component: string, message: string, data?: unknown) => debugLog('warn', component, message, data),
  error: (component: string, message: string, data?: unknown) => debugLog('error', component, message, data),
};

// Capture unhandled errors
if (typeof window !== 'undefined') {
  window.onerror = (message, source, lineno, colno, error) => {
    debugLog('error', 'window', `Unhandled error: ${message}`, { source, lineno, colno, stack: error?.stack });
    return false;
  };
  
  window.onunhandledrejection = (event) => {
    debugLog('error', 'window', `Unhandled promise rejection: ${event.reason}`, { reason: event.reason });
  };
}

export default logger;
