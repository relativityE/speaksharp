/**
 * #1294 — ONE strict shared parser for the `AUDIT_EXCLUDED_EMAILS_JSON` exclusion manifest, used by BOTH
 * `tester-evidence-audit.mjs` and `tester-cohort-audit.mjs`. It FAILS CLOSED before any Supabase access or
 * artifact publication. Category NAMES may appear in returned errors (not secret); addresses never do.
 *
 * Contract:
 *  - manifest required and nonempty;
 *  - a JSON OBJECT with EXACTLY the five canonical category keys (each must be present, even if empty);
 *  - each category is an ARRAY of syntactically-valid, normalized (trim+lowercase) email strings;
 *  - same-category duplicates dedupe; a cross-category duplicate FAILS CLOSED (no first-category-wins);
 *  - `speaksharp.app` and every subdomain are REJECTED (SpeakSharp does not own that domain);
 *  - loosely-shaped JSON (bare array, object of the wrong keys, non-array category) is rejected.
 */

export const MANIFEST_CATEGORIES = ['owner_admin', 'synthetic', 'checkout', 'canary', 'qa'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROHIBITED_APEX = 'speaksharp.app';

/** True when the email's domain is the unaffiliated speaksharp.app apex or any subdomain. */
export function isProhibitedManifestDomain(normalizedEmail) {
  const domain = String(normalizedEmail).split('@')[1] || '';
  return domain === PROHIBITED_APEX || domain.endsWith(`.${PROHIBITED_APEX}`);
}

/**
 * @param {string|undefined|null} raw the raw AUDIT_EXCLUDED_EMAILS_JSON value
 * @returns {{ ok: true, byEmail: Map<string,string> } | { ok: false, error: string }}
 */
export function parseExclusionManifest(raw) {
  if (!raw || !raw.trim()) return { ok: false, error: 'AUDIT_EXCLUDED_EMAILS_JSON is absent/empty' };
  let obj;
  try { obj = JSON.parse(raw); } catch { return { ok: false, error: 'AUDIT_EXCLUDED_EMAILS_JSON is not valid JSON' }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'manifest must be a JSON object of categorized arrays (not an array or scalar)' };
  }
  const keys = Object.keys(obj);
  const unknown = keys.filter((k) => !MANIFEST_CATEGORIES.includes(k));
  if (unknown.length) return { ok: false, error: `manifest has unknown category name(s): ${unknown.join(', ')}` };
  const missing = MANIFEST_CATEGORIES.filter((c) => !keys.includes(c));
  if (missing.length) return { ok: false, error: `manifest is missing required category name(s): ${missing.join(', ')}` };

  const byEmail = new Map(); // normalized email -> category
  for (const cat of MANIFEST_CATEGORIES) {
    const arr = obj[cat];
    if (!Array.isArray(arr)) return { ok: false, error: `category '${cat}' must be an array` };
    const seenInCat = new Set();
    for (const entry of arr) {
      if (typeof entry !== 'string' || !entry.trim()) return { ok: false, error: `category '${cat}' has a blank or non-string entry` };
      const norm = entry.trim().toLowerCase();
      if (!EMAIL_RE.test(norm)) return { ok: false, error: `category '${cat}' has an entry that is not a syntactically valid email` };
      if (isProhibitedManifestDomain(norm)) {
        return { ok: false, error: `category '${cat}' contains a prohibited speaksharp.app (apex or subdomain) identity — failing closed` };
      }
      if (seenInCat.has(norm)) continue; // same-category duplicates dedupe
      seenInCat.add(norm);
      const prior = byEmail.get(norm);
      if (prior && prior !== cat) return { ok: false, error: `an address appears in two categories ('${prior}' and '${cat}') — ambiguous; failing closed` };
      byEmail.set(norm, cat);
    }
  }
  if (byEmail.size === 0) return { ok: false, error: 'manifest contains no addresses' };
  return { ok: true, byEmail };
}

/**
 * Strict parse-or-abort for a script entry point. On any validation failure it prints the sanitized
 * (address-free) error and exits non-zero BEFORE any client construction. Returns the { byEmail } map.
 */
export function requireExclusionManifest(raw, { label = 'audit', exit = (c) => process.exit(c), log = console.error } = {}) {
  const res = parseExclusionManifest(raw);
  if (!res.ok) {
    log(`[${label}] AUDIT_EXCLUDED_EMAILS_JSON invalid — FAILING CLOSED before any data access: ${res.error}`);
    exit(1);
    return { byEmail: new Map() }; // unreachable in production (exit throws/terminates); helps tests
  }
  return { byEmail: res.byEmail };
}
