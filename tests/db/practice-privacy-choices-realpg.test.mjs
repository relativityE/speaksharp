// Native Postgres with synthetic existing sessions and a stand-in for the previous coaching persistence RPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migration = fileURLToPath(new URL('../../backend/supabase/migrations/20261117105700_practice_privacy_choices_1835.sql', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/practice-privacy-choices-1835.sql', import.meta.url));

test('practice privacy: native owner choices, metrics-only completion and revision-bound coaching persistence', () => {
  const names = ['initdb', 'pg_ctl', 'psql'];
  let bin;
  for (const directory of [...(process.env.PATH ?? '').split(delimiter), '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/18/bin']) {
    if (!isAbsolute(directory)) continue;
    try {
      bin = Object.fromEntries(names.map((name) => {
        const file = realpathSync(join(directory, name));
        accessSync(file, constants.X_OK);
        return [name, file];
      }));
      break;
    } catch { /* Only a complete installed toolchain can prove this. */ }
  }
  assert.ok(bin, 'NOT RUN: isolated native Postgres toolchain unavailable');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'privacy-1835-')));
  const data = join(root, 'db');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))),
    PGHOST: root, PGPORT: '5432', PGUSER: 'privacy_fixture_admin', PGDATABASE: 'postgres' };
  const run = (tool, args) => execFileSync(bin[tool], args, { env, encoding: 'utf8', timeout: 30_000 });
  let started = false;
  try {
    run('initdb', ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale']);
    run('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-w', 'start', '-o', `-h '' -k ${root} -p 5432`]);
    started = true;
    assert.equal(run('psql', ['-XqAt', '-c', "SELECT current_setting('data_directory')"]).trim(), data);
    run('psql', ['-Xq', '-v', 'ON_ERROR_STOP=1', '-v', `migration=${migration}`, '-f', fixture]);
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    rmSync(root, { recursive: true, force: true });
  }
});
