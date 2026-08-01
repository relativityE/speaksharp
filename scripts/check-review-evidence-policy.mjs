import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(MODULE_PATH), '..');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

export const APPROVED_SCREENSHOT_UPLOADS = new Set([
  'ci.yml::ux-review-screenshots-shard-${{ matrix.shard }}',
  'review-evidence.yml::pr${{ github.event.inputs.pr }}-${{ github.event.inputs.reviewed_sha }}-mode-selector-screenshots',
]);

// Historical binaries predate #1132. They are inventoried, not deleted or
// expanded. Any new review binary committed outside this exact baseline fails.
export const LEGACY_COMMITTED_REVIEW_BINARIES = new Set([
  'docs/evidence/1041/browser-selector-desktop.png',
  'docs/evidence/1041/browser-selector-mobile.png',
  'product_release/evidence/beta50_private_2026-07-10/desktop-private-cached-return.jpg',
  'product_release/evidence/beta50_private_2026-07-10/mobile-private-recording.jpg',
]);

const AUTOMATED_PLAYWRIGHT_CONFIGS = [
  'playwright.base.config.ts',
  'playwright.config.ts',
  'playwright.live.config.ts',
  'playwright.deployed-live.config.ts',
  'playwright.canary.config.ts',
  'playwright.soak.config.ts',
  'playwright.stripe.config.ts',
];

function indentation(line) {
  return line.length - line.trimStart().length;
}

function scalarAfter(lines, start, end, key) {
  for (let index = start; index < end; index += 1) {
    const match = lines[index].match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`));
    if (match) return match[1].replace(/^['"]|['"]$/g, '');
  }
  return undefined;
}

function pathEntries(lines, start, end) {
  for (let index = start; index < end; index += 1) {
    const match = lines[index].match(/^(\s*)path:\s*(.*?)\s*$/);
    if (!match) continue;
    if (match[2] && match[2] !== '|') return [match[2].replace(/^['"]|['"]$/g, '')];

    const pathIndent = match[1].length;
    const entries = [];
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      if (!lines[cursor].trim()) continue;
      if (indentation(lines[cursor]) <= pathIndent) break;
      entries.push(lines[cursor].trim().replace(/^['"]|['"]$/g, ''));
    }
    return entries;
  }
  return [];
}

export function inventoryArtifactUploads(repoRoot = REPO_ROOT) {
  const workflowDir = join(repoRoot, '.github', 'workflows');
  const inventory = [];

  for (const workflow of readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name)).sort()) {
    const lines = readFileSync(join(workflowDir, workflow), 'utf8').split(/\r?\n/);
    for (let usesIndex = 0; usesIndex < lines.length; usesIndex += 1) {
      if (!/uses:\s*actions\/upload-artifact@/.test(lines[usesIndex])) continue;

      const usesIndent = indentation(lines[usesIndex]);
      let end = lines.length;
      for (let cursor = usesIndex + 1; cursor < lines.length; cursor += 1) {
        if (/^\s*-\s+/.test(lines[cursor]) && indentation(lines[cursor]) < usesIndent) {
          end = cursor;
          break;
        }
      }

      const name = scalarAfter(lines, usesIndex + 1, end, 'name');
      inventory.push({
        workflow,
        name,
        key: `${workflow}::${name ?? '<missing-name>'}`,
        paths: pathEntries(lines, usesIndex + 1, end),
        retentionDays: scalarAfter(lines, usesIndex + 1, end, 'retention-days'),
        ifNoFilesFound: scalarAfter(lines, usesIndex + 1, end, 'if-no-files-found'),
      });
    }
  }

  return inventory;
}

export function committedReviewBinaries(repoRoot = REPO_ROOT) {
  const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  return tracked.filter((path) =>
    /(^|\/)(?:evidence|test-results|playwright-report|screenshots?)(\/|$)/i.test(path)
    && /\.(?:png|jpe?g|webp|webm|mp4|zip|trace)$/i.test(path));
}

export function reviewEvidencePolicyViolations(repoRoot = REPO_ROOT) {
  const violations = [];
  const inventory = inventoryArtifactUploads(repoRoot);

  for (const artifact of inventory) {
    if (!artifact.name) violations.push(`${artifact.workflow}: upload-artifact is missing an artifact name`);
    if (!artifact.retentionDays) violations.push(`${artifact.key}: retention-days is required`);

    const screenshotLike = /screenshot/i.test(artifact.name ?? '')
      || artifact.paths.some((path) => /\.png$|\.png\b/i.test(path));
    if (screenshotLike) {
      if (!APPROVED_SCREENSHOT_UPLOADS.has(artifact.key)) {
        violations.push(`${artifact.key}: screenshot upload is not approved`);
      }
      if (artifact.retentionDays !== '1') {
        violations.push(`${artifact.key}: screenshot retention must be exactly one day`);
      }
      for (const path of artifact.paths) {
        if (!/\.png(?:$|\b)/i.test(path)) {
          violations.push(`${artifact.key}: screenshot artifacts must select PNG files only (${path})`);
        }
      }
    }

    for (const path of artifact.paths) {
      if (/(?:trace\.zip|\.webm\b|\.mp4\b|storage[-_]?state|cookies?\.json|\.env(?:\.|$))/i.test(path)) {
        violations.push(`${artifact.key}: forbidden browser/session artifact path (${path})`);
      }
    }
  }

  for (const workflow of readdirSync(join(repoRoot, '.github', 'workflows')).filter((name) => /\.ya?ml$/.test(name))) {
    const lines = readFileSync(join(repoRoot, '.github', 'workflows', workflow), 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (/^\s*(?:zip|tar|7z)\s/.test(line) && !/^\s*#/.test(line)) {
        violations.push(`${workflow}:${index + 1}: custom archive creation is forbidden`);
      }
    }
  }

  for (const config of AUTOMATED_PLAYWRIGHT_CONFIGS) {
    const contents = readFileSync(join(repoRoot, config), 'utf8');
    for (const match of contents.matchAll(/^\s*(trace|video|screenshot):\s*['"]([^'"]+)['"]/gm)) {
      if (match[2] !== 'off') {
        violations.push(`${config}: automated ${match[1]} capture must be off (found ${match[2]})`);
      }
    }
    if (/storageState:\s*['"]/.test(contents)) {
      violations.push(`${config}: persisted storageState files are forbidden in automation`);
    }
  }

  const committed = new Set(committedReviewBinaries(repoRoot));
  for (const path of committed) {
    if (!LEGACY_COMMITTED_REVIEW_BINARIES.has(path)) {
      violations.push(`${path}: committed binary review evidence is forbidden`);
    }
  }
  for (const path of LEGACY_COMMITTED_REVIEW_BINARIES) {
    if (!committed.has(path)) violations.push(`${path}: legacy evidence baseline changed; deletion requires separate authorization`);
  }

  return violations;
}

if (process.argv[1] && basename(process.argv[1]) === basename(MODULE_PATH)) {
  const inventory = inventoryArtifactUploads();
  const violations = reviewEvidencePolicyViolations();
  console.log(JSON.stringify({ inventory, violations }, null, 2));
  if (violations.length) process.exitCode = 1;
}
