'use strict';
// Test-only preload for NON-Linux hosts: run-guarded.cjs's stop() lists owned descendants from /proc (the supervisor is a Linux
// runner). On macOS there is no /proc, so this answers "no descendants" for exactly that listing; nothing else changes. The
// entry-point refusal test uses it only where /proc is absent, and only before any browser launch, where there are none.
const fs = require('node:fs');
const readdirSync = fs.readdirSync;
fs.readdirSync = function patched(p, ...rest) { return p === '/proc' ? [] : readdirSync.call(this, p, ...rest); };
