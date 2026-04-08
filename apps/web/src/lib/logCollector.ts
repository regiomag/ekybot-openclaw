// Log Collector - captures console logs, errors, and network failures
// Stores last 1000 entries for bug reports

interface LogEntry {
  timestamp: string;
  type: 'log' | 'warn' | 'error' | 'network' | 'unhandled';
  message: string;
  stack?: string;
}

class LogCollector {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;
  private initialized = false;

  init() {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    // Intercept console methods
    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };

    console.log = (...args) => {
      this.addLog('log', args.map(this.stringify).join(' '));
      originalConsole.log(...args);
    };

    console.warn = (...args) => {
      this.addLog('warn', args.map(this.stringify).join(' '));
      originalConsole.warn(...args);
    };

    console.error = (...args) => {
      this.addLog('error', args.map(this.stringify).join(' '));
      originalConsole.error(...args);
    };

    // Capture unhandled errors
    window.addEventListener('error', (event) => {
      this.addLog('unhandled', event.message, event.error?.stack);
    });

    // Capture unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.addLog('unhandled', `Unhandled Promise: ${this.stringify(event.reason)}`);
    });

    // Intercept fetch for network errors
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      let url = 'unknown';
      const input = args[0];
      if (typeof input === 'string') {
        url = input;
      } else if (input instanceof URL) {
        url = input.href;
      } else if (input instanceof Request) {
        url = input.url;
      }
      try {
        const response = await originalFetch(...args);
        if (!response.ok) {
          this.addLog('network', `HTTP ${response.status}: ${url}`);
        }
        return response;
      } catch (error) {
        this.addLog('network', `Network error: ${url} - ${this.stringify(error)}`);
        throw error;
      }
    };

    this.addLog('log', '=== LogCollector initialized ===');
  }

  private stringify(obj: unknown): string {
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    if (typeof obj === 'string') return obj;
    if (obj instanceof Error) return `${obj.name}: ${obj.message}`;
    try {
      return JSON.stringify(obj, null, 0);
    } catch {
      return String(obj);
    }
  }

  private addLog(type: LogEntry['type'], message: string, stack?: string) {
    this.logs.push({
      timestamp: new Date().toISOString(),
      type,
      message: message.slice(0, 2000), // Limit message size
      stack: stack?.slice(0, 1000),
    });

    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getLogsAsString(): string {
    const lines: string[] = [];
    
    for (const log of this.logs) {
      const prefix = {
        log: '[LOG]',
        warn: '[WARN]',
        error: '[ERROR]',
        network: '[NET]',
        unhandled: '[CRASH]',
      }[log.type];
      
      lines.push(`${log.timestamp} ${prefix} ${log.message}`);
      if (log.stack) {
        lines.push(`  Stack: ${log.stack}`);
      }
    }
    
    return lines.join('\n');
  }

  // Get app state for debugging
  getAppState(): Record<string, unknown> {
    try {
      const state: Record<string, unknown> = {};
      
      // Get localStorage keys (sanitized - no tokens)
      const safeKeys = ['ekybot-locale', 'ekybot-save-conversations', 'ekybot-messages'];
      for (const key of safeKeys) {
        const value = localStorage.getItem(key);
        if (value) {
          if (key === 'ekybot-messages') {
            // Just count messages, don't include content
            try {
              const messages = JSON.parse(value);
              state[key] = `${Array.isArray(messages) ? messages.length : 0} messages`;
            } catch {
              state[key] = 'parse error';
            }
          } else {
            state[key] = value;
          }
        }
      }

      // Browser state
      state.url = window.location.href;
      state.screenSize = `${window.innerWidth}x${window.innerHeight}`;
      state.online = navigator.onLine;
      state.memory = (performance as any).memory?.usedJSHeapSize 
        ? `${Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024)}MB`
        : 'N/A';
      
      return state;
    } catch {
      return { error: 'Failed to collect app state' };
    }
  }

  // Generate full bug report
  generateReport(): string {
    const sections: string[] = [];
    
    sections.push('=== EKYBOT BUG REPORT ===');
    sections.push(`Generated: ${new Date().toISOString()}`);
    sections.push('');
    
    sections.push('=== APP STATE ===');
    const state = this.getAppState();
    for (const [key, value] of Object.entries(state)) {
      sections.push(`${key}: ${value}`);
    }
    sections.push('');
    
    sections.push('=== BROWSER INFO ===');
    sections.push(`User Agent: ${navigator.userAgent}`);
    sections.push(`Language: ${navigator.language}`);
    sections.push(`Platform: ${navigator.platform}`);
    sections.push(`Cookies Enabled: ${navigator.cookieEnabled}`);
    sections.push('');
    
    sections.push(`=== LOGS (Last ${this.logs.length} entries) ===`);
    sections.push(this.getLogsAsString());
    
    return sections.join('\n');
  }

  clear() {
    this.logs = [];
  }
}

// Singleton
export const logCollector = new LogCollector();
