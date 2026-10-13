import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/vercel-access-diagnostic.yml', 'utf8');
const match = workflow.match(/ {8}run: \|\n((?: {10}.*\n)+)/);
if (!match) throw new Error('missing diagnostic authority guard');
const guard = match[1].replace(/^ {10}/gm, '');
const sha = 'a'.repeat(40);

it.each(['ops-health.yml', 'vercel-access-diagnostic.yml'])('%s reads the nonsecret team ID from repository variables', (filename) => {
  const source = readFileSync(`.github/workflows/${filename}`, 'utf8');
  const team = source.match(/^\s+VERCEL_TEAM_ID: \$\{\{\s*(.*?)\s*\}\}/m)?.[1];
  expect(team).toContain('vars.VERCEL_TEAM_ID');
  expect(team).toContain('vars.VERCEL_ORG_ID');
  expect(team).not.toContain('secrets.');
  expect(source).toMatch(/VERCEL_ACCESS_TOKEN: \$\{\{\s*secrets\.VERCEL_ACCESS_TOKEN\s*\}\}/);
  expect(source).toMatch(/VERCEL_PROJECT_ID: \$\{\{\s*vars\.VERCEL_PROJECT_ID\s*\}\}/);
});

it.each([
  ['matching main, first attempt', 'refs/heads/main', sha, '1', 0],
  ['non-main with matching SHA', 'refs/heads/other', sha, '1', 1],
  ['main with wrong SHA', 'refs/heads/main', 'b'.repeat(40), '1', 1],
  ['main on rerun', 'refs/heads/main', sha, '2', 1],
])('workflow guard: %s', (_label, ref, actualSha, attempt, expectedExit) => {
  const result = spawnSync('bash', ['-e', '-c', guard], {
    env: { ...process.env, GITHUB_REF: ref, GITHUB_SHA: actualSha, EXPECTED_SHA: sha, GITHUB_RUN_ATTEMPT: attempt },
    encoding: 'utf8',
  });
  expect(result.status).toBe(expectedExit);
  expect(result.stdout).toBe('');
});
