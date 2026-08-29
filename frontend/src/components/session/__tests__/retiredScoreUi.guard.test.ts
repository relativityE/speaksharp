import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #1304 — the universal-score UI is retired.
 *
 * `LiveCoachingScoreCard` and `SpeakingTipsCard` computed the SpeakSharp Score but had no render path:
 * no non-test importer, no session-component barrel, no dynamic import. They were deleted.
 *
 * This guard is source-level on purpose. A behavioural test cannot prove the ABSENCE of a UI consumer —
 * it can only exercise the paths someone remembered to write. Reintroducing either component, or an
 * import of it, must fail here rather than quietly restoring a surface the product retired.
 *
 * SCOPE. This retires the UI only. `utils/speakingScore.ts` and the three shadow-telemetry consumers
 * (ScoreProcessor, fillerDivergence, metricsParity) are deliberately KEPT and must keep working. The
 * 0-100 `clarity_score` is a SEPARATE, live metric and is not part of this retirement.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RETIRED = ['LiveCoachingScoreCard', 'SpeakingTipsCard'] as const;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue; // production sources only
      sourceFiles(abs, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(abs);
    }
  }
  return acc;
}

describe('#1304 retired universal-score UI stays retired', () => {
  it.each(RETIRED)('%s has no component or test file', name => {
    const candidates = [
      `components/session/${name}.tsx`,
      `components/session/${name}.ts`,
      `components/session/__tests__/${name}.test.tsx`,
      `components/session/__tests__/${name}.component.test.tsx`,
    ].map(rel => path.join(SRC, rel));
    const present = candidates.filter(fs.existsSync).map(p => path.relative(SRC, p));
    expect(present, `${name} was reintroduced`).toEqual([]);
  });

  it('no production source imports or renders either retired component', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const name of RETIRED) {
        // An import, a JSX render, or a bare identifier reference all count.
        if (new RegExp(`\\b${name}\\b`).test(text)) {
          offenders.push(`${path.relative(SRC, file)} → ${name}`);
        }
      }
    }
    expect(offenders, 'retired score UI referenced from production source').toEqual([]);
  });

  it('keeps the shadow-telemetry score path intact', () => {
    // The retirement is of the UI, not of the score. If these disappear the cleanup overreached.
    for (const rel of [
      'utils/speakingScore.ts',
      'services/telemetry/processors/ScoreProcessor.ts',
      'services/telemetry/fillerDivergence.ts',
      'services/telemetry/metricsParity.ts',
    ]) {
      expect(fs.existsSync(path.join(SRC, rel)), `${rel} must be kept`).toBe(true);
    }
  });

  it('does not describe the retired card as a live consumer', () => {
    const processor = fs.readFileSync(
      path.join(SRC, 'services/telemetry/processors/ScoreProcessor.ts'), 'utf8',
    );
    expect(processor).not.toMatch(/live LiveCoachingScoreCard/);
    expect(processor).toMatch(/SHADOW ONLY/);
  });
});
