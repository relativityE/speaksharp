/**
 * SCA Gate 4 decision logic (pure). Dedupes by advisory, applies the ignore
 * policy, and blocks on any distinct CRITICAL or UNKNOWN-severity advisory that
 * is not explicitly ignored. UNKNOWN never silently passes (fail-safe).
 */
import { severityOf } from './sca-severity.mjs';

/**
 * Classify an osv-scanner execution outcome and fail CLOSED on anything that is
 * not a clean run.
 *
 * osv-scanner exit codes: 0 = no vulnerabilities, 1 = vulnerabilities found
 * (documented). Only those two produce trustworthy stdout to evaluate. Any
 * other outcome — 127 (not found), 128/129, signal termination, missing status,
 * or any other nonzero — is an infrastructure/scanner failure; its partial
 * stdout must NOT be parsed.
 *
 * @param {{status:(number|null|undefined), signal:(string|null|undefined), stdout:*}} result
 * @returns {string} stdout to parse (exit 0 or 1 only)
 * @throws {Error} on any infra/scanner failure
 */
export function scannerStdoutOrThrow(result) {
  if (result && result.signal) {
    throw new Error(`osv-scanner terminated by signal ${result.signal} — scanner/infrastructure failure`);
  }
  const status = result ? result.status : undefined;
  if (status === 0 || status === 1) {
    return result.stdout != null ? String(result.stdout) : '';
  }
  throw new Error(`osv-scanner exited with status ${status ?? 'none'} — scanner/infrastructure failure (partial output not parsed)`);
}

/** Parse osv-scanner JSON; throws a clear error on invalid input. */
export function parseOsvJson(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('empty osv-scanner output');
  }
  let data;
  try { data = JSON.parse(raw); } catch (e) {
    throw new Error(`invalid osv-scanner JSON: ${e.message}`);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    throw new Error('unexpected osv-scanner JSON shape (missing results[])');
  }
  return data;
}

/**
 * @param {object} data parsed osv-scanner JSON
 * @param {Set<string>} ignore uppercased advisory ids to suppress
 * @returns {{histogram:object, distinct:Array, blocking:Array, pass:boolean}}
 */
export function evaluateOsv(data, ignore = new Set()) {
  const histogram = { CRITICAL: 0, HIGH: 0, MODERATE: 0, LOW: 0, NONE: 0, UNKNOWN: 0 };
  const byAdvisory = new Map();
  for (const r of data.results || []) {
    for (const p of r.packages || []) {
      for (const v of p.vulnerabilities || []) {
        const severity = severityOf(v);
        histogram[severity] = (histogram[severity] || 0) + 1;
        // A gate-relevant advisory is CRITICAL or UNKNOWN (fail-safe).
        if (severity !== 'CRITICAL' && severity !== 'UNKNOWN') continue;
        const ids = [v.id, ...(v.aliases || [])].filter(Boolean);
        const key = ids.find((i) => /^GHSA-/i.test(i)) || v.id;
        const ignored = ids.some((i) => ignore.has(String(i).toUpperCase()));
        // Keep the strongest classification if the same advisory recurs.
        const prev = byAdvisory.get(key);
        byAdvisory.set(key, {
          key, ids, severity, ignored,
          pkg: p.package?.name, ver: p.package?.version,
          summary: (v.summary || '').slice(0, 100),
          paths: (prev?.paths || 0) + 1,
        });
      }
    }
  }
  const distinct = [...byAdvisory.values()];
  const blocking = distinct.filter((c) => !c.ignored);
  return { histogram, distinct, blocking, pass: blocking.length === 0 };
}

/** Load the suppression allowlist from package.json (single source of truth). */
export function ignoreSetFromPkg(pkg) {
  const list = pkg?.pnpm?.auditConfig?.ignoreGhsas ?? [];
  return new Set(list.map((s) => String(s).toUpperCase()));
}
