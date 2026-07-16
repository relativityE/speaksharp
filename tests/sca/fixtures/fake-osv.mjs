#!/usr/bin/env node
/* Test double for osv-scanner. Emits $FAKE_OSV_STDOUT then exits/terminates as
 * configured by env, so process-level tests can exercise Gate 4's exit-code
 * handling without the real scanner. */
if (process.env.FAKE_OSV_STDOUT != null) process.stdout.write(process.env.FAKE_OSV_STDOUT);
if (process.env.FAKE_OSV_SIGNAL) { process.kill(process.pid, process.env.FAKE_OSV_SIGNAL); }
process.exit(Number(process.env.FAKE_OSV_EXIT ?? '0'));
