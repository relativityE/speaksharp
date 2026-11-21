// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyIntegrationCheckout } from '../../scripts/lib/ciBaseOnlyEvidence.mjs';
import { inspectBaseOnlyCiInputs } from '../../scripts/lib/ciCarryInputIdentity.mjs';

function graph(files, { candidateEdit = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ci-carry-inputs-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
  const commit = (name) => { git('add', '.'); git('commit', '-qm', name); return git('rev-parse', 'HEAD'); };
  git('init', '-q');
  write('scripts/touched-by-pr.mjs', 'before\n');
  const oldBase = commit('old base');
  git('branch', 'integration');
  write('scripts/touched-by-pr.mjs', 'same change\n');
  const oldHead = commit('reviewed candidate');
  git('checkout', '-q', 'integration');
  for (const name of files) write(name, 'landed outside the candidate\n');
  git('add', '.'); git('commit', '--allow-empty', '-qm', 'base advance');
  const newBase = git('rev-parse', 'HEAD');
  git('merge', '--no-ff', '-qm', 'base refresh', oldHead);
  if (candidateEdit) { write('scripts/touched-by-pr.mjs', 'changed patch\n'); commit('edit'); }
  const newHead = git('rev-parse', 'HEAD');
  return { root, oldBase, oldHead, newBase, newHead, clean: () => rmSync(root, { recursive: true, force: true }) };
}

describe('conservative engineering source verification for a base-only refresh', () => {
  it('holds on the concrete #1914 classes despite an identical candidate patch; smoke scope is only advisory', () => {
    const paths = ['tests/live/helpers/rwtAcceptance.ts','tests/live/helpers/rwtAdverseJourney.ts',
      'tests/live/helpers/rwtPracticeConsent.ts','tests/unit/rwtMicDeniedJ7a.test.ts','tools/cloud-test/scripts/validate_rwt_release_binding.cjs'];
    const f = graph(paths);
    try {
      const facts = inspectBaseOnlyCiInputs(f);
      expect(facts).toMatchObject({ status: 'HOLD', reason: 'engineering-inputs-changed-or-unproven', smokeFootprint: 'NO_DIRECT_OVERLAP' });
      expect(facts.changed.map(item => [item.file, item.engineering])).toEqual(paths.map((file, n) =>
        [file, n < 3 ? 'live-helper-source' : n === 3 ? 'unit-test-source' : 'cloud-runner-source']));
      expect(facts.scope).toContain('no CI qualification');
    } finally { f.clean(); }
  });

  it.each(['frontend/src/App.tsx','backend/supabase/config.toml','tests/live/helpers/runOwnedCleanup.ts','unknown.generated'])(
    'identifies %s as an unproved smoke input', (path) => {
      const f = graph([path]);
      try {
        expect(inspectBaseOnlyCiInputs(f)).toMatchObject({ status: 'HOLD', smokeFootprint: 'POSSIBLE_CHANGE' });
      } finally { f.clean(); }
    });

  it('an empty-tree advance establishes unchanged input facts, never a status pass', () => {
    const f = graph([]);
    try {
      expect(inspectBaseOnlyCiInputs(f)).toMatchObject({ status: 'INPUT_MATCH', reason: 'tree-and-patch-identical',
        smokeFootprint: 'NO_DIRECT_OVERLAP', changed: [] });
    } finally { f.clean(); }
  });

  it('rejects actual candidate changes and non-ancestor bases', () => {
    const f = graph([], { candidateEdit: true });
    try {
      expect(inspectBaseOnlyCiInputs(f)).toEqual({ status: 'HOLD', reason: 'candidate-patch-changed' });
      expect(inspectBaseOnlyCiInputs({ ...f, oldBase: f.oldHead, oldHead: f.newBase }))
        .toEqual({ status: 'HOLD', reason: 'git-input-unproven' });
    } finally { f.clean(); }
  });
});

it('binds reuse to the real synthetic PR merge checkout and identical prior tree',()=>{
  for (const files of [[],['new-source.ts']]) {
    const f = graph(files);
    try {
      const git = (...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],
        {cwd:f.root,encoding:'utf8'}).trim();
      const merged = git('commit-tree',git('rev-parse',`${f.newHead}^{tree}`),'-p',f.newBase,'-p',f.newHead,'-m','GitHub test merge');
      git('checkout','-q','--detach',merged);
      expect(verifyIntegrationCheckout(f.root,f.newBase,f.newHead,merged,f.oldHead)).toBe(files.length===0);
      expect(verifyIntegrationCheckout(f.root,f.oldBase,f.newHead,merged,f.oldHead)).toBe(false);
    } finally { f.clean(); }
  }
});
