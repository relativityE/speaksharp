import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ADAPTER_VERSION = 'vitest-3.2.4-raw-v1';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const canonicalPath = file => fs.realpathSync(file);

export function runtimeIdentity(root) {
  const packagePath = path.join(root, 'node_modules/vitest/package.json');
  if (!fs.existsSync(packagePath)) throw new Error('NOT RUN: installed Vitest dependencies unavailable');
  const require = createRequire(packagePath);
  const runnerPackage = require.resolve('@vitest/runner/package.json');
  const packages = [packagePath, runnerPackage].map(file => ({
    path: canonicalPath(file), sha256: digest(fs.readFileSync(file)),
    version: JSON.parse(fs.readFileSync(file, 'utf8')).version,
  }));
  if (packages.some(item => item.version !== '3.2.4')) throw new Error('Unsupported Vitest/runner version');
  const installedLock = path.join(root, 'node_modules/.pnpm/lock.yaml');
  return { adapter: ADAPTER_VERSION, node: process.version, platform: process.platform, arch: process.arch,
    execPath: canonicalPath(process.execPath), packages,
    vitestEntrySha256: digest(fs.readFileSync(path.join(root, 'node_modules/vitest/vitest.mjs'))),
    runnerEntrySha256: digest(fs.readFileSync(require.resolve('@vitest/runner'))),
    reporterSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))),
    // Installed pnpm lock is a different representation, recorded separately, never byte-compared.
    installedLockSha256: fs.existsSync(installedLock) ? digest(fs.readFileSync(installedLock)) : null };
}

function rawTasks(files) {
  const nodes = [];
  const visit = (task, ancestors = [], parentId = null) => {
    const result = task.result;
    nodes.push({ id: task.id, parentId, type: task.type, name: [...ancestors, task.name].filter(Boolean).join(' '),
      mode: task.mode, fails: !!task.fails, retry: task.retry || 0, repeats: task.repeats || 0,
      result: result ? { state: result.state, hooks: result.hooks || {}, errors: (result.errors || []).map(error => ({
        name: error.name, message: error.message, stack: error.stack || '',
      })), retryCount: result.retryCount || 0, repeatCount: result.repeatCount || 0,
      pending: !!result.pending } : null });
    for (const child of task.tasks || []) visit(child, task.filepath ? [] : [...ancestors, task.name], task.id);
  };
  for (const file of files) visit(file);
  return nodes;
}

// Supported (deprecated but present) raw callbacks in Vitest 3.2.4. Both terminal callbacks
// run in parallel; write only once both have arrived, regardless of their arrival order.
export default class EfficacyReporter {
  collected = [];
  collectionCalls = 0;
  finishedCalls = 0;
  endCalls = 0;
  timedOut = false;
  onInit() {
    this.binding = JSON.parse(process.env.TEST_EFFICACY_BINDING || 'null');
    if (!this.binding) throw new Error('Missing efficacy phase binding');
    this.observed = { command: [canonicalPath(process.execPath), ...process.argv.slice(1)],
      cwd: canonicalPath(process.cwd()), runtime: runtimeIdentity(process.cwd()) };
  }
  onCollected(files) {
    this.collectionCalls++;
    this.collected.push(...files.map(file => ({ file: canonicalPath(file.filepath),
      tests: rawTasks([file]).filter(task => task.type === 'test').map(({ id, name, mode }) => ({ id, name, mode })) })));
  }
  onProcessTimeout() { this.timedOut = true; this.write(); }
  onFinished(files, errors) {
    this.finishedCalls++;
    this.finished = { files: files.map(file => ({ file: canonicalPath(file.filepath), tasks: rawTasks([file]) })), errors };
    this.write();
  }
  onTestRunEnd(_modules, errors, reason) {
    this.endCalls++;
    this.ended = { errors, reason };
    this.write();
  }
  write() {
    if (!this.finished || !this.ended) return;
    fs.writeFileSync(process.env.TEST_EFFICACY_ENVELOPE, JSON.stringify({ schemaVersion: 2,
      binding: this.binding, observed: this.observed, collectionCalls: this.collectionCalls,
      collected: this.collected, finishedCalls: this.finishedCalls, endCalls: this.endCalls,
      finished: this.finished, ended: this.ended, timedOut: this.timedOut }));
  }
}
