// scripts/custom-e2e-runner.ts
import { spawn, ChildProcess } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

interface ProcessInfo {
  pid: number;
  command: string;
  startTime: Date;
  status: 'starting' | 'running' | 'stopping' | 'stopped';
}

class E2ETestRunner {
  private processes: Map<string, ProcessInfo> = new Map();
  private logFile: string;
  private watchdogInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.logFile = path.join(process.cwd(), 'e2e-runner.log');
    this.initializeLogger();
  }

  private initializeLogger() {
    const timestamp = new Date().toISOString();
    fs.writeFileSync(this.logFile, `=== E2E Test Runner Started: ${timestamp} ===\n`);
  }

  private log(message: string, level: 'INFO' | 'ERROR' | 'WARN' = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${level}: ${message}\n`;

    console.log(logEntry.trim());
    fs.appendFileSync(this.logFile, logEntry);
  }

  private async checkProcessHealth(name: string, info: ProcessInfo): Promise<boolean> {
    try {
      // Check if PID still exists
      process.kill(info.pid, 0);

      // Additional health checks
      if (name === 'vite') {
        try {
          const response = await fetch('http://localhost:5173/');
          return response.ok;
        } catch {
          return false;
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  private startWatchdog() {
    this.log('Starting process watchdog...');

    this.watchdogInterval = setInterval(async () => {
      for (const [name, info] of this.processes.entries()) {
        if (info.status === 'running') {
          const isHealthy = await this.checkProcessHealth(name, info);

          if (!isHealthy) {
            this.log(`WATCHDOG: Process ${name} (PID: ${info.pid}) appears unhealthy`, 'WARN');
            info.status = 'stopped';
          } else {
            const uptime = Date.now() - info.startTime.getTime();
            this.log(`WATCHDOG: Process ${name} (PID: ${info.pid}) healthy, uptime: ${Math.floor(uptime/1000)}s`);
          }
        }
      }
    }, 5000); // Check every 5 seconds
  }

  private stopWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
      this.log('Watchdog stopped');
    }
  }

  private async startProcess(name: string, command: string, args: string[] = []): Promise<ProcessInfo> {
    this.log(`Starting ${name}: ${command} ${args.join(' ')}`);

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const processInfo: ProcessInfo = {
      pid: child.pid!,
      command: `${command} ${args.join(' ')}`,
      startTime: new Date(),
      status: 'starting'
    };

    this.processes.set(name, processInfo);

    // Log stdout/stderr
    child.stdout?.on('data', (data) => {
      this.log(`${name}[${processInfo.pid}] STDOUT: ${data.toString().trim()}`);
    });

    child.stderr?.on('data', (data) => {
      this.log(`${name}[${processInfo.pid}] STDERR: ${data.toString().trim()}`, 'ERROR');
    });

    child.on('spawn', () => {
      processInfo.status = 'running';
      this.log(`${name} started successfully with PID: ${processInfo.pid}`);
    });

    child.on('exit', (code, signal) => {
      processInfo.status = 'stopped';
      this.log(`${name}[${processInfo.pid}] exited with code: ${code}, signal: ${signal}`);
    });

    child.on('error', (error) => {
      processInfo.status = 'stopped';
      this.log(`${name}[${processInfo.pid}] error: ${error.message}`, 'ERROR');
    });

    return processInfo;
  }

  private async waitForServer(url: string, timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          this.log(`Server at ${url} is ready`);
          return true;
        }
      } catch {
        // Server not ready yet
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      this.log(`Waiting for server at ${url}...`);
    }

    this.log(`Server at ${url} failed to start within ${timeoutMs}ms`, 'ERROR');
    return false;
  }

  private async killProcess(name: string): Promise<void> {
    const processInfo = this.processes.get(name);
    if (!processInfo) return;

    this.log(`Stopping ${name} (PID: ${processInfo.pid})...`);
    processInfo.status = 'stopping';

    try {
      // Try graceful shutdown first
      process.kill(processInfo.pid, 'SIGTERM');

      // Wait for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if still running
      try {
        process.kill(processInfo.pid, 0);
        // Still running, force kill
        this.log(`Force killing ${name} (PID: ${processInfo.pid})`, 'WARN');
        process.kill(processInfo.pid, 'SIGKILL');
      } catch {
        // Process already died
      }

      processInfo.status = 'stopped';
      this.log(`${name} stopped successfully`);
    } catch (error: any) {
      this.log(`Error stopping ${name}: ${error.message}`, 'ERROR');
    }
  }

  async startDevServer(): Promise<boolean> {
    try {
      await this.startProcess('vite', 'pnpm', ['run', 'dev:test']);
      const serverReady = await this.waitForServer('http://localhost:5173');

      if (serverReady) {
        this.startWatchdog();
        return true;
      }

      return false;
    } catch (error: any) {
      this.log(`Failed to start dev server: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async runTests(): Promise<boolean> {
    this.log('Starting Playwright tests...');

    try {
      const testProcess = await this.startProcess('playwright', 'npx', ['playwright', 'test', '--workers=1']);

      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const info = this.processes.get('playwright');
          if (info?.status === 'stopped') {
            clearInterval(checkInterval);
            // Determine success based on your needs
            resolve(true);
          }
        }, 1000);

        // Timeout after 5 minutes
        setTimeout(() => {
          clearInterval(checkInterval);
          this.log('Test execution timed out', 'ERROR');
          this.killProcess('playwright');
          resolve(false);
        }, 300000);
      });
    } catch (error: any) {
      this.log(`Failed to run tests: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async cleanup(): Promise<void> {
    this.log('Starting cleanup...');
    this.stopWatchdog();

    const processNames = Array.from(this.processes.keys());
    for (const name of processNames) {
      await this.killProcess(name);
    }

    this.log('Cleanup completed');
    this.generateReport();
  }

  private generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      processes: Array.from(this.processes.entries()).map(([name, info]) => ({
        name,
        pid: info.pid,
        command: info.command,
        startTime: info.startTime,
        status: info.status,
        uptimeMs: Date.now() - info.startTime.getTime()
      }))
    };

    fs.writeFileSync('e2e-report.json', JSON.stringify(report, null, 2));
    this.log(`Report generated: e2e-report.json`);
  }

  async run(): Promise<boolean> {
    try {
      this.log('=== E2E Test Suite Starting ===');

      // Setup signal handlers for cleanup
      process.on('SIGINT', () => this.cleanup());
      process.on('SIGTERM', () => this.cleanup());

      // Start dev server
      const serverStarted = await this.startDevServer();
      if (!serverStarted) {
        await this.cleanup();
        return false;
      }

      // Run tests
      const testsSucceeded = await this.runTests();

      // Cleanup
      await this.cleanup();

      this.log(`=== E2E Test Suite Completed: ${testsSucceeded ? 'SUCCESS' : 'FAILURE'} ===`);
      return testsSucceeded;
    } catch (error: any) {
      this.log(`Fatal error: ${error.message}`, 'ERROR');
      await this.cleanup();
      return false;
    }
  }
}

// Usage
if (require.main === module) {
  const runner = new E2ETestRunner();
  runner.run().then(success => {
    process.exit(success ? 0 : 1);
  });
}
