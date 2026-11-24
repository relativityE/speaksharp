// @vitest-environment node
// The artifact under test is the acceptance document, not product behavior.
// These controls prevent lost scope/provenance and false release-state promotion.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const source = readFileSync(new URL('../../product_release/RELEASE_STATUS.md', import.meta.url), 'utf8');
const start = '## 9 November 2026 MVP acceptance map';
const stop = '## 5 November 2026 source reconciliation and R10 hold';
const expectedTitles = [
  'One MVP acceptance map',
  'Qualify the selected speech path',
  'Prove current coaching is useful',
  'Close the same-target outcome gap',
  'Execute the automated practice journeys',
  'Observe the complete supported-device journey',
  'Make billing genuinely testable',
  'Connect paid access to the same value loop',
  'Close account, privacy and credential gaps',
  'Assemble and operate one release',
];
const retainedSources = [
  [2, 1760, 'f99627fc85f2a9f44abe979605402970ea0fec03'],
  [5, 1788, '655d229bf7b3d7dfe450a190775ee48c626cf325'],
  [6, 1782, '62b7a0d044df736cd86c81a50271e8fd565fc646'],
  [7, 1795, '5dc87301962252bf599963a86ebb0de6e2336462'],
  [9, 1770, '47b5974f58ff28018b3f4f3737eea43397fdbeda'],
  [9, 1775, 'd08055ca5165d1a1c40fe49f18366f5afad75490'],
  [10, 1774, '54c674ace88f2e22acd1c01a9a5ec2cf533193f2'],
] as const;
// PR states re-read from GitHub on 13 November 2026; the pinned SHAs above stay historical.
const currentStates: Record<number, string> = {
  1760: 'merged', 1782: 'merged', 1770: 'merged',
  1788: 'open unmerged', 1795: 'open unmerged', 1775: 'open unmerged',
};
// The J1–J9 retarget (16 November 2026) is bound to the runner's own leg plan, so a leg or a former case cannot drop out.
type PlanLeg = { id: string; caseId: string | null };
const plan = createRequire(import.meta.url)('../../tools/cloud-test/nightly/journey-plan.cjs') as {
  ALL_LEGS: PlanLeg[];
  historicalCase: (leg: PlanLeg) => string | null; // the former AHT case a leg carries (J8 runs as one invocation)
  RETIRED_CASES: readonly string[]; // former cases no leg carries (AHT-15: J1.d has its own rows)
};
const retargetHeading = '### Retarget to J1–J9, 16 November 2026';
// Gaps Sam asked the map to keep explicitly (12 November framework-review reconciliation).
const retainedGaps = [
  ['3', ['**Two-part coaching output contract:**', '`what_worked`', '`what_to_try_next`']],
  ['4', ['**Analytics correctness:**']],
  ['9', ['**Private audio stays on-device:**', 'network-observed']],
] as const;

function violations(document: string): string[] {
  const errors: string[] = [];
  const begin = document.indexOf(start);
  const end = document.indexOf(stop);
  if (begin < 0 || end <= begin) return ['section-boundary'];
  const current = document.slice(begin + start.length, end);
  if (!current.trimStart().startsWith('**HOLD.**')) errors.push('release-hold');
  const headings = [...current.matchAll(/^### (\d+)\. (.+)$/gm)];
  const expectedHeadings = expectedTitles.map((title, i) => `${i + 1}. ${title}`);
  if (JSON.stringify(headings.map((h) => `${h[1]}. ${h[2]}`)) !== JSON.stringify(expectedHeadings)) {
    errors.push('ten-outcomes');
  }
  for (const [i, heading] of headings.entries()) {
    const section = current.slice(heading.index, headings[i + 1]?.index ?? current.length);
    const steps = [...section.matchAll(/^([1-4])\. \*\*(Define|Close|Prove|Release\/learn):\*\*/gm)]
      .map((m) => `${m[1]}:${m[2]}`);
    if (JSON.stringify(steps) !== JSON.stringify(['1:Define', '2:Close', '3:Prove', '4:Release/learn'])) {
      errors.push(`four-stages:${heading[1]}`);
    }
    for (const [bucket, markers] of retainedGaps) {
      if (heading[1] === bucket && !markers.every((marker) => section.includes(marker))) {
        errors.push(`retained-gap:${bucket}`);
      }
    }
  }
  for (const obligation of ['**15 automated practice cases**', '**six human/device records**', '**151 requirements**']) {
    if (!current.includes(obligation)) errors.push(`inventory:${obligation}`);
  }
  const telemetry = current.slice(current.indexOf('| Retained family |'), current.indexOf('Release operation (10) owns'));
  for (const family of ['Recording intent and preparation', 'Recording control', 'Focus transition',
    'Provisional stability', 'Transcript authority', 'Coverage', 'Practice Loop', 'Completion/navigation',
    'Share feedback', 'Retention truth', 'Runtime downselection', 'Acquisition receipt', 'Observer integrity']) {
    if (!telemetry.includes(`| ${family} |`)) errors.push(`telemetry-family:${family}`);
  }
  const efficacy = current.slice(current.indexOf('| Retained deliverable |'), current.indexOf('Before test retirement'));
  for (const deliverable of ['Two-product journey and Private STT test inventory', 'User-benefit traceability matrix',
    'Ground-truth instrumentation map', 'False-green, mock-fidelity and obsolete-test register',
    'Severity-ranked reproducible coverage-gap register', 'Authoritative RWT/release lanes versus supporting suites',
    'Bounded follow-ups for accepted gaps']) {
    if (!efficacy.includes(`| ${deliverable} |`)) errors.push(`efficacy-deliverable:${deliverable}`);
  }
  const retargetStart = current.indexOf(retargetHeading);
  const retarget = retargetStart < 0 ? '' : current.slice(retargetStart, current.indexOf('### Existing PR inventory to preserve'));
  if (!retarget) errors.push('retarget-missing');
  const legRows = retarget.split('\n').filter((row) => /^\| J\d/.test(row));
  for (const leg of plan.ALL_LEGS) {
    const rows = legRows.filter((row) => row.startsWith(`| ${leg.id} |`));
    if (rows.length !== 1) errors.push(`retarget-leg:${leg.id}`);
    else if (!rows[0].includes(`| ${plan.historicalCase(leg) ?? 'none (new row)'} |`)) errors.push(`retarget-case:${leg.id}`);
    else if (!/\| NOT RUN( \(gated: [^)]+\))? \|$/.test(rows[0])) errors.push(`retarget-promoted:${leg.id}`);
  }
  if (legRows.length !== plan.ALL_LEGS.length) errors.push('retarget-leg-count');
  for (let n = 1; n <= 15; n += 1) {
    const id = `AHT-${String(n).padStart(2, '0')}`;
    // A retired case is carried by no leg and must not reappear as one's former case; every other former case is carried.
    const carried = legRows.some((row) => row.includes(`| ${id} |`));
    if (plan.RETIRED_CASES.includes(id) ? carried : !carried) errors.push(`retarget-former-case:${id}`);
  }
  if (!retarget.includes('NOT RUN never\n  counts as PASS')) errors.push('retarget-not-run-rule');
  const inventoryStart = current.indexOf('### Existing PR inventory to preserve');
  const inventoryEnd = current.indexOf('### 1. One MVP acceptance map');
  const inventory = current.slice(inventoryStart, inventoryEnd);
  for (const [bucket, pr, sha] of retainedSources) {
    const rows = inventory.split('\n').filter((row) => row.includes(`[#${pr}](`));
    if (rows.length !== 1 || !rows[0].startsWith(`| ${bucket} |`) || !rows[0].includes(sha)) {
      errors.push(`retained-source:${pr}`);
    }
    const state = currentStates[pr];
    if (state && !rows[0]?.includes(`/pull/${pr}), ${state}`)) {
      errors.push(`${state === 'merged' ? 'merged' : 'unmerged'}-source:${pr}`);
    }
  }
  return errors;
}

describe('bounded MVP acceptance-map contract', () => {
  it('preserves the exact historical suffix instead of rewriting prior evidence', () => {
    const offset = source.indexOf(stop);
    expect(offset).toBeGreaterThanOrEqual(0);
    // Re-pinned for the 24 November currency update only: add the verified source (27717c7f) and served frontend
    // (cdaaab3c, release run 45461465932) rows; date their prior rows and update the CURRENCY-BLOCK identities/date.
    // The rest of the retained suffix, including historical evidence and HOLD/acceptance, is unchanged.
    expect(createHash('sha256').update(source.slice(offset)).digest('hex'))
      .toBe('7556aafd92057e12a00cb06ef8195283f5f2540a26fdf6a9c8ff3a0d779e350f');
  });

  it('preserves ten outcomes, all four stages, inventories and retained source identities', () => {
    expect(violations(source)).toEqual([]);
  });

  it('accepts equivalent paragraph spacing without changing meaning or collection', () => {
    const equivalent = source.replace('### Existing PR inventory to preserve\n', '### Existing PR inventory to preserve\n\n');
    expect(equivalent).not.toBe(source);
    expect(violations(equivalent)).toEqual([]);
  });

  const faults = [
    { name: 'missing outcome', before: '### 3. Prove current coaching is useful', after: '### Removed coaching outcome', code: 'ten-outcomes' },
    { name: 'duplicate outcome', before: '### 3. Prove current coaching is useful', after: '### 2. Qualify the selected speech path', code: 'ten-outcomes' },
    { name: 'omitted proof phase', before: '3. **Prove:** verify every claimed result', after: '3. Verify every claimed result', code: 'four-stages:1' },
    { name: 'paid loop replaced with account lifecycle', before: '### 8. Connect paid access to the same value loop', after: '### 8. Prove account lifecycle', code: 'ten-outcomes' },
    { name: 'short pilot replaces all practice cases', before: '**15 automated practice cases**', after: '**three automated practice cases**', code: 'inventory:**15 automated practice cases**' },
    { name: 'unmeasured release promoted to acceptance', before: '**HOLD.** The release outcome', after: '**PASS.** The release outcome', code: 'release-hold' },
    { name: 'retained source moved to wrong bucket', before: '| 2 | [#1760]', after: '| 3 | [#1760]', code: 'retained-source:1760' },
    { name: 'unmerged source presented as delivered', before: 'pull/1788), open unmerged |', after: 'pull/1788), delivered |', code: 'unmerged-source:1788' },
    { name: 'merged source presented as still open', before: 'pull/1760), merged 10 November 2026 |', after: 'pull/1760), open unmerged |', code: 'merged-source:1760' },
    { name: 'open source presented as merged', before: 'pull/1795), open unmerged |', after: 'pull/1795), merged |', code: 'unmerged-source:1795' },
    { name: 'two-part coaching contract dropped', before: '**Two-part coaching output contract:**', after: '**Coaching output:**', code: 'retained-gap:3' },
    { name: 'analytics correctness dropped', before: '**Analytics correctness:**', after: '**Analytics note:**', code: 'retained-gap:4' },
    { name: 'on-device audio proof dropped', before: '**Private audio stays on-device:**', after: '**Private audio design:**', code: 'retained-gap:9' },
    { name: 'received observer evidence dropped', before: '| Observer integrity |', after: '| Unselected telemetry |', code: 'telemetry-family:Observer integrity' },
    { name: 'retarget leg dropped', before: '| J4.a | save request lost, retry, one saved | AHT-05 | NOT RUN |\n', after: '', code: 'retarget-leg:J4.a' },
    { name: 'retarget leg promoted to PASS', before: '| J6 | second tab and second browser refused; takeover fences the old owner | AHT-11 | NOT RUN |', after: '| J6 | second tab and second browser refused; takeover fences the old owner | AHT-11 | PASS |', code: 'retarget-promoted:J6' },
    { name: 'former case detached from its leg', before: '| J7.c | connection drops after bytes arrive, retry | AHT-14 |', after: '| J7.c | connection drops after bytes arrive, retry | none (new row) |', code: 'retarget-case:J7.c' },
    { name: 'gated leg presented as runnable PASS', before: '| none (new row) | NOT RUN (gated: no-j1d-harness-adapter) |', after: '| none (new row) | PASS |', code: 'retarget-promoted:J1.d' },
    { name: 'retired case restored as a leg\'s former case', before: '| J1.d | sign out and return, deep link, history preserved | none (new row) |', after: '| J1.d | sign out and return, deep link, history preserved | AHT-15 |', code: 'retarget-case:J1.d' },
    { name: 'NOT RUN-is-not-PASS rule dropped', before: 'NOT RUN never\n  counts as PASS', after: 'NOT RUN may later\n  count', code: 'retarget-not-run-rule' },
    { name: 'false-green register lost', before: '| False-green, mock-fidelity and obsolete-test register |', after: '| Test count summary |', code: 'efficacy-deliverable:False-green, mock-fidelity and obsolete-test register' },
  ];

  it.each(faults)('detects $name, then passes on byte-identical restoration', ({ before, after, code }) => {
    const digest = createHash('sha256').update(source).digest('hex');
    const offset = source.indexOf(before);
    expect(offset).toBeGreaterThanOrEqual(0);
    const faulty = source.replace(before, after);
    expect(faulty).not.toBe(source);
    expect(violations(faulty)).toContain(code);
    const restored = faulty.slice(0, offset) + before + faulty.slice(offset + after.length);
    expect(createHash('sha256').update(restored).digest('hex')).toBe(digest);
    expect(violations(restored)).toEqual([]);
  });
});
