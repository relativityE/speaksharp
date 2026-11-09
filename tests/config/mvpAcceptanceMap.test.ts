// @vitest-environment node
// The artifact under test is the acceptance document, not product behavior.
// These controls prevent lost scope/provenance and false release-state promotion.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

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
  }
  for (const obligation of ['**15 automated practice cases**', '**six human/device records**', '**151 requirements**']) {
    if (!current.includes(obligation)) errors.push(`inventory:${obligation}`);
  }
  const inventoryStart = current.indexOf('### Existing PR inventory to preserve');
  const inventoryEnd = current.indexOf('### 1. One MVP acceptance map');
  const inventory = current.slice(inventoryStart, inventoryEnd);
  for (const [bucket, pr, sha] of retainedSources) {
    const rows = inventory.split('\n').filter((row) => row.includes(`[#${pr}](`));
    if (rows.length !== 1 || !rows[0].startsWith(`| ${bucket} |`) || !rows[0].includes(sha)) {
      errors.push(`retained-source:${pr}`);
    }
    if ((pr === 1760 || pr === 1788) && !rows[0]?.includes('closed unmerged')) {
      errors.push(`unmerged-source:${pr}`);
    }
  }
  return errors;
}

describe('bounded MVP acceptance-map contract', () => {
  it('preserves the exact historical suffix instead of rewriting prior evidence', () => {
    const offset = source.indexOf(stop);
    expect(offset).toBeGreaterThanOrEqual(0);
    // Verified against the unchanged source at main 524c325a, not a regenerated ledger.
    expect(createHash('sha256').update(source.slice(offset)).digest('hex'))
      .toBe('629d594d5815305282b7fad8fe1ae271d9a24b965003d34d69f72fc8272442bc');
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
    { name: 'unmerged source presented as delivered', before: 'pull/1788), closed unmerged |', after: 'pull/1788), delivered |', code: 'unmerged-source:1788' },
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
