#!/usr/bin/env node
/* Test double for osv-scanner. Emits $FAKE_OSV_STDOUT then exits/terminates as
 * configured by env, so process-level tests can exercise Gate 4's exit-code
 * handling without the real scanner. */
// Per-lockfile override: FAKE_OSV_STDOUT_DB is emitted for the tests/db lockfile so a test can prove
// each lockfile is independently gated.
const forDb = process.argv.some((a) => a.includes('tests/db/package-lock.json'));
const out = forDb && process.env.FAKE_OSV_STDOUT_DB != null ? process.env.FAKE_OSV_STDOUT_DB : process.env.FAKE_OSV_STDOUT;
if (out != null) process.stdout.write(out);
if (process.env.FAKE_OSV_SIGNAL) { process.kill(process.pid, process.env.FAKE_OSV_SIGNAL); }
process.exit(Number(process.env.FAKE_OSV_EXIT ?? '0'));
