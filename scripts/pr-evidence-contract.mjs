#!/usr/bin/env node
//
// PR Evidence Contract validator (regenerated for #1316 correction round 2).
//
// Trust model: this script is enforcement authority ONLY when run from a trusted
// base/main artifact (see .github/workflows/pr-evidence-contract.yml). A PR that
// edits this file is exercised as a *candidate* by the unit suite, but never judges
// its own evidence. The validator is pure: it consumes GitHub-authoritative DATA
// (actual head/base SHA, the paginated changed-file set, governing-issue bodies,
// computed file hashes) and the PR body, and returns a list of errors. It performs
// no network or git access itself.
//
// Fail-closed parsing: every heading / field / section / checkbox is read from a
// comment-stripped copy of the body, so content hidden inside HTML comments cannot
// satisfy a requirement. Unresolved placeholder prefixes (PENDING, TBD, ...) are
// rejected on non-draft required fields even when trailing prose is appended.

import fs from 'node:fs';

export const PR_CONTRACT_MARKER = '<!-- speaksharp-pr-contract:v1 -->';
export const ISSUE_CONTRACT_MARKER = 'speaksharp-issue-contract:v1';

const REQUIRED_HEADINGS = [
  '## PR lifecycle gate',
  '## Governing issue',
  '## User outcome',
  '## Scope and allowlist',
  '## Exact artifact and freshness',
  '## Evidence completed',
  '## Evidence pending',
  '## Mutation / failure proof',
  '## Limitations and dependencies',
  '## Status',
  '## Review readiness',
];

// Every load-bearing lifecycle / authority / freshness field is mandatory.
const REQUIRED_FIELDS = [
  // Lifecycle + authority
  'Current phase',
  'Allowed next transition',
  'Active review return',
  'Correction round count',
  'Correction disposition',
  'Review cadence',
  'Stop rule',
  'Separate authorities',
  // Scope + production effect
  'Explicitly out of scope',
  'Production action on merge',
  // Exact artifact + freshness
  'PR head SHA',
  'Remote PR head SHA',
  'Base/main SHA',
  'Worktree state',
  'Tool/runtime versions',
  'Artifact hashes',
  'Evidence scope',
  // Browser / deployed freshness
  'Browser/deployed proof',
  'Target URL/environment',
  'Expected deployed SHA',
  'Browser release identity',
  'Browser release match',
  'Cache/reload action',
  'Harness/selectors verified against exact release',
  // Mutation / limitations / status
  'Mutation proof',
  'Known limitations',
  'Dependencies/ordering',
  'Substitutions used only for diagnosis',
  'Status',
];

const SHA1_FULL = /^[0-9a-f]{40}$/;
const SHA256_FULL = /^[0-9a-f]{64}$/;
const UNRESOLVED_PREFIX = /^(?:pending|tbd|todo|unknown|unverified|open)\b/i;

// Governing-issue Phase-0 contract.
const ISSUE_FORM_SECTIONS = [
  'User outcome',
  'Observed problem and exact evidence',
  'Highest risk boundary',
  'Acceptance criteria',
  'Required evidence',
  'Proposed PR increment and file allowlist',
  'Dependencies, ordering, and authorization gates',
];
const ISSUE_V1_FIELDS = ['Status', 'Current phase', 'Separate authorities'];

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
}

export function stripComments(text) {
  return String(text ?? '').replace(/<!--[\s\S]*?-->/g, '');
}

function clean(value) {
  return value.trim().replace(/^`+|`+$/g, '').trim();
}

function field(strippedBody, label) {
  const match = strippedBody.match(new RegExp('^-\\s*' + escapeRegex(label) + ':\\s*(.*)$', 'mi'));
  if (!match) return null;
  const value = clean(match[1]);
  return value === '' ? null : value;
}

function section(strippedBody, heading) {
  const start = strippedBody.indexOf(heading);
  if (start < 0) return null;
  const rest = strippedBody.slice(start + heading.length);
  const next = rest.search(/^##\s+/m);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

function isUnresolved(value) {
  return value === null || value === '' || UNRESOLVED_PREFIX.test(value);
}

function isExplicitNa(value) {
  return /^n\/?a\s*[—-]\s*.{6,}$/i.test(value ?? '') || /^not required\s*[—-]\s*.{6,}$/i.test(value ?? '');
}

// Authoritative machine-readable allowlist: a fenced ```files block, one path per line.
export function parseAllowlist(strippedBody) {
  const match = strippedBody.match(/```files\s*\n([\s\S]*?)```/i);
  if (!match) return null;
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

export function extractIssueRefs(body) {
  const stripped = stripComments(body);
  const set = new Set();
  for (const match of stripped.matchAll(/\b(?:Refs|Fixes|Closes)\s+#(\d+)\b/gi)) {
    set.add(Number(match[1]));
  }
  return [...set];
}

function sectionContent(stripped, label) {
  const re = new RegExp('(?:^|\\n)#{1,6}[ \\t]*' + escapeRegex(label) + '[ \\t]*\\n([\\s\\S]*?)(?=\\n#{1,6}[ \\t]|$)', 'i');
  const match = stripped.match(re);
  return match ? match[1].trim() : null;
}

// Validate one governing issue against the canonical implementation form OR the
// retrofitted speaksharp-issue-contract:v1 contract.
export function validateGoverningIssue(issue) {
  const errors = [];
  const number = issue?.number ?? '?';
  if (issue?.isPullRequest) {
    errors.push('#' + number + ' is a pull request, not a governing issue.');
    return errors;
  }
  const raw = issue?.body ?? '';
  const stripped = stripComments(raw);

  if (raw.includes(ISSUE_CONTRACT_MARKER)) {
    // Retrofitted contract: the Implementation lifecycle gate with resolved Status,
    // Current phase, and Separate authorities, plus a non-empty Outcome section.
    if (!/(?:^|\n)#{1,6}[ \t]*Implementation lifecycle gate\b/i.test(stripped)) {
      errors.push('#' + number + ' issue-contract:v1 is missing the Implementation lifecycle gate section.');
    }
    for (const key of ISSUE_V1_FIELDS) {
      const re = new RegExp('(?:^|\\n)-\\s*' + escapeRegex(key) + '\\s*:\\s*\\S', 'i');
      if (!re.test(stripped)) errors.push('#' + number + ' issue-contract:v1 is missing a resolved ' + key + ' field.');
    }
    const outcome = sectionContent(stripped, 'Outcome');
    if (outcome === null || outcome.replace(/\s+/g, '').length === 0) {
      errors.push('#' + number + ' issue-contract:v1 is missing a non-empty Outcome section.');
    }
    return errors;
  }

  // Canonical implementation form: require each Phase-0 section heading AND content.
  for (const label of ISSUE_FORM_SECTIONS) {
    const content = sectionContent(stripped, label);
    if (content === null) {
      errors.push('#' + number + ' is missing the Phase-0 section: ' + label + '.');
    } else if (content.replace(/\s+/g, '').length === 0) {
      errors.push('#' + number + ' has an empty Phase-0 section: ' + label + '.');
    }
  }
  return errors;
}

function validateGoverningIssues(refs, issues, prCreatedAt, errors) {
  if (refs.length === 0) {
    errors.push('A governing issue reference is required: Refs/Fixes/Closes #<number>.');
    return;
  }
  const byNumber = new Map((issues ?? []).map((issue) => [Number(issue.number), issue]));
  let qualifying = 0;
  const phaseErrors = [];
  for (const ref of refs) {
    const issue = byNumber.get(ref);
    if (!issue) {
      errors.push('#' + ref + ' could not be verified against GitHub.');
      continue;
    }
    if (issue.isPullRequest) {
      errors.push('#' + ref + ' is a pull request, not a governing issue.');
      continue;
    }
    if (prCreatedAt && issue.createdAt && new Date(issue.createdAt) > new Date(prCreatedAt)) {
      errors.push('#' + ref + ' was created after this PR; issue-first intake is required.');
      continue;
    }
    const issueErrors = validateGoverningIssue(issue);
    if (issueErrors.length === 0) {
      qualifying += 1;
    } else {
      phaseErrors.push(...issueErrors);
    }
  }
  if (qualifying === 0) {
    if (phaseErrors.length > 0) errors.push(...phaseErrors);
    else errors.push('No referenced issue satisfies the Phase-0 governing-issue contract.');
  }
}

function setDiff(reported, actual) {
  const a = new Set(reported);
  const b = new Set(actual);
  const missing = [...b].filter((x) => !a.has(x)).sort();
  const extra = [...a].filter((x) => !b.has(x)).sort();
  return { missing, extra };
}

/**
 * @param {string} body - the raw PR body.
 * @param {object} options
 *   draft            : boolean
 *   actualHeadSha    : string | null  (github.event.pull_request.head.sha)
 *   actualBaseSha    : string | null  (github.event.pull_request.base.sha)
 *   changedFiles     : string[] | null (paginated GitHub changed-file set)
 *   fileHashes       : Array<{path,sha256}> | null (computed sha256 of head files)
 *   governingIssues  : Array<{number,body,createdAt,isPullRequest}> | null
 *   prCreatedAt      : string | null
 */
export function validatePrBody(body, options = {}) {
  const {
    draft = true,
    actualHeadSha = null,
    actualBaseSha = null,
    changedFiles = null,
    fileHashes = null,
    governingIssues = null,
    prCreatedAt = null,
  } = options;

  const errors = [];
  const raw = body ?? '';
  const stripped = stripComments(raw);

  // The contract marker is intentionally an HTML comment; check it on the raw body.
  if (!raw.includes(PR_CONTRACT_MARKER)) {
    errors.push('Missing ' + PR_CONTRACT_MARKER + ' marker.');
  }

  // Everything else must be real (comment-stripped) content.
  for (const heading of REQUIRED_HEADINGS) {
    if (!new RegExp('^' + escapeRegex(heading) + '\\s*$', 'm').test(stripped)) {
      errors.push('Missing required heading: ' + heading);
    }
  }

  for (const label of REQUIRED_FIELDS) {
    if (field(stripped, label) === null) errors.push('Missing required field: ' + label);
  }

  const refs = extractIssueRefs(raw);
  // Issue-first + Phase-0 applies whenever governing-issue data is available.
  if (governingIssues !== null) {
    validateGoverningIssues(refs, governingIssues, prCreatedAt, errors);
  } else if (refs.length === 0) {
    errors.push('A governing issue reference is required: Refs/Fixes/Closes #<number>.');
  }

  if (draft) return errors;

  // ---- Non-draft (review-ready) enforcement ----

  // Placeholder prefixes are unresolved even with trailing prose.
  for (const label of REQUIRED_FIELDS) {
    const value = field(stripped, label);
    if (value !== null && UNRESOLVED_PREFIX.test(value) && !isExplicitNa(value)) {
      errors.push('Review-ready field is unresolved: ' + label);
    }
  }

  // Lifecycle gate.
  const phase = field(stripped, 'Current phase') ?? '';
  if (!/^phase\s*2\b/i.test(phase)) errors.push('Current phase must be "Phase 2 — Review-ready" for a non-draft PR.');

  const nextTransition = field(stripped, 'Allowed next transition') ?? '';
  if (!/^phase\s*3\b/i.test(nextTransition)) errors.push('Allowed next transition must be "Phase 3 — Under review".');

  const activeReturn = field(stripped, 'Active review return') ?? '';
  if (!/^(?:none\.?|resolved\b)/i.test(activeReturn)) {
    errors.push('Active review return must be resolved (None. or Resolved — <ref>) before review.');
  }

  const correctionRaw = field(stripped, 'Correction round count') ?? '';
  if (!/^\d+$/.test(correctionRaw)) {
    errors.push('Correction round count must be a non-negative integer.');
  } else {
    const count = Number.parseInt(correctionRaw, 10);
    if (count > 2) {
      errors.push('Correction round count exceeds the two-loop cap; regenerate or rescope the increment.');
    } else if (count >= 2) {
      const disposition = field(stripped, 'Correction disposition') ?? '';
      if (!/(?:regenerat|rescope)/i.test(disposition)) {
        errors.push('A second correction loop requires Correction disposition to state Regenerate or Rescope.');
      }
    }
  }

  // Exact artifact compared with GitHub's actual artifact.
  const reportedHead = (field(stripped, 'PR head SHA') ?? '').toLowerCase();
  const reportedRemote = (field(stripped, 'Remote PR head SHA') ?? '').toLowerCase();
  const reportedBase = (field(stripped, 'Base/main SHA') ?? '').toLowerCase();

  if (!SHA1_FULL.test(reportedHead)) errors.push('PR head SHA must be a full 40-character commit SHA.');
  if (!SHA1_FULL.test(reportedRemote)) errors.push('Remote PR head SHA must be a full 40-character commit SHA.');
  if (!SHA1_FULL.test(reportedBase)) errors.push('Base/main SHA must be a full 40-character commit SHA.');
  if (reportedHead && reportedRemote && reportedHead !== reportedRemote) {
    errors.push('PR head SHA does not equal remote PR head SHA.');
  }
  if (actualHeadSha) {
    const actual = actualHeadSha.toLowerCase();
    if (reportedHead && reportedHead !== actual) errors.push('PR head SHA does not match the actual GitHub head SHA.');
    if (reportedRemote && reportedRemote !== actual) errors.push('Remote PR head SHA does not match the actual GitHub head SHA.');
  }
  if (actualBaseSha) {
    if (reportedBase && reportedBase !== actualBaseSha.toLowerCase()) {
      errors.push('Base/main SHA does not match the actual GitHub base SHA.');
    }
  }

  // Changed-file allowlist compared with the actual changed-file set.
  const allowlist = parseAllowlist(stripped);
  if (allowlist === null) {
    errors.push('A machine-readable ```files allowlist block is required.');
  } else if (changedFiles !== null) {
    const { missing, extra } = setDiff(allowlist, changedFiles);
    if (missing.length) errors.push('Allowlist omits changed files: ' + missing.join(', '));
    if (extra.length) errors.push('Allowlist lists files that did not change: ' + extra.join(', '));
  }

  // Artifact hashes must be full SHA-256, one per changed file.
  const hashesField = field(stripped, 'Artifact hashes') ?? '';
  if (!isExplicitNa(hashesField)) {
    const hexTokens = (hashesField.match(/[0-9a-f]{7,}/gi) ?? []).map((t) => t.toLowerCase());
    const shortTokens = hexTokens.filter((t) => t.length !== 64);
    const full = hexTokens.filter((t) => SHA256_FULL.test(t));
    if (shortTokens.length) errors.push('Artifact hashes must be full 64-character SHA-256 values, not prefixes.');
    if (fileHashes !== null) {
      for (const { path, sha256 } of fileHashes) {
        if (!full.includes(sha256.toLowerCase())) {
          errors.push('Artifact hashes is missing the SHA-256 for ' + path + '.');
        }
      }
    }
  } else if (fileHashes !== null && fileHashes.length > 0) {
    errors.push('Artifact hashes may not be N/A when files changed; report full SHA-256 values.');
  }

  // Evidence, status, checkboxes.
  const pending = section(stripped, '## Evidence pending');
  if (pending !== 'None.') errors.push('Evidence pending must be exactly "None." before review.');

  const completed = section(stripped, '## Evidence completed');
  if (!completed || UNRESOLVED_PREFIX.test(completed)) errors.push('Evidence completed is empty or unresolved.');

  if ((field(stripped, 'Status') ?? '') !== 'QUALIFIED') errors.push('Status must be QUALIFIED before review.');

  if (/-\s*\[\s\]/.test(stripped)) errors.push('All review-readiness checkboxes must be checked.');

  // Browser / deployed release-identity gate.
  const browserProof = field(stripped, 'Browser/deployed proof') ?? '';
  if (/^required$/i.test(browserProof)) {
    const expected = (field(stripped, 'Expected deployed SHA') ?? '').toLowerCase();
    const actual = (field(stripped, 'Browser release identity') ?? '').toLowerCase();
    if (!SHA1_FULL.test(expected) || !SHA1_FULL.test(actual)) {
      errors.push('Required browser proof needs full 40-character expected and observed release SHAs.');
    } else if (expected !== actual) {
      errors.push('Browser release identity does not match the expected deployed SHA.');
    }
    if (!/^yes\b/i.test(field(stripped, 'Browser release match') ?? '')) {
      errors.push('Browser release match must be YES for required browser proof.');
    }
    if (!/^yes\b/i.test(field(stripped, 'Harness/selectors verified against exact release') ?? '')) {
      errors.push('Harness/selectors must be verified against the exact browser release.');
    }
  } else if (!/^not required\s*[—-]\s*.{10,}$/i.test(browserProof)) {
    errors.push('Browser/deployed proof must be REQUIRED or NOT REQUIRED — <specific reason>.');
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Self-test: trust-independent mutation proof, runnable from the trusted base.
// The exhaustive matrix lives in tests/unit/prEvidenceContract.test.js.
// ---------------------------------------------------------------------------

const CANONICAL_ISSUE = {
  number: 1316,
  isPullRequest: false,
  createdAt: '2026-08-18T00:00:00Z',
  body: [
    '### User outcome', 'A durable lifecycle gate.', '',
    '### Observed problem and exact evidence', 'Green CI hid false-green paths.', '',
    '### Highest risk boundary', 'Deployment or release automation', '',
    '### Acceptance criteria', '- [ ] Trusted-base validator', '',
    '### Required evidence', 'Exact-head CI and mutation proof.', '',
    '### Proposed PR increment and file allowlist', 'Eight governance files.', '',
    '### Dependencies, ordering, and authorization gates', 'Merge separately authorized.', '',
  ].join('\n'),
};

export function validFixture() {
  return `${PR_CONTRACT_MARKER}
## PR lifecycle gate
- Current phase: Phase 2 — Review-ready
- Allowed next transition: Phase 3 — Under review
- Active review return: None.
- Correction round count: 0
- Correction disposition: N/A — not at the second correction loop yet
- Review cadence: One consolidated PM review per review-ready state.
- Stop rule: Missing preconditions => VOID; a second correction loop forces regenerate or rescope.
- Separate authorities: Merge, migration, deployment, activation, and production proof are separately authorized.
## Governing issue
Refs #1316
## User outcome
A repository mechanism prevents stale qualification.
## Scope and allowlist
- Changed-file allowlist: see the machine-readable block below
- Explicitly out of scope: Product code
- Production action on merge: None

\`\`\`files
scripts/pr-evidence-contract.mjs
\`\`\`
## Exact artifact and freshness
- PR head SHA: ${'a'.repeat(40)}
- Remote PR head SHA: ${'a'.repeat(40)}
- Base/main SHA: ${'b'.repeat(40)}
- Worktree state: clean
- Tool/runtime versions: Node 22.12.0
- Artifact hashes: scripts/pr-evidence-contract.mjs ${'c'.repeat(64)}
- Evidence scope: exact head
### Browser/deployed freshness
- Browser/deployed proof: NOT REQUIRED — repository metadata only
- Target URL/environment: N/A — no runtime changed
- Expected deployed SHA: N/A — no deployment required
- Browser release identity: N/A — no browser evidence used
- Browser release match: N/A — no browser evidence used
- Cache/reload action: N/A — no browser evidence used
- Harness/selectors verified against exact release: N/A — no harness changed
## Evidence completed
Validator self-test passed on exact head.
## Evidence pending
None.
## Mutation / failure proof
- Mutation proof: Broke each control and observed a nonzero result.
## Limitations and dependencies
- Known limitations: Enforcement binds once the base contains this validator.
- Dependencies/ordering: Merge separately authorized.
- Substitutions used only for diagnosis: None
## Status
- Status: QUALIFIED
## Review readiness
- [x] Complete
`;
}

export function runSelfTest() {
  const fixture = validFixture();
  const baseOptions = {
    draft: false,
    actualHeadSha: 'a'.repeat(40),
    actualBaseSha: 'b'.repeat(40),
    changedFiles: ['scripts/pr-evidence-contract.mjs'],
    fileHashes: [{ path: 'scripts/pr-evidence-contract.mjs', sha256: 'c'.repeat(64) }],
    governingIssues: [CANONICAL_ISSUE],
    prCreatedAt: '2026-08-20T00:00:00Z',
  };

  const validErrors = validatePrBody(fixture, baseOptions);
  if (validErrors.length) throw new Error('Validator rejected a valid fixture:\n' + validErrors.join('\n'));

  const mutations = [
    ['comment-only heading', fixture.replace('## Status', '<!-- ## Status -->')],
    ['comment-only field', fixture.replace('- Stop rule:', '<!-- - Stop rule:')],
    ['pending-with-prose field', fixture.replace('- Worktree state: clean', '- Worktree state: PENDING — awaiting push')],
    ['reported head not matching actual', fixture.replaceAll('a'.repeat(40), 'd'.repeat(40))],
    ['stale base', fixture.replace('- Base/main SHA: ' + 'b'.repeat(40), '- Base/main SHA: ' + 'e'.repeat(40))],
    ['short hash prefix', fixture.replace('c'.repeat(64), 'c'.repeat(8))],
    ['missing cadence', fixture.replace('- Review cadence: One consolidated PM review per review-ready state.\n', '')],
    ['missing separate authorities', fixture.replace(/- Separate authorities: .*\n/, '')],
    ['second loop without disposition', fixture
      .replace('- Correction round count: 0', '- Correction round count: 2')
      .replace('- Correction disposition: N/A — not at the second correction loop yet', '- Correction disposition: patched again')],
  ];
  for (const [name, mutated] of mutations) {
    if (validatePrBody(mutated, baseOptions).length === 0) throw new Error('Mutation not detected: ' + name);
  }

  // Allowlist mismatch (extra actual file) must fail.
  if (validatePrBody(fixture, { ...baseOptions, changedFiles: ['scripts/pr-evidence-contract.mjs', 'AGENTS.md'] }).length === 0) {
    throw new Error('Mutation not detected: allowlist missing a changed file');
  }
  // Blank governing issue must fail.
  if (validatePrBody(fixture, { ...baseOptions, governingIssues: [{ number: 1316, isPullRequest: false, createdAt: '2026-08-18T00:00:00Z', body: '' }] }).length === 0) {
    throw new Error('Mutation not detected: blank governing issue');
  }

  // Valid draft control (fields still PENDING) must pass.
  const draftFixture = fixture
    .replace('- Status: QUALIFIED', '- Status: OPEN')
    .replace('- Current phase: Phase 2 — Review-ready', '- Current phase: Phase 1 — Draft')
    .replace('\nNone.\n## Mutation / failure proof', '\nPENDING — implementation in progress\n## Mutation / failure proof');
  const draftErrors = validatePrBody(draftFixture, { draft: true, governingIssues: [CANONICAL_ISSUE], prCreatedAt: '2026-08-20T00:00:00Z' });
  if (draftErrors.length) throw new Error('Validator rejected a valid draft:\n' + draftErrors.join('\n'));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function readLines(path) {
  return fs.readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
}

function enforce() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required for enforcement.');
  const event = readJson(eventPath);
  const pr = event.pull_request;
  if (!pr) throw new Error('pull_request payload is required.');

  const changedFiles = process.env.PR_CHANGED_FILES_FILE ? readLines(process.env.PR_CHANGED_FILES_FILE) : null;
  const governingIssues = process.env.PR_GOVERNING_ISSUES_FILE ? readJson(process.env.PR_GOVERNING_ISSUES_FILE) : null;
  let fileHashes = null;
  if (process.env.PR_FILE_HASHES_FILE) {
    fileHashes = readLines(process.env.PR_FILE_HASHES_FILE).map((line) => {
      const [sha256, ...rest] = line.split(/\s+/);
      return { sha256, path: rest.join(' ') };
    });
  }

  const errors = validatePrBody(pr.body ?? '', {
    draft: Boolean(pr.draft),
    actualHeadSha: pr.head?.sha ?? null,
    actualBaseSha: pr.base?.sha ?? null,
    changedFiles,
    fileHashes,
    governingIssues,
    prCreatedAt: pr.created_at ?? null,
  });

  if (errors.length) {
    console.error(errors.map((e) => '- ' + e).join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('PASS: PR evidence contract (' + (pr.draft ? 'draft' : 'review-ready') + ')');
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--self-test')) {
    runSelfTest();
    console.log('PASS: PR evidence contract self-test');
    return;
  }
  if (args.has('--extract-issue-refs')) {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    const event = readJson(eventPath);
    console.log(extractIssueRefs(event.pull_request?.body ?? '').join('\n'));
    return;
  }
  enforce();
}

if (import.meta.url === 'file://' + process.argv[1]) {
  main();
}
