/**
 * Log capture utility for debugging
 * Captures console.log/error/warn and stores last 500 entries
 */

const MAX_LOGS = 500;
const logs: { time: string; level: string; args: string }[] = [];

// Only run in browser
if (typeof window !== 'undefined') {
  const originalConsole = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
  };

  const captureLog = (level: string, ...args: any[]) => {
    const time = new Date().toISOString();
    const argsStr = args.map(a => {
      try {
        return typeof a === 'object' ? JSON.stringify(a) : String(a);
      } catch {
        return String(a);
      }
    }).join(' ');
    
    logs.push({ time, level, args: argsStr });
    if (logs.length > MAX_LOGS) {
      logs.shift();
    }
  };

  console.log = (...args: any[]) => {
    captureLog('log', ...args);
    originalConsole.log(...args);
  };

  console.error = (...args: any[]) => {
    captureLog('error', ...args);
    originalConsole.error(...args);
  };

  console.warn = (...args: any[]) => {
    captureLog('warn', ...args);
    originalConsole.warn(...args);
  };
}

export function getCapturedLogs(): string {
  return logs.map(l => `[${l.time}] [${l.level}] ${l.args}`).join('\n');
}

export function getLastLogs(count: number = 100): string {
  return logs.slice(-count).map(l => `[${l.time}] [${l.level}] ${l.args}`).join('\n');
}
