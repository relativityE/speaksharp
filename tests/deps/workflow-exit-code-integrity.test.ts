// @vitest-environment node
//
// GREEN MUST MEAN GREEN.
//
// GitHub runs `run:` steps with `bash -e`, NOT `-o pipefail`. So in `cmd | tee out.txt` the step takes TEE's
// exit status, and a FAILING command is reported as a PASSING step. Not theoretical: on #1314 the "PostgREST
// contract proof" job reported success while its script printed `FAIL:` and exited non-zero. The same masking
// had already been seen with `pnpm quality | tail`.
//
// WHAT THIS GUARD IS, HONESTLY. It is a FROZEN BASELINE, not a security boundary. It lives in the same
// repository as the code it checks, so anyone able to change a workflow can also change this file. Its value is
// that doing so is a deliberate, reviewable edit rather than an accident — it converts silent drift into a
// visible diff. It does not, and cannot, make the exemption list tamper-proof.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { executableLines } from './lib/source-text';

const WF_DIR = path.resolve(__dirname, '../../.github/workflows');

/** Commands that, at the END of a pipe, replace a real exit status with their own (almost always 0). */
const MASKING = /\|\s*(tee|head|tail|grep|awk|sed|jq|cut|sort|uniq|xargs)\b/;

/**
 * Frozen masked-exit baseline. The #1315 repair resolves all recorded entries, so the baseline must stay empty
 * unless a new exception is explicitly accepted and documented.
 */
/** Synthetic or explicitly accepted exemptions are keyed by workflow + step identity + command signature. */
interface Exemption { workflow: string; step: string; idKind: 'id' | 'name'; signature: string; note: string }

const FROZEN_BASELINE: ReadonlyArray<Exemption> = [];

interface Step { workflow: string; name: string; id: string | null; line: number; body: string }

/** Every `run:` block, with the `- name:` it belongs to. */
function runSteps(workflow: string): Step[] {
  const raw = readFileSync(path.join(WF_DIR, workflow), 'utf8').split('\n');
  const out: Step[] = [];
  let currentName = '(unnamed step)';
  let currentId: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    // A new list item starts a new step: reset the id so one step's id cannot leak onto the next.
    if (/^\s*-\s+(name|id|uses|run):/.test(raw[i])) { currentId = null; }
    const nameMatch = /^\s*-?\s*name:\s*(.+?)\s*$/.exec(raw[i]);
    if (nameMatch) currentName = nameMatch[1].replace(/^["']|["']$/g, '');
    const idMatch = /^\s*-?\s*id:\s*(.+?)\s*$/.exec(raw[i]);
    if (idMatch) currentId = idMatch[1].replace(/^["']|["']$/g, '');
    const m = /^(\s*)-?\s*run:\s*(.*)$/.exec(raw[i]);
    if (!m) continue;
    const indent = m[1].length;
    const inline = m[2].trim();
    if (inline && !inline.startsWith('|') && !inline.startsWith('>')) {
      out.push({ workflow, name: currentName, id: currentId, line: i + 1, body: inline });
      continue;
    }
    const block: string[] = [];
    let j = i + 1;
    for (; j < raw.length; j++) {
      if (raw[j].trim() === '') { block.push(raw[j]); continue; }
      if (raw[j].length - raw[j].trimStart().length <= indent) break;
      block.push(raw[j]);
    }
    out.push({ workflow, name: currentName, id: currentId, line: i + 1, body: block.join('\n') });
    i = j - 1;
  }
  return out;
}

/**
 * Does this step ACTUALLY set pipefail? Checked over EXECUTABLE lines via the shared helper.
 * A substring search is defeated by prose: the step documenting WHY pipefail is required would exempt itself.
 */
const setsPipefail = (body: string): boolean =>
  executableLines(body, 'hash').some((l) => /\bset\s+-[a-zA-Z]*o\s+pipefail|\bset\s+-o\s+pipefail/.test(l));

/** Lines that pipe into a masking command AND gate something. */
function maskedLines(body: string): string[] {
  return executableLines(body, 'hash').filter((l) => {
    if (!MASKING.test(l)) return false;
    if (l.includes('GITHUB_STEP_SUMMARY')) return false;          // gates nothing
    if (/\|\|\s*(true|echo|:)\b/.test(l)) return false;           // failure handled deliberately
    return true;
  });
}

const workflows = readdirSync(WF_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
const allSteps = workflows.flatMap(runSteps);

/** Match on the stable id when the entry declares one, else on the display name. */
const stepIdentity = (s: Step, kind: 'id' | 'name'): string | null => (kind === 'id' ? s.id : s.name);

export const findExemption = (s: Step, baseline: ReadonlyArray<Exemption>): Exemption | undefined =>
  baseline.find((e) => e.workflow === s.workflow && stepIdentity(s, e.idKind) === e.step
    && maskedLines(s.body).some((l) => l.includes(e.signature)));

const exemptionFor = (s: Step): Exemption | undefined =>
  FROZEN_BASELINE.find((e) => e.workflow === s.workflow && stepIdentity(s, e.idKind) === e.step
    && maskedLines(s.body).some((l) => l.includes(e.signature)));

describe('green means green — a failing command may never report a passing step', () => {
  it('finds the workflows (guard is not silently empty)', () => {
    expect(workflows.length).toBeGreaterThan(5);
    expect(allSteps.length).toBeGreaterThan(20);
  });

  it('no unexempted run step pipes a gating command without `set -o pipefail`', () => {
    const violations = allSteps
      .filter((s) => !setsPipefail(s.body) && maskedLines(s.body).length > 0 && !exemptionFor(s))
      .map((s) => `${s.workflow}:${s.line} [${s.name}]  ${maskedLines(s.body)[0].trim().slice(0, 90)}`);
    if (violations.length > 0) {
      throw new Error(
        `A run step pipes a gating command without \`set -o pipefail\`, so a FAILURE would report a PASS:\n` +
        `${violations.join('\n')}\n\nAdd \`set -o pipefail\` to that step. Do NOT extend FROZEN_BASELINE.`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('every exemption still points at a real step — a rename or deletion FAILS LOUDLY', () => {
    // Without this, renaming a step silently drops its exemption and the guard quietly stops covering it. The
    // failure must be noisy in BOTH directions: the step vanished, or it no longer matches its signature.
    const orphaned = FROZEN_BASELINE.filter((e) => {
      if (!workflows.includes(e.workflow)) return true;
      return !runSteps(e.workflow).some((s) => stepIdentity(s, e.idKind) === e.step
        && maskedLines(s.body).some((l) => l.includes(e.signature)));
    }).map((e) => `${e.workflow} [${e.step}] signature=${e.signature}`);

    // Thrown rather than passed as expect()'s second argument, which `vitest/valid-expect` rejects.
    if (orphaned.length > 0) {
      throw new Error(
        `These exemptions no longer match a real masked step. If the step was FIXED, remove the entry. If it ` +
        `was RENAMED, update the key. Never leave a stale exemption: it silently stops covering anything.\n` +
        `${orphaned.join('\n')}`,
      );
    }
    expect(orphaned).toEqual([]);
  });

  it('the previously recorded masked-exit baseline is fully retired', () => {
    expect(FROZEN_BASELINE).toEqual([]);
    expect(FROZEN_BASELINE.map((e) => e.workflow)).not.toContain('unaffiliated-identity-audit.yml');
  });

  it('the identity audit is now genuinely gated', () => {
    const step = runSteps('unaffiliated-identity-audit.yml')
      .find((s) => s.body.includes('unaffiliated-identity-audit.mjs'));
    expect(step, 'the audit step disappeared').toBeDefined();
    expect(setsPipefail(step!.body)).toBe(true);
  });

  it("this PR's own workflows are NOT exempt", () => {
    for (const f of ['postgrest-contract-matrix.yml', 'atomic-completion-concurrency-matrix.yml']) {
      expect(FROZEN_BASELINE.map((e) => e.workflow)).not.toContain(f);
      expect(workflows).toContain(f);
    }
  });

  it('an id-keyed exemption MATCHES, and survives a rename that would break a name-keyed one', () => {
    // Drive the id path with a synthetic step so future explicit exemptions can use stable YAML ids.
    const step: Step = {
      workflow: 'synthetic.yml', name: 'Original display name', id: 'stable-step-id',
      line: 1, body: "        run: cmd | tee out.txt",
    };
    const byId: Exemption = { workflow: 'synthetic.yml', step: 'stable-step-id', idKind: 'id',
      signature: '| tee', note: 'synthetic' };
    const byName: Exemption = { workflow: 'synthetic.yml', step: 'Original display name', idKind: 'name',
      signature: '| tee', note: 'synthetic' };

    expect(findExemption(step, [byId])).toBeDefined();
    expect(findExemption(step, [byName])).toBeDefined();

    // Now REWORD the display name — behaviour unchanged, only prose.
    const renamed: Step = { ...step, name: 'Reworded display name' };
    expect(findExemption(renamed, [byId]), 'id-keyed exemption must survive a rename').toBeDefined();
    expect(findExemption(renamed, [byName]), 'name-keyed exemption breaks on a rename — this is the fragility').toBeUndefined();
  });

  it('a broken exemption FAILS LOUDLY rather than silently skipping', () => {
    // The question that decides whether the name-keying fragility is contained or a live hole: when an
    // exemption stops matching, the orphan test above turns RED (someone must update or remove the entry).
    // It does NOT quietly drop coverage. Proven by construction here and by mutation on a real workflow.
    const renamed: Step = {
      workflow: 'synthetic.yml', name: 'Reworded', id: null, line: 1, body: '        run: cmd | tee out.txt',
    };
    const stale: Exemption = { workflow: 'synthetic.yml', step: 'Original', idKind: 'name',
      signature: '| tee', note: 'synthetic' };

    // No exemption matches -> the step is a VIOLATION (red), and the stale entry is an ORPHAN (also red).
    expect(findExemption(renamed, [stale])).toBeUndefined();
    expect(maskedLines(renamed.body).length).toBeGreaterThan(0);
  });

  it('every step that declares an id is keyable by it', () => {
    const withIds = allSteps.filter((s) => s.id !== null);
    expect(withIds.length, 'no step declares an id — the id path would be untested against real files').toBeGreaterThan(0);
    for (const s of withIds) expect(stepIdentity(s, 'id')).toBe(s.id);
  });

  it('a comment mentioning pipefail does NOT satisfy the check', () => {
    // The exact defect this guard shipped with, pinned so it cannot return.
    expect(setsPipefail('  # set -o pipefail is required here\n  cmd | tee out.txt')).toBe(false);
    expect(setsPipefail('  set -o pipefail\n  cmd | tee out.txt')).toBe(true);
    expect(setsPipefail('  set -euo pipefail\n  cmd | tee out.txt')).toBe(true);
  });

  it('a masked line inside a comment is not a violation', () => {
    expect(maskedLines('  # legacy: cmd | tee out.txt\n  safe_cmd')).toEqual([]);
  });
});
