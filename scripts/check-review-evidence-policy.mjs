import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(MODULE_PATH), '..');

export const APPROVED_SCREENSHOT_UPLOADS = new Set([
  'ci.yml::ux-review-screenshots-shard-${{ matrix.shard }}',
  'review-evidence.yml::pr${{ github.event.inputs.pr }}-${{ github.event.inputs.reviewed_sha }}-mode-selector-screenshots',
]);

// Product/marketing assets have a runtime purpose independent of code review.
// New binary files everywhere else are review evidence unless explicitly added
// to this narrow allowlist through a separately reviewed product change.
export const APPROVED_PRODUCT_BINARY_ROOTS = new Set([
  'frontend/public/',
  'video-production/',
]);

// Historical binaries predate #1132. They are inventoried, not deleted or
// expanded. Any new review binary committed outside an approved product-asset
// root fails regardless of the directory name chosen for it.
export const LEGACY_COMMITTED_REVIEW_BINARIES = new Set([
  'docs/evidence/1041/browser-selector-desktop.png',
  'docs/evidence/1041/browser-selector-mobile.png',
  'product_release/evidence/beta50_private_2026-07-10/desktop-private-cached-return.jpg',
  'product_release/evidence/beta50_private_2026-07-10/mobile-private-recording.jpg',
]);

// This config is a developer-invoked demo recorder, not an automated review
// lane. It remains explicit and fails policy if any Actions workflow invokes it.
export const LOCAL_ONLY_MEDIA_PLAYWRIGHT_CONFIGS = new Set([
  'playwright.demo.config.ts',
]);

// Compiled runtime output is a deployable product artifact, not review evidence.
// Its source assets are governed by the product-asset allowlist above.
export const NON_REVIEW_DIRECTORY_UPLOADS = new Set([
  'ci.yml::build-artifacts',
]);

// Existing test audio is executable fixture input, not review evidence. Keep
// this allowlist file-exact so a future binary placed anywhere under tests/
// does not inherit approval from its directory name.
export const APPROVED_TEST_BINARY_FIXTURES = new Set([
  'tests/evidence/fixtures/corpus/fixture-001.wav',
  'tests/evidence/fixtures/corpus/fixture-002.wav',
  'tests/evidence/fixtures/corpus/fixture-003.wav',
  'tests/fixtures/120sec_tone_16k.wav',
  'tests/fixtures/harvard_01_16k.wav',
  'tests/fixtures/harvard_benchmark_16k.wav',
  'tests/fixtures/harvard_benchmark_16k_loop_120s.wav',
  'tests/fixtures/harvard_sentences_16k.wav',
  'tests/fixtures/jfk.flac',
  'tests/fixtures/jfk_16k.wav',
  'tests/fixtures/softonset_my_main_point_16k.wav',
  'tests/fixtures/stt-isomorphic/audio/conv_01.wav',
  'tests/fixtures/stt-isomorphic/audio/conv_02.wav',
  'tests/fixtures/stt-isomorphic/audio/h1_1.wav',
  'tests/fixtures/stt-isomorphic/audio/h1_10.wav',
  'tests/fixtures/stt-isomorphic/audio/h1_2.wav',
  'tests/fixtures/stt-isomorphic/audio/h1_3.wav',
  'tests/fixtures/stt-isomorphic/audio/h1_4.wav',
  'tests/fixtures/stt-isomorphic/audio/h1_5.wav',
  'tests/fixtures/stt-isomorphic/audio/h1_6.wav',
  'tests/fixtures/stt-isomorphic/audio/h1_7.wav',
  'tests/fixtures/stt-isomorphic/audio/h1_8.wav',
  'tests/fixtures/stt-isomorphic/audio/h1_9.wav',
  'tests/fixtures/stt-isomorphic/audio/washington_01.wav',
  'tests/fixtures/test-audio.wav',
  'tests/fixtures/test_speech.aiff',
  'tests/fixtures/test_speech_16k.wav',
]);

const BROAD_UPLOAD_SCANNER_EXEMPTIONS = new Set([
  ...APPROVED_SCREENSHOT_UPLOADS,
  ...NON_REVIEW_DIRECTORY_UPLOADS,
]);
const KNOWN_BINARY_EXTENSIONS = new Set([
  '.7z', '.aif', '.aiff', '.avi', '.bmp', '.bz2', '.doc', '.docx', '.flac', '.gif', '.gz', '.har', '.ico',
  '.jpeg', '.jpg', '.m4a', '.mkv', '.mov', '.mp3', '.mp4', '.ogg', '.onnx', '.otf', '.pdf', '.png', '.ppt',
  '.pptx', '.rar', '.tar', '.tif', '.tiff', '.trace', '.wav', '.webm', '.webp', '.woff', '.woff2', '.xls',
  '.xlsx', '.xz', '.zip',
]);
const TEXT_CONTROL_EXCEPTIONS = new Set([
  // Contains an intentional NUL-character validation case inside a TypeScript
  // string literal. This is source text, not an embedded review artifact.
  'frontend/src/hooks/__tests__/useUserFillerWords.test.ts',
]);
const BINARY_MAGIC_PREFIXES = [
  Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG
  Buffer.from('GIF87a'),
  Buffer.from('GIF89a'),
  Buffer.from('%PDF-'),
  Buffer.from('RIFF'),
  Buffer.from('FORM'),
  Buffer.from('fLaC'),
  Buffer.from('OggS'),
  Buffer.from('ID3'),
  Buffer.from('PK\x03\x04', 'binary'), // ZIP and Office containers
  Buffer.from([0xff, 0xd8, 0xff]), // JPEG
  Buffer.from('BM'),
  Buffer.from([0x49, 0x49, 0x2a, 0x00]), // little-endian TIFF
  Buffer.from([0x4d, 0x4d, 0x00, 0x2a]), // big-endian TIFF
];
const FORBIDDEN_ARTIFACT_PATH = /(?:\.(?:png|jpe?g|webp|webm|mp4|mov|har)$|trace\.zip$|storage[-_]?state|cookies?\.json|\.env(?:\.|$))/i;
const TEXT_EXTENSIONS = new Set([
  '.css', '.csv', '.html', '.js', '.json', '.jsonl', '.log', '.md', '.mjs', '.svg', '.txt', '.xml', '.yaml', '.yml',
]);
const MAX_INSPECTABLE_TEXT_BYTES = 10 * 1024 * 1024;
const SENSITIVE_TEXT_PATTERNS = [
  ['email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['UUID', /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i],
  ['bearer credential', /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/i],
  ['embedded browser media', /data:(?:image|audio|video)\//i],
  ['session or user content', /["'](?:access_token|refresh_token|id_token|password|cookie|storageState|transcript|prompt|brief|required_points?)["']\s*:\s*["'][^"']+["']/i],
];

function indentation(line) {
  return line.length - line.trimStart().length;
}

function gitTrackedFiles(repoRoot, pathspecs = []) {
  return execFileSync('git', ['ls-files', '-z', ...pathspecs], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
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

function jobBounds(lines, lineIndex) {
  let start = 0;
  for (let cursor = lineIndex; cursor >= 0; cursor -= 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[cursor])) {
      start = cursor;
      break;
    }
  }
  let end = lines.length;
  for (let cursor = lineIndex + 1; cursor < lines.length; cursor += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[cursor])) {
      end = cursor;
      break;
    }
  }
  return { start, end };
}

function uploadStepStart(lines, usesIndex) {
  const usesIndent = indentation(lines[usesIndex]);
  for (let cursor = usesIndex; cursor >= 0; cursor -= 1) {
    if (/^\s*-\s+(?:name|uses):/.test(lines[cursor]) && indentation(lines[cursor]) < usesIndent) return cursor;
  }
  return usesIndex;
}

function pathAppearsBroad(path) {
  const withoutWorkspace = path.replace(/^\$\{\{\s*github\.workspace\s*\}\}\//, '');
  if (/\$\{\{/.test(withoutWorkspace)) return true;
  if (/[*?[\]]/.test(withoutWorkspace) || withoutWorkspace.endsWith('/')) return true;
  if (withoutWorkspace.startsWith('/')) return false;
  return extname(withoutWorkspace) === '';
}

function isBroadUpload(paths) {
  return paths.some(pathAppearsBroad);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      const paths = pathEntries(lines, usesIndex + 1, end);
      const key = `${workflow}::${name ?? '<missing-name>'}`;
      const { start: jobStart } = jobBounds(lines, usesIndex);
      const jobTextBeforeUpload = lines.slice(jobStart, usesIndex).join('\n');
      const stepStart = uploadStepStart(lines, usesIndex);
      const scannerPattern = new RegExp(
        `id:\\s*(review_evidence_scan[A-Za-z0-9_-]*)[\\s\\S]{0,300}?node scripts/check-review-evidence-policy\\.mjs --scan-upload ['"]${escapeRegex(key)}['"]`,
      );
      const scannerMatch = jobTextBeforeUpload.match(scannerPattern);
      inventory.push({
        workflow,
        name,
        key,
        paths,
        retentionDays: scalarAfter(lines, usesIndex + 1, end, 'retention-days'),
        ifNoFilesFound: scalarAfter(lines, usesIndex + 1, end, 'if-no-files-found'),
        uploadIf: scalarAfter(lines, stepStart, usesIndex, 'if'),
        broadUpload: isBroadUpload(paths),
        scannerId: scannerMatch?.[1],
        hasPreUploadScanner: Boolean(scannerMatch),
      });
    }
  }

  return inventory;
}

export function playwrightConfigFiles(repoRoot = REPO_ROOT) {
  return gitTrackedFiles(repoRoot, ['playwright*.config.ts']).sort();
}

function isApprovedProductBinary(path) {
  return [...APPROVED_PRODUCT_BINARY_ROOTS].some((root) => path.startsWith(root));
}

function hasBinaryMagic(contents) {
  return BINARY_MAGIC_PREFIXES.some((prefix) => contents.subarray(0, prefix.length).equals(prefix));
}

export function committedReviewBinaries(repoRoot = REPO_ROOT) {
  return gitTrackedFiles(repoRoot)
    .filter((path) => !isApprovedProductBinary(path))
    .filter((path) => {
      const absolute = join(repoRoot, path);
      if (lstatSync(absolute).isSymbolicLink()) return true;

      const extension = extname(path).toLowerCase();
      if (KNOWN_BINARY_EXTENSIONS.has(extension)) return true;

      const contents = readFileSync(absolute);
      if (contents.length === 0) return false;
      if (hasBinaryMagic(contents)) return true;
      if (TEXT_CONTROL_EXCEPTIONS.has(path)) return false;
      if (contents.includes(0)) return true;
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(contents);
        const forbiddenControls = [...text].filter((character) => {
          const code = character.charCodeAt(0);
          return code < 32 && !['\t', '\n', '\r', '\f'].includes(character);
        }).length;
        return forbiddenControls / text.length > 0.005;
      } catch {
        return true;
      }
    });
}

function walkFiles(path) {
  if (!existsSync(path)) return [];
  const rootStat = lstatSync(path);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walkFiles(child) : [child];
  });
}

function inspectSensitiveText(contents, displayPath) {
  const violations = [];
  for (const [label, pattern] of SENSITIVE_TEXT_PATTERNS) {
    if (pattern.test(contents)) violations.push(`${displayPath}: forbidden ${label} in artifact content`);
  }
  return violations;
}

function inspectZip(file, displayPath) {
  const violations = [];
  let entries;
  try {
    entries = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
      .split(/\r?\n/)
      .filter((entry) => entry && !entry.endsWith('/'));
  } catch {
    return [`${displayPath}: archive could not be inspected; upload denied`];
  }

  for (const entry of entries) {
    if (FORBIDDEN_ARTIFACT_PATH.test(entry) || /\.zip$/i.test(entry)) {
      violations.push(`${displayPath}: forbidden nested artifact path (${entry})`);
      continue;
    }
    if (!TEXT_EXTENSIONS.has(extname(entry).toLowerCase())) {
      violations.push(`${displayPath}: unapproved nested artifact type (${entry})`);
      continue;
    }
    try {
      const contents = execFileSync('unzip', ['-p', file, entry], {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      violations.push(...inspectSensitiveText(contents, `${displayPath}!${entry}`));
    } catch {
      violations.push(`${displayPath}!${entry}: text entry could not be inspected; upload denied`);
    }
  }
  return violations;
}

function scanArtifactRoots(repoRoot, roots) {
  const violations = [];
  const seen = new Set();
  for (const absoluteRoot of roots) {
    for (const file of walkFiles(absoluteRoot)) {
      if (seen.has(file)) continue;
      seen.add(file);
      const displayPath = relative(repoRoot, file).replaceAll('\\', '/');
      if (lstatSync(file).isSymbolicLink()) {
        violations.push(`${displayPath}: symbolic links are forbidden in uploaded browser output`);
        continue;
      }
      if (FORBIDDEN_ARTIFACT_PATH.test(displayPath)) {
        violations.push(`${displayPath}: forbidden browser/session artifact file`);
        continue;
      }
      if (/\.zip$/i.test(displayPath)) {
        if (!displayPath.startsWith('blob-report/')) {
          violations.push(`${displayPath}: custom archive in browser output is forbidden`);
          continue;
        }
        violations.push(...inspectZip(file, displayPath));
        continue;
      }
      if (!TEXT_EXTENSIONS.has(extname(displayPath).toLowerCase())) {
        violations.push(`${displayPath}: unapproved browser-output file type`);
        continue;
      }
      if (statSync(file).size > MAX_INSPECTABLE_TEXT_BYTES) {
        violations.push(`${displayPath}: artifact is too large to inspect; upload denied`);
        continue;
      }
      const contents = readFileSync(file, 'utf8');
      violations.push(...inspectSensitiveText(contents, displayPath));
    }
  }
  return violations;
}

function uploadPathRoot(repoRoot, path) {
  let candidate = path.replace(/^\$\{\{\s*github\.workspace\s*\}\}\//, '');
  const runnerTempMatch = candidate.match(/^\$\{\{\s*runner\.temp\s*\}\}\/(.+)$/);
  if (runnerTempMatch) {
    if (!process.env.RUNNER_TEMP) {
      return { error: `${path}: runner.temp is unavailable; upload denied` };
    }
    candidate = join(process.env.RUNNER_TEMP, runnerTempMatch[1]);
  }
  if (/\$\{\{/.test(candidate)) {
    return { error: `${path}: unsupported dynamic upload path; upload denied` };
  }
  const wildcard = candidate.search(/[*?[\]]/);
  if (wildcard >= 0) candidate = candidate.slice(0, wildcard);
  candidate = candidate.replace(/\/$/, '');
  if (!candidate) return { root: repoRoot };
  const absolute = isAbsolute(candidate) ? candidate : join(repoRoot, candidate);
  if (existsSync(absolute)) return { root: absolute };
  const parent = dirname(absolute);
  return { root: existsSync(parent) && wildcard >= 0 ? parent : absolute };
}

export function scanArtifactUpload(key, repoRoot = REPO_ROOT) {
  const artifact = inventoryArtifactUploads(repoRoot).find((entry) => {
    if (entry.key === key) return true;
    const dynamicKeyPattern = new RegExp(`^${escapeRegex(entry.key).replace(/\\\$\\\{\\\{.*?\\\}\\\}/g, '.+?')}$`);
    return dynamicKeyPattern.test(key);
  });
  if (!artifact) return [`${key}: artifact uploader is not present in the workflow inventory`];
  if (artifact.paths.length === 0) return [`${key}: artifact uploader has no configured paths; upload denied`];
  const resolutions = artifact.paths.map((path) => uploadPathRoot(repoRoot, path));
  const violations = resolutions.flatMap((resolution) => resolution.error ? [resolution.error] : []);
  const roots = resolutions.flatMap((resolution) => resolution.root ? [resolution.root] : []);
  if (roots.length === 0) violations.push(`${key}: no upload path could be resolved; upload denied`);
  return [...violations, ...scanArtifactRoots(repoRoot, roots)];
}

export function scanGeneratedArtifacts(repoRoot = REPO_ROOT) {
  return scanArtifactRoots(repoRoot, ['blob-report', 'playwright-report', 'test-results'].map((path) => join(repoRoot, path)));
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
      const pathWithoutGlob = path.replace(/[*?[\]].*$/, '');
      const configuredExtension = extname(pathWithoutGlob).toLowerCase();
      if (KNOWN_BINARY_EXTENSIONS.has(configuredExtension)
        && configuredExtension !== '.zip'
        && !APPROVED_SCREENSHOT_UPLOADS.has(artifact.key)) {
        violations.push(`${artifact.key}: binary review artifact path is forbidden (${path})`);
      }
    }

    if (artifact.broadUpload && !BROAD_UPLOAD_SCANNER_EXEMPTIONS.has(artifact.key)) {
      if (!artifact.hasPreUploadScanner) {
        violations.push(`${artifact.key}: broad browser-output upload requires a fail-closed pre-upload scanner`);
      }
      const scannerGuard = artifact.scannerId
        ? new RegExp(`steps\\.${escapeRegex(artifact.scannerId)}\\.outcome\\s*==\\s*'success'`)
        : undefined;
      if (!scannerGuard?.test(artifact.uploadIf ?? '')) {
        violations.push(`${artifact.key}: upload must be blocked unless the pre-upload scanner succeeds`);
      }
    }
  }

  const workflowDir = join(repoRoot, '.github', 'workflows');
  const workflowFiles = readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name));
  const workflowText = workflowFiles.map((workflow) => readFileSync(join(workflowDir, workflow), 'utf8')).join('\n');
  for (const workflow of workflowFiles) {
    const lines = readFileSync(join(workflowDir, workflow), 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (/^\s*(?:zip|tar|7z)\s/.test(line) && !/^\s*#/.test(line)) {
        violations.push(`${workflow}:${index + 1}: custom archive creation is forbidden`);
      }
    }
  }

  for (const config of playwrightConfigFiles(repoRoot)) {
    const contents = readFileSync(join(repoRoot, config), 'utf8');
    if (LOCAL_ONLY_MEDIA_PLAYWRIGHT_CONFIGS.has(config)) {
      if (workflowText.includes(config)) {
        violations.push(`${config}: local-only media config must never be invoked by Actions`);
      }
      continue;
    }
    for (const match of contents.matchAll(/\b(trace|video|screenshot)\s*:\s*['"]([^'"]+)['"]/g)) {
      if (match[2] !== 'off') {
        violations.push(`${config}: automated ${match[1]} capture must be off (found ${match[2]})`);
      }
    }
    if (/storageState:\s*['"]/.test(contents)) {
      violations.push(`${config}: persisted storageState files are forbidden in automation`);
    }
  }

  const committed = new Set(committedReviewBinaries(repoRoot));
  const allowedCommittedBinaries = new Set([
    ...LEGACY_COMMITTED_REVIEW_BINARIES,
    ...APPROVED_TEST_BINARY_FIXTURES,
  ]);
  for (const path of committed) {
    if (!allowedCommittedBinaries.has(path)) {
      violations.push(`${path}: committed binary review evidence is forbidden outside approved product-asset roots`);
    }
  }
  for (const path of LEGACY_COMMITTED_REVIEW_BINARIES) {
    if (!committed.has(path)) violations.push(`${path}: legacy evidence baseline changed; deletion requires separate authorization`);
  }

  return violations;
}

if (process.argv[1] && basename(process.argv[1]) === basename(MODULE_PATH)) {
  const scanIndex = process.argv.indexOf('--scan-upload');
  const legacyScanRequested = process.argv.includes('--scan-generated-artifacts');
  const scanRequested = scanIndex >= 0 || legacyScanRequested;
  const inventoryCount = scanRequested ? undefined : inventoryArtifactUploads().length;
  const violations = scanIndex >= 0
    ? scanArtifactUpload(process.argv[scanIndex + 1] ?? '')
    : legacyScanRequested
      ? scanGeneratedArtifacts()
      : reviewEvidencePolicyViolations();
  console.log(JSON.stringify(scanRequested ? { violations } : { inventoryCount, violations }, null, 2));
  if (violations.length) process.exitCode = 1;
}
