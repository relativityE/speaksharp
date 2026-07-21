import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

// Documentation-integrity guard for the ACTIVE product_release SSOT (root *.md only — the archive/
// evidence subtrees are historical and intentionally not policed). It fails when the active docs
// drift from the merged product truth. It deliberately does NOT hard-code the current main SHA
// (a docs-only merge changes it), so it stays green across future docs merges.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PR_DIR = resolve(ROOT, 'product_release');

const activeDocs = readdirSync(PR_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => join(PR_DIR, f)); // root-level only; excludes archive/, evidence/, v4_work/

const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => p.slice(ROOT.length + 1);
// A line "current-asserts" a term unless it also carries a negation/removal marker.
const NEG = /\b(no|not|never|without|deleted|removed|no longer|superseded|gone|neither|zero|isn't|is not|does not|do not)\b/i;

// A line that asserts Cloud is unavailable in the beta.
const CLOUD_CLAIM = /cloud\b[^.]*\b(unavailable|not available|not part of the (invited|no-billing)? ?beta|no cloud for)/i;
// The claim is acceptable ONLY when it is EITHER explicitly limited to Free testers/users, OR it
// explicitly says existing/already-entitled paid-Pro accounts retain/keep access. Merely mentioning
// "paid-Pro" (e.g. "paid-Pro only") does NOT satisfy the exception.
const cloudExceptionOk = (line) => {
  const freeLimited = /\bfree (testers?|users?|accounts?)\b/i.test(line);
  const retainClause = /\b(existing|already)\b[^.]*\b(retain|keep)s?\b/i.test(line)
    || (/\b(retain|keep)s? access\b/i.test(line) && /\b(existing|paid[- ]?pro)\b/i.test(line));
  return freeLimited || retainClause;
};

describe('product_release documentation integrity', () => {
  it('every relative Markdown link in active docs resolves to a real repo path', () => {
    const broken = [];
    const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
    for (const doc of activeDocs) {
      const text = read(doc);
      let m;
      while ((m = linkRe.exec(text)) !== null) {
        let target = m[1].trim();
        if (/^(https?:|mailto:|#)/i.test(target)) continue; // external / anchor
        target = target.split('#')[0].replace(/:\d+(-\d+)?$/, ''); // strip #anchor and :line
        if (!target) continue;
        const abs = resolve(dirname(doc), target);
        if (!existsSync(abs)) broken.push(`${rel(doc)} -> ${m[1]}`);
      }
    }
    expect(broken, `broken links:\n${broken.join('\n')}`).toEqual([]);
  });

  it('CODEBASE_MAP.md points at real code/test paths', () => {
    const map = resolve(PR_DIR, 'CODEBASE_MAP.md');
    expect(existsSync(map), 'CODEBASE_MAP.md must exist').toBe(true);
    const text = read(map);
    const broken = [];
    const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
    let m;
    while ((m = linkRe.exec(text)) !== null) {
      let t = m[1].trim();
      if (/^(https?:|mailto:|#)/i.test(t)) continue;
      t = t.split('#')[0].replace(/:\d+(-\d+)?$/, '');
      const abs = resolve(PR_DIR, t);
      if (!existsSync(abs)) broken.push(m[1]);
    }
    expect(broken, `CODEBASE_MAP broken paths:\n${broken.join('\n')}`).toEqual([]);
  });

  it('no active doc describes the completion toast / PostSaveToast / "Next: Analytics" overlay as current', () => {
    const offenders = [];
    const termRe = /(completion toast|PostSaveToast|Next:\s*Analytics)/i;
    for (const doc of activeDocs) {
      read(doc).split('\n').forEach((line, i) => {
        if (termRe.test(line) && !NEG.test(line)) offenders.push(`${rel(doc)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, `stale current-toast claims:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('SOFT_RELEASE_TESTER_INSTRUCTIONS.md has no [insert link] placeholder or 1–10 rating', () => {
    const p = resolve(PR_DIR, 'SOFT_RELEASE_TESTER_INSTRUCTIONS.md');
    const text = read(p);
    expect(text.includes('[insert link]'), 'contains [insert link] placeholder').toBe(false);
    expect(/\b1\s*[–-]\s*10\b/.test(text), 'contains a 1–10 rating request').toBe(false);
  });

  it('BACKLOG.md does not re-list the completed P0.2 / P1.1 headings', () => {
    const text = read(resolve(PR_DIR, 'BACKLOG.md'));
    expect(text.includes('P0.2 — Private-first mode hierarchy'), 'P0.2 completed heading present').toBe(false);
    expect(text.includes('P1.1 — Private-first UX polish'), 'P1.1 completed heading present').toBe(false);
  });

  it('no active doc asserts #1006 is shipped/deployed/activated (it is DRAFT)', () => {
    const offenders = [];
    for (const doc of activeDocs) {
      read(doc).split('\n').forEach((line, i) => {
        if (!/#1006/.test(line)) return;
        // "shipped/deployed/activated/live" asserted on the same line without a draft/negation qualifier.
        if (/\b(shipped|deployed|activated|is live|went live|in production)\b/i.test(line)
            && !/\b(draft|not|never|pending|unactivated|un-activated|before|once|after|when|would|will|until|would-be)\b/i.test(line)) {
          offenders.push(`${rel(doc)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, `#1006-shipped claims:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('SOFT_RELEASE_TESTER_INSTRUCTIONS.md is not branded with the historical v0.9.0-rc4 / first-batch labels', () => {
    const text = read(resolve(PR_DIR, 'SOFT_RELEASE_TESTER_INSTRUCTIONS.md'));
    const offenders = text.split('\n')
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /\brc4\b|v0\.9\.0-rc4|first(-| )controlled batch|controlled first batch/i.test(l))
      .map(({ l, i }) => `${i + 1}: ${l.trim()}`);
    expect(offenders, `rc4/first-batch branding in tester instructions:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no active doc asserts Cloud is unavailable without the Free / existing-paid-Pro distinction', () => {
    const offenders = [];
    for (const doc of activeDocs) {
      read(doc).split('\n').forEach((line, i) => {
        if (CLOUD_CLAIM.test(line) && !cloudExceptionOk(line)) offenders.push(`${rel(doc)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, `unconditional Cloud-unavailable claims:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('Cloud-exception classifier: paid-Pro-only is rejected; Free-limited + existing-retain is accepted', () => {
    const flags = (line) => CLOUD_CLAIM.test(line) && !cloudExceptionOk(line);
    // Must FAIL the guard (unconditional / paid-Pro-only is not enough):
    expect(flags('Cloud is unavailable during the beta; paid-Pro only')).toBe(true);
    expect(flags('Cloud is unavailable during the no-billing beta.')).toBe(true);
    // Must PASS the guard (Free-limited and/or existing paid-Pro retains access):
    expect(flags('Cloud is unavailable to Free testers; existing paid-Pro retains access')).toBe(false);
    expect(flags('Cloud is not available to Free users during the no-billing beta')).toBe(false);
  });

  it('no active doc references the deleted "BACKLOG re-assessment addendum"', () => {
    const offenders = [];
    for (const doc of activeDocs) {
      read(doc).split('\n').forEach((line, i) => {
        if (/re-?assessment addendum/i.test(line)) offenders.push(`${rel(doc)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, `stale addendum references:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no active doc claims billing fail-closed depends on the Stripe key being absent or key-class alone', () => {
    const offenders = [];
    // The stale/wrong model ties CLOSURE (fail-closed / checkout closed) to key ABSENCE or key CLASS.
    // Both a closure concept AND a key-absence/class concept must appear on the line (so plain key-class
    // *classification* like `classifyStripeKey(...)` or a launch key-class proof is not a false positive).
    const closure = /\b(fail[- ]?closed|closure|checkout (is|remains|stays)[^.]*closed|(billing|payments?)[^.]*closed)\b/i;
    const keyDependence = /\bkey (being |is )?(absent|missing)\b|\b(absent|missing)\b[^.]*\bkey\b|\bkey[- ]?class\b/i;
    // A line that explicitly negates the bad model is fine — either the negation precedes the
    // key/absence concept ("does NOT depend on the key being absent", "independent of key presence"),
    // or it follows a key-class subject ("key class alone does NOT open checkout").
    const negatesBadModel = (line) =>
      /\b(not|no|regardless of|independent of|does not|doesn't)\b[^.]*\b(absent|absence|missing|present|presence|depend|key[- ]?class)\b/i.test(line)
      || /\bkey[- ]?class\b[^.]*\b(alone\b[^.]*)?(does not|do not|doesn't|is not|isn't|never|not\b)/i.test(line);
    for (const doc of activeDocs) {
      read(doc).split('\n').forEach((line, i) => {
        if (!/stripe|payment|checkout|billing/i.test(line)) return;
        if (closure.test(line) && keyDependence.test(line) && !negatesBadModel(line)) {
          offenders.push(`${rel(doc)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, `stale billing-loading-model (key-absent / key-class) claims:\n${offenders.join('\n')}`).toEqual([]);

    // ...and the canonical inventory must document BOTH payment switches (the real closure control).
    const env = read(resolve(PR_DIR, 'ENV_INVENTORY.md'));
    expect(env.includes('VITE_PAYMENTS_ENABLED'), 'ENV_INVENTORY must document VITE_PAYMENTS_ENABLED').toBe(true);
    expect(/(^|[^_A-Z])PAYMENTS_ENABLED\b/m.test(env), 'ENV_INVENTORY must document PAYMENTS_ENABLED').toBe(true);
  });

  it('the active docs set is non-trivial (guard against an empty scan)', () => {
    const realFiles = activeDocs.filter((p) => statSync(p).isFile());
    expect(realFiles.length).toBeGreaterThan(10);
  });
});
