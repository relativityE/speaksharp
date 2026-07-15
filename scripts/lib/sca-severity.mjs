/**
 * CVSS v3.0/3.1 base-score computation (official spec) + OSV severity mapping.
 * Pure, dependency-free, unit-tested (tests/sca/sca-gate.test.ts).
 */
const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC = { L: 0.77, H: 0.44 };
const UI = { N: 0.85, R: 0.62 };
const PR_U = { N: 0.85, L: 0.62, H: 0.27 };
const PR_C = { N: 0.85, L: 0.68, H: 0.5 };
const CIA = { H: 0.56, L: 0.22, N: 0 };

// CVSS 3.1 roundup (avoids binary-float drift).
function roundup(x) {
  const i = Math.round(x * 100000);
  if (i % 10000 === 0) return i / 100000;
  return (Math.floor(i / 10000) + 1) / 10;
}

/**
 * @param {string} vector e.g. "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
 * @returns {number|null} base score 0.0–10.0, or null if not a parseable CVSS v3 vector.
 */
export function cvssBaseScore(vector) {
  if (typeof vector !== 'string') return null;
  if (!/^CVSS:3\.[01]\//.test(vector)) return null;
  const m = Object.fromEntries(
    vector.split('/').slice(1).map((p) => p.split(':')).filter((kv) => kv.length === 2),
  );
  const scopeChanged = m.S === 'C';
  const av = AV[m.AV], ac = AC[m.AC], ui = UI[m.UI];
  const pr = (scopeChanged ? PR_C : PR_U)[m.PR];
  const c = CIA[m.C], i = CIA[m.I], a = CIA[m.A];
  if ([av, ac, ui, pr, c, i, a].some((v) => v === undefined)) return null;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
    : 6.42 * iss;
  const exploitability = 8.22 * av * ac * pr * ui;
  if (impact <= 0) return 0;
  const raw = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);
  return roundup(raw);
}

/** CVSS base score → qualitative rating. */
export function scoreToRating(score) {
  if (score == null || Number.isNaN(score)) return 'UNKNOWN';
  if (score >= 9.0) return 'CRITICAL';
  if (score >= 7.0) return 'HIGH';
  if (score >= 4.0) return 'MODERATE';
  if (score > 0) return 'LOW';
  return 'NONE';
}

/**
 * Determine an OSV vulnerability's severity.
 * Order: explicit GHSA rating (database_specific.severity) → CVSS vector → UNKNOWN.
 * @returns {'CRITICAL'|'HIGH'|'MODERATE'|'LOW'|'NONE'|'UNKNOWN'}
 */
export function severityOf(vuln) {
  const ds = String(vuln?.database_specific?.severity || '').toUpperCase();
  if (['CRITICAL', 'HIGH', 'MODERATE', 'MEDIUM', 'LOW'].includes(ds)) {
    return ds === 'MEDIUM' ? 'MODERATE' : ds;
  }
  for (const s of vuln?.severity || []) {
    if (/CVSS/i.test(s?.type || '') && typeof s?.score === 'string') {
      const rating = scoreToRating(cvssBaseScore(s.score));
      if (rating !== 'UNKNOWN') return rating;
    }
  }
  return 'UNKNOWN';
}
