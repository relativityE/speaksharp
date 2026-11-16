import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import process from 'node:process';

// Runs a Node script that prints one JSON receipt on stdout, in its own process, and resolves with it.
// The caller's Vitest worker stays responsive while the script blocks for minutes. There is deliberately
// no kill timeout: an efficacy coordinator is the only owner able to drain its detached phase groups and
// remove its temporary copy, and each phase it runs is already bounded. If the caller's test times out,
// the coordinator keeps running to its own cleanup. The receipt travels on stdout, so no receipt file or
// directory exists to be left behind.
export function runEfficacyChild(script, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const out = Buffer.concat(stdout).toString('utf8');
      if (code !== 0) {
        reject(new Error(`${script} exited ${code ?? signal}: ${Buffer.concat(stderr).toString('utf8').slice(-4000)}`));
        return;
      }
      try { resolve(JSON.parse(out)); }
      catch (error) { reject(new Error(`${script} printed no JSON receipt`, { cause: error })); }
    });
  });
}
