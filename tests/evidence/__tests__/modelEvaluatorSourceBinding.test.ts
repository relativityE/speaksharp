import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readSourceBinding, assertSameSource, assertServedRelease, sha256, viteRawSource } from '../../../scripts/model-evaluator/source-binding';
import { prepareControlInput } from '../../../scripts/model-evaluator/controls';

describe('model evaluator source and degraded-input binding', () => {
  it('binds git/tree/lock and refuses tracked, untracked and lock drift without reading ignored secrets', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'ss-model-source-')));
    try {
      mkdirSync(join(root, 'frontend/src'), { recursive: true });
      writeFileSync(join(root, 'frontend/src/runtime.ts'), 'export const version=1;\n');
      writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
      writeFileSync(join(root, '.gitignore'), '.env\n');
      writeFileSync(join(root, '.env'), 'PRIVATE_TEST_VALUE=never-read\n');
      const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
      git('init', '-q'); git('add', '.');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'source fixture');
      const before = readSourceBinding(root);
      expect(before.head).toMatch(/^[a-f0-9]{40}$/); expect(before.tree).toMatch(/^[a-f0-9]{40}$/);
      expect(before.lockSha256).toBe(sha256('lockfileVersion: 9\n'));
      expect(before.files.some(file => file.path === '.env')).toBe(false);
      writeFileSync(join(root, '.env'), 'PRIVATE_TEST_VALUE=changed-ignored\n');
      expect(() => assertSameSource(before, readSourceBinding(root))).not.toThrow();
      writeFileSync(join(root, 'frontend/src/runtime.ts'), 'export const version=2;\n');
      expect(() => assertSameSource(before, readSourceBinding(root))).toThrow('source_changed');
      writeFileSync(join(root, 'frontend/src/runtime.ts'), 'export const version=1;\n');
      writeFileSync(join(root, 'frontend/src/untracked.ts'), 'export {};');
      expect(() => assertSameSource(before, readSourceBinding(root))).toThrow('source_changed');
      writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: changed\n');
      expect(readSourceBinding(root).lockSha256).not.toBe(before.lockSha256);
      symlinkSync(join(root, '.env'), join(root, 'frontend/src/alias.ts'));
      expect(() => readSourceBinding(root)).toThrow('source_file_not_regular');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('refuses a stale/missing served release and parses raw source as data only', () => {
    const expected = { head: 'a'.repeat(40), tree: 'b'.repeat(40), lockSha256: 'c'.repeat(64), worktreeSha256: 'd'.repeat(64), files: [] };
    expect(() => assertServedRelease(expected, expected.head)).not.toThrow();
    for (const actual of [null, 'dev', 'e'.repeat(40)]) expect(() => assertServedRelease(expected, actual)).toThrow('served_release');
    const source = 'export const model = "real source";\n';
    expect(viteRawSource(`export default ${JSON.stringify(source)};\n`)).toBe(source);
    expect(viteRawSource('export default `line one\\nline two`;')).toBe('line one\nline two');
    expect(viteRawSource('export default `literal \\${model}`;')).toBe('literal ${model}');
    expect(() => viteRawSource('export default `executed ${model}`;')).toThrow('served_raw_source');
    expect(viteRawSource('import "refresh"; export default "source"; throw new Error("never executed");')).toBe('source');
    expect(() => viteRawSource('export default "one"; export default "two";')).toThrow('served_raw_source');
    expect(() => viteRawSource('<html>fallback</html>')).toThrow('served_raw_source');
    expect(() => viteRawSource('export default (() => "forged")();')).toThrow('served_raw_source');
  });

  it.each(['mute', 'prefix-250ms'] as const)('binds %s to real transformed PCM, keeps original input and refuses source/output tampering', kind => {
    const input = Float32Array.from({ length: 8000 }, (_, index) => Math.sin(index / 20) * 0.3);
    const original = input.slice();
    const expected = kind === 'mute' ? new Float32Array(input.length) : input.slice(0, 4000);
    const hash = (pcm: Float32Array) => sha256(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    const control = { kind, sourcePcmSha256: hash(input) };
    expect(prepareControlInput(input, hash(expected), control)).toEqual(expected);
    expect(input).toEqual(original);
    expect(() => prepareControlInput(input, hash(expected), { ...control, sourcePcmSha256: '0'.repeat(64) })).toThrow('control_source_pcm');
    expect(() => prepareControlInput(input, '0'.repeat(64), control)).toThrow('PCM digest mismatch');
  });
});
