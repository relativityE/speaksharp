import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// YAML-AWARE, JOB-LEVEL provenance-wiring validation. Proves, per genuinely data-producing job, that the
// CORRECT account is registered BEFORE the product write and expired AFTER with if: always() — either
// in the same job (single) or via dedicated register/expire jobs with correct `needs` (multi). Also
// proves: non-producer jobs do NOT register; minted-account jobs do NOT register a fixed account (never
// PRO as a substitute); shared-account workflows share the concurrency group; no account mismatch.
const HERE = dirname(fileURLToPath(import.meta.url));
const WF = resolve(HERE, '../../.github/workflows');
const load = (f, dir = WF) => yaml.load(readFileSync(resolve(dir, f), 'utf8'));

const ACTION = './.github/actions/register-provenance';
const SHARED_GROUP = 'provenance-shared-pro-account';
const isRegister = (s) => s && s.uses === ACTION && !(s.with && s.with.mode === 'expire');
const isExpire = (s) => s && s.uses === ACTION && s.with && s.with.mode === 'expire';
const emailOf = (s) => String((s.with && s.with.email) || '');
const alwaysIf = (v) => typeof v === 'string' && v.replace(/\s/g, '').includes('always()');
const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// Returns a list of contract violations for a workflow doc given its inventory spec.
export function validate(doc, spec) {
  const problems = [];
  const jobs = doc.jobs || {};
  if (spec.concurrency && (doc.concurrency || {}).group !== SHARED_GROUP) problems.push('workflow: missing shared concurrency group');

  for (const [name, j] of Object.entries(spec.jobs)) {
    const job = jobs[name];
    if (!job) { problems.push(`${name}: job missing`); continue; }
    const steps = job.steps || [];
    const regs = steps.filter(isRegister);

    if (j.producer === false) { if (regs.length) problems.push(`${name}: non-producer must not register provenance`); continue; }
    if (j.minted) { if (regs.length) problems.push(`${name}: minted-account job must not register a fixed account`); continue; }

    if (j.mode === 'single') {
      if (!regs.length) problems.push(`${name}: no register step`);
      for (const r of regs) if (!j.accounts.some((a) => emailOf(r).includes(a))) problems.push(`${name}: register uses an account not written by this job (${emailOf(r)})`);
      for (const a of j.accounts) if (!regs.some((r) => emailOf(r).includes(a))) problems.push(`${name}: account ${a} is written but never registered`);
      if (j.write) {
        const wi = steps.findIndex((s) => JSON.stringify(s).includes(j.write));
        const ri = steps.findIndex(isRegister);
        if (wi >= 0 && (ri < 0 || ri > wi)) problems.push(`${name}: register must occur BEFORE the product write`);
      }
      const exps = steps.filter(isExpire);
      if (!exps.length) problems.push(`${name}: no expire step`);
      if (exps.some((s) => !alwaysIf(s.if))) problems.push(`${name}: expire step must be if: always()`);
    } else if (j.mode === 'multi') {
      if (!asList(job.needs).includes(spec.registerJob)) problems.push(`${name}: multi-job producer must need ${spec.registerJob}`);
      for (const r of regs) if (!j.accounts.some((a) => emailOf(r).includes(a))) problems.push(`${name}: in-job register account mismatch`);
    }
  }

  if (spec.registerJob) {
    const rj = jobs[spec.registerJob];
    if (!rj) problems.push('register job missing');
    else for (const a of spec.registerAccounts) if (!(rj.steps || []).filter(isRegister).some((r) => emailOf(r).includes(a))) problems.push(`register job missing account ${a}`);
    const ej = jobs[spec.expireJob];
    if (!ej) problems.push('expire job missing');
    else {
      if (!alwaysIf(ej.if)) problems.push('expire job must be if: always()');
      for (const a of spec.registerAccounts) if (!(ej.steps || []).filter(isExpire).some((r) => emailOf(r).includes(a))) problems.push(`expire job missing account ${a}`);
      const needs = asList(ej.needs);
      for (const [jn, jj] of Object.entries(spec.jobs)) if (jj.mode === 'multi' && !needs.includes(jn)) problems.push(`expire job must need ${jn}`);
    }
  }
  return problems;
}

const single = (accounts, write) => ({ accounts, mode: 'single', write });
const multi = (accounts) => ({ accounts, mode: 'multi' });

// The JOB-LEVEL inventory (see telemetry-worker/RUNBOOK.md). Only genuinely session/report-producing jobs.
const INVENTORY = {
  'rc-gates.yml': { concurrency: true, jobs: { 'gate-3-dast': single(['PRO_TEST_EMAIL', 'FREE_TEST_EMAIL', 'BASIC_TEST_EMAIL'], 'rc:dast:live') } },
  'pro-stt-artifact-matrix.yml': { concurrency: true, jobs: { 'pro-stt-artifact-matrix': single(['PRO_TEST_EMAIL'], 'pro-stt-artifact-matrix.live.spec') } },
  'v4-app-path-proof.yml': { concurrency: true, jobs: { 'v4-app-path-proof': single(['PRO_TEST_EMAIL'], 'manual-stt-corpus-proof') } },
  'v4-auto-fallback-proof.yml': { concurrency: true, jobs: { 'v4-auto-fallback-proof': single(['PRO_TEST_EMAIL'], 'manual-stt-corpus-proof') } },
  'v4-benchmark-gpu.yml': { concurrency: true, jobs: { 'benchmark': single(['PRO_TEST_EMAIL'], 'benchmark-v4.live.spec') } },
  'benchmarks.yml': { concurrency: true, jobs: { 'benchmark-private-browser': single(['PRO_TEST_EMAIL'], 'benchmark-v4.live.spec'), 'benchmark-cloud': { producer: false } } },
  'live-release-matrix.yml': {
    concurrency: true, registerJob: 'provenance-register', expireJob: 'provenance-expire',
    registerAccounts: ['PRO_TEST_EMAIL', 'BASIC_TEST_EMAIL'],
    jobs: {
      'live-custom-words': multi(['BASIC_TEST_EMAIL']),
      'live-native-preflight': multi(['PRO_TEST_EMAIL']),
      'live-cloud-artifact': multi(['PRO_TEST_EMAIL']),
      'live-stt-switching-contract': multi(['PRO_TEST_EMAIL']),
      'live-private-cache': multi(['PRO_TEST_EMAIL']),
      'live-first-time-tester-private-trial': { minted: true },
      'live-private-sample-telemetry': { minted: true },
    },
  },
};

describe('provenance wiring is correct at the JOB/account level', () => {
  for (const [wf, spec] of Object.entries(INVENTORY)) {
    it(`${wf}: every data-producing job registers the right account before its write and expires after`, () => {
      expect(validate(load(wf), spec)).toEqual([]);
    });
  }
});

// Fixtures reproducing the ACTUAL broken shapes the file-level test missed — the validator must flag them.
const FX = resolve(HERE, 'fixtures');
describe('the validator FAILS the broken shapes (regression guard)', () => {
  it('benchmarks: register in the non-producer job, real producer has none → flagged', () => {
    const probs = validate(load('broken-benchmarks.yml', FX), { concurrency: true, jobs: { 'benchmark-private-browser': single(['PRO_TEST_EMAIL'], 'benchmark-v4.live.spec'), 'benchmark-cloud': { producer: false } } });
    expect(probs.length).toBeGreaterThan(0);
    expect(probs.join(' ')).toMatch(/benchmark-private-browser: no register|non-producer must not register/);
  });
  it('live-release: multi-job producer without needs + account mismatch → flagged', () => {
    const probs = validate(load('broken-live-release.yml', FX), INVENTORY['live-release-matrix.yml']);
    expect(probs.length).toBeGreaterThan(0);
    expect(probs.join(' ')).toMatch(/must need provenance-register|account/);
  });
});
