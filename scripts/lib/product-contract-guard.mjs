import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.html', '.js', '.jsx', '.json', '.md', '.mjs', '.mts',
  '.sh', '.sql', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);

// These locations preserve immutable or explicitly historical evidence. They are the only broad
// exclusions: current source, tests, workflows, root docs and product_release/*.md are scanned.
export const HISTORICAL_EXCLUSIONS = Object.freeze([
  'backend/supabase/migrations/',
  'product_release/archive/',
  'product_release/evidence/',
  'product_release/v4_work/',
]);

const GUARD_INFRASTRUCTURE = new Set([
  'scripts/lib/product-contract-guard.mjs',
  'scripts/product-contract-guard.mjs',
  'tests/release/flawless-launch-product-contract-guard.test.ts',
]);

const CUSTOMER_AUTHORITY = /^(?:README\.md|USER_GUIDE\.md|frontend\/(?:index\.html|public\/|src\/(?:components|content|pages)\/)|product_release\/(?:ARCHITECTURE|ENTITLEMENTS_AND_BILLING|OPERATIONS_AND_SECURITY|PRODUCT_REQUIREMENTS|QUALITY|RELEASE_PROCESS|STT|TESTER_GUIDE|TESTER_OPERATIONS)\.md$)/;
const RUNTIME_OR_GATE = /^(?:frontend\/src\/|backend\/supabase\/functions\/|scripts\/|tests\/(?:canary|e2e|live|release)\/|\.github\/workflows\/)/;
const isTestImplementation = (path) => /(?:\/__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$)/.test(path);
const isCustomerAuthority = (path) => CUSTOMER_AUTHORITY.test(path) && !isTestImplementation(path);
const isActiveRuntimeOrGate = (path) => RUNTIME_OR_GATE.test(path)
  && !((path.startsWith('frontend/src/') || path.startsWith('backend/supabase/functions/')) && isTestImplementation(path));
const NEGATED_OR_HISTORICAL = /\b(?:no|not|never|without|remove(?:d|s|ing)?|retire(?:d|s|ment)?|reject(?:ed|s|ing)?|forbid(?:den|s)?|prohibit(?:ed|s)?|obsolete|abandoned|deprecated|historical|former|earlier|old|stale|superseded|mustn['’]t|must not|may not|doesn['’]t|does not|isn['’]t|is not|aren['’]t|are not)\b/i;

const rules = [
  {
    id: 'retired-private-sample',
    applies: (path) => isActiveRuntimeOrGate(path) || isCustomerAuthority(path),
    matches: (unit) => /\bprivate[_ -]?sample(?:_[a-z0-9_]+)?\b/i.test(unit)
      || /\b(?:five|5)[ -]?minute\b[^\n]{0,100}\b(?:private|sample|record(?:ing)?)\b/i.test(unit)
      || /\b(?:private|sample|record(?:ing)?)\b[^\n]{0,100}\b(?:five|5)[ -]?minute\b/i.test(unit),
  },
  {
    id: 'permanent-free-product',
    applies: (path) => isCustomerAuthority(path) || /^(?:tests\/(?:canary|e2e|live)|\.github\/workflows)\//.test(path),
    matches: (unit) => /\b(?:free forever|permanent(?:ly)? free|feature[- ]limited free|free (?:product|plan|tier)|basic (?:product|plan|tier))\b/i.test(unit),
  },
  {
    id: 'browser-cloud-customer-entitlement',
    applies: (path) => isCustomerAuthority(path),
    matches: (unit) => /\b(?:Browser|Cloud)\b/.test(unit) && (
      /\b(?:Browser|Cloud)\b[^\n]{0,100}\b(?:customer|entitlement|mode|option|choice|plan|tier|pro|select|switch|available|fallback|upgrade|try|start)\b/i.test(unit)
      || /\b(?:customer|entitlement|mode|option|choice|plan|tier|pro|select|switch|available|fallback|upgrade|try|start)\b[^\n]{0,100}\b(?:Browser|Cloud)\b/i.test(unit)
    ),
  },
  {
    id: 'accumulated-minute-quota',
    applies: (path) => isActiveRuntimeOrGate(path) || isCustomerAuthority(path),
    matches: (unit) => /\b(?:1|2|25|50)[ -]?(?:hour|hr)s?\s*(?:\/|per)\s*(?:day|month)\b/i.test(unit)
      || /\b(?:daily|monthly|recording[- ]time|accumulated[- ]minute)[ -_]?(?:quota|limit|remaining|allowance|upsell)\b/i.test(unit)
      || /\b(?:7200|180000)\b[^\n]{0,50}\b(?:seconds?|quota|limit|usage)\b/i.test(unit)
      || /\b(?:seconds?|quota|limit|usage)\b[^\n]{0,50}\b(?:7200|180000)\b/i.test(unit),
  },
  {
    id: 'wrong-launch-price',
    applies: (path) => isActiveRuntimeOrGate(path) || isCustomerAuthority(path),
    matches: (unit) => /\$\s*9\.99\b/.test(unit)
      || /\b999\s*(?:cents?|¢)\b/i.test(unit)
      || /\b(?:amount|price|unit_amount)[^\n]{0,40}\b999\b/i.test(unit)
      || /\b999\b[^\n]{0,40}\b(?:amount|price|unit_amount)\b/i.test(unit),
  },
];

const normalize = (value) => value.replace(/\s+/g, ' ').trim();

function unitsFor(path, source) {
  // Scan Markdown line-by-line too. Treating a whole multi-bullet paragraph as one unit allowed a
  // single explicit retirement statement to suppress a contradictory positive claim beside it.
  return source.split('\n').map((text, index) => ({ line: index + 1, text: normalize(text) }));
}

export function isExcluded(path) {
  return GUARD_INFRASTRUCTURE.has(path)
    || HISTORICAL_EXCLUSIONS.some((prefix) => path.startsWith(prefix));
}

export function scanText(path, source) {
  if (isExcluded(path)) return [];
  const violations = [];

  for (const unit of unitsFor(path, source)) {
    if (!unit.text || NEGATED_OR_HISTORICAL.test(unit.text)) continue;
    for (const rule of rules) {
      if (rule.applies(path) && rule.matches(unit.text)) {
        violations.push({ path, line: unit.line, rule: rule.id, excerpt: unit.text.slice(0, 240) });
      }
    }
  }
  return violations;
}

export function trackedTextFiles(root) {
  // Include untracked candidate files as well as tracked files so the guard cannot be bypassed by adding
  // a new customer surface in the same change. Deleted tracked files are removed by existsSync below.
  const output = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  return output.split('\0')
    .filter(Boolean)
    .filter((path) => TEXT_EXTENSIONS.has(extname(path).toLowerCase()))
    .filter((path) => !isExcluded(path))
    .filter((path) => existsSync(resolve(root, path)));
}

export function scanRepository(root = process.cwd()) {
  const absoluteRoot = resolve(root);
  return trackedTextFiles(absoluteRoot).flatMap((path) => {
    const absolute = resolve(absoluteRoot, path);
    const repoPath = relative(absoluteRoot, absolute).replaceAll('\\', '/');
    return scanText(repoPath, readFileSync(absolute, 'utf8'));
  });
}

export function formatViolations(violations) {
  return violations
    .map(({ path, line, rule, excerpt }) => `${path}:${line} [${rule}] ${excerpt}`)
    .join('\n');
}
