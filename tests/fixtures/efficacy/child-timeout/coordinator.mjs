// Scaled stand-in for scripts/run-test-efficacy.mjs: one bounded detached phase whose process group
// keeps writing after its leader is killed, drained and cleaned up with the real coordinator helpers.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import console from 'node:console';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { cleanupOwnedCopy, drainOwnedPhase } from '../../../../scripts/run-test-efficacy.mjs';

const witness = process.env.EFFICACY_TIMEOUT_WITNESS;
const phaseMs = Number(process.env.EFFICACY_TIMEOUT_PHASE_MS);
const record = facts => fs.writeFileSync(witness, JSON.stringify({ ...JSON.parse(fs.readFileSync(witness, 'utf8')), ...facts }));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'speaksharp-efficacy-timeout-fixture-'));
const log = path.join(temporary, 'phase-writes.log');
fs.writeFileSync(witness, JSON.stringify({ coordinatorPid: process.pid, temporary, log }));
// The leader starts a same-group member, then both append timestamps until killed.
const writer = `const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(log)},Date.now()+'\\n'),20);`;
const leader = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:'ignore'});${writer}`;
const phaseStartedAt = Date.now();
record({ phaseStartedAt });
const result = spawnSync(process.execPath, ['-e', leader], { timeout: phaseMs, killSignal: 'SIGKILL', detached: true, stdio: 'ignore' });
const phaseEndedAt = Date.now();
const drain = drainOwnedPhase(result);
const drainedAt = Date.now();
const writesAtDrain = fs.readFileSync(log, 'utf8');
await new Promise(resolve => setTimeout(resolve, 300));
const writesAfterDrain = fs.readFileSync(log, 'utf8');
cleanupOwnedCopy(temporary);
record({ group: result.pid, phaseEndedAt, drain, drainedAt, writesAtDrain: writesAtDrain.split('\n').filter(Boolean).length,
  writesAfterDrain: writesAfterDrain.split('\n').filter(Boolean).length, cleanedAt: Date.now(), done: true });
console.log(JSON.stringify({ status: 'drained' }));
