// Documentation-contract test for the product_release/ canonical documentation system.
// Runs under `pnpm test:unit` (the CI - Test Audit gate). Deterministic; reads only committed files.
// Enforces the invariants declared by product_release/README.md (the portal) and
// product_release/DOC_MIGRATION_LEDGER.md so later consolidation PRs cannot silently drift.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../product_release');
const read = (rel: string) => fs.readFileSync(path.join(DOCS, rel), 'utf8');

const README = read('README.md');
const LEDGER = read('DOC_MIGRATION_LEDGER.md');
const STATUS = read('RELEASE_STATUS.md');

const CANONICAL_14 = [
  'README.md', 'PRODUCT_REQUIREMENTS.md', 'ROADMAP.md', 'ARCHITECTURE.md', 'STT.md',
  'COACHING_SCORE.md', 'ENTITLEMENTS_AND_BILLING.md', 'QUALITY.md', 'RELEASE_PROCESS.md',
  'RELEASE_STATUS.md', 'OPERATIONS_AND_SECURITY.md', 'TESTER_GUIDE.md', 'TESTER_OPERATIONS.md',
  'EVIDENCE_INDEX.md',
];
const METADATA_FIELDS = [
  'Status:', 'Owner:', 'Last Reviewed:', 'Last Verified:', 'Applies To:', 'Class:',
  'Authority:', 'Not Authoritative For:', 'Supersedes:', 'Evidence Sources:',
];
const CONTENT_DISPOSITIONS = ['EXTRACTED', 'EVIDENCE_ONLY', 'OPEN_GAP', 'NO_DURABLE_CONTENT'];
const ALLOWED_SHAS = new Set(['d31102a8', 'a21e1e52', 'a247f62c']); // pinned historical provenance only

function section(md: string, startRe: RegExp, endRe: RegExp): string {
  const s = md.search(startRe);
  if (s < 0) return '';
  const rest = md.slice(s + 1);
  const e = rest.search(endRe);
  return e < 0 ? md.slice(s) : md.slice(s, s + 1 + e);
}

describe('documentation contract — product_release/', () => {
  it('README §2 declares exactly the approved 14 canonical documents', () => {
    const sec = section(README, /## 2\. The 14 canonical documents/, /\n## \d/);
    const names = [...sec.matchAll(/^\|\s*\d+\s*\|\s*\*\*([A-Za-z_]+\.md)\*\*/gm)].map(m => m[1]);
    expect(names.length).toBe(14);
    expect(new Set(names)).toEqual(new Set(CANONICAL_14));
  });

  it('every pre-foundation root Markdown source is mapped in the ledger', () => {
    const rootMd = fs.readdirSync(DOCS).filter(f => f.endsWith('.md'));
    // The foundation files themselves are not "sources": the portal, the ledger, and the SSOT.
    const foundation = new Set(['README.md', 'DOC_MIGRATION_LEDGER.md', 'RELEASE_STATUS.md']);
    const unmapped = rootMd.filter(f => !foundation.has(f) && !LEDGER.includes(f));
    expect(unmapped).toEqual([]);
  });

  it('README, RELEASE_STATUS and the ledger all carry the full 10-field metadata header', () => {
    for (const [label, md] of [['README', README], ['RELEASE_STATUS', STATUS], ['LEDGER', LEDGER]] as const) {
      const missing = METADATA_FIELDS.filter(f => !md.includes(f));
      expect(missing, `${label} missing metadata fields`).toEqual([]);
    }
  });

  it('ledger content dispositions are single-valued (no compound cells)', () => {
    // No "X + Y" combination of two content dispositions inside a single cell.
    for (const a of CONTENT_DISPOSITIONS) {
      for (const b of CONTENT_DISPOSITIONS) {
        expect(LEDGER.includes(`${a} + ${b}`), `compound disposition ${a} + ${b}`).toBe(false);
      }
    }
  });

  it('every ledger table row ending in EXTRACTED names a canonical target', () => {
    const rows = LEDGER.split('\n').filter(l => /^\|.*\|\s*EXTRACTED\s*\|?\s*$/.test(l.trim()));
    const offenders = rows.filter(l => !/(→|PRODUCT_REQUIREMENTS|ROADMAP|ARCHITECTURE|STT|COACHING_SCORE|ENTITLEMENTS_AND_BILLING|QUALITY|RELEASE_PROCESS|RELEASE_STATUS|OPERATIONS_AND_SECURITY|TESTER_GUIDE|TESTER_OPERATIONS|EVIDENCE_INDEX|README|archive)/.test(l));
    expect(offenders).toEqual([]);
  });

  it('relative links in the three governed docs resolve', () => {
    for (const [name, md] of [['README.md', README], ['DOC_MIGRATION_LEDGER.md', LEDGER], ['RELEASE_STATUS.md', STATUS]] as const) {
      for (const m of md.matchAll(/\]\((\.\.?\/[^)#]+)/g)) {
        const target = path.resolve(DOCS, m[1]);
        expect(fs.existsSync(target), `${name}: broken link ${m[1]}`).toBe(true);
      }
    }
  });

  it('each retained-evidence file has an exact off-root destination', () => {
    expect(LEDGER).toContain('evidence/PUBLIC_LAUNCH_LEDGER.md');
    expect(LEDGER).toContain('evidence/ENTITLEMENT_PRO_LIMIT_EVIDENCE.md');
    expect(LEDGER).toContain('archive/attribution-sanitation-crosswalk.md');
  });

  it('no unmerged/unresolved PR is described as fixed or deployed (positive overclaims only)', () => {
    // Positive overclaim: "<verb> ... #1033" or "#1033 ... is/now/was <verb>". Negated forms
    // ("not proven or deployed", "unmerged") are correct and must NOT trip the check.
    const overclaimBefore = /\b(fixed|deployed|shipped|merged)\b[^.\n]{0,30}#1033/i;
    const overclaimAfter = /#1033[^.\n]*\b(is|now|already|was)\s+(fixed|deployed|shipped|merged)\b/i;
    expect(overclaimBefore.test(LEDGER), 'positive-before overclaim on #1033').toBe(false);
    expect(overclaimAfter.test(LEDGER), 'positive-after overclaim on #1033').toBe(false);
    expect(LEDGER).toContain('OPEN GAP');
  });

  it('volatile git SHAs appear only in RELEASE_STATUS (README + ledger carry only pinned provenance)', () => {
    for (const [name, md] of [['README.md', README], ['DOC_MIGRATION_LEDGER.md', LEDGER]] as const) {
      const shas = [...md.matchAll(/\b([0-9a-f]{8})(?:[0-9a-f]{32})?\b/g)].map(m => m[1]);
      const forbidden = shas.filter(s => !ALLOWED_SHAS.has(s));
      expect(forbidden, `${name} contains non-pinned SHA(s)`).toEqual([]);
    }
  });

  it('closeout arithmetic proves exactly 14 root files', () => {
    expect(LEDGER).toMatch(/2 retained \+ 12 new = \*\*14\*\*/);
  });
});
