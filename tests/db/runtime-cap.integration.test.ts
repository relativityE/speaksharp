import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (...parts: string[]) => readFileSync(resolve(process.cwd(), ...parts), 'utf8');

describe('#1290 server-authoritative recording cap', () => {
  it('executes the adversarial 600-second matrix in PGlite', async () => {
    const db = new PGlite();
    await db.exec(read('tests', 'db', 'trial-journey-bootstrap.sql'));
    await db.exec(read('backend', 'supabase', 'migrations', '20260812040000_thirty_day_trial_lifecycle_1282.sql'));
    await db.exec(read('backend', 'supabase', 'migrations', '20260812041000_trial_expiry_fail_closed_1282.sql'));
    await db.exec(read('backend', 'supabase', 'migrations', '20260812041500_flawless_launch_runtime_convergence_1290.sql'));
    await expect(db.exec(read('tests', 'db', 'runtime-cap-matrix.sql'))).resolves.toBeDefined();
  }, 30_000);
});
