#!/usr/bin/env node

import fs from 'node:fs';

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

const REQUIRED_FIELDS = [
  'Current phase',
  'Allowed next transition',
  'Active review return',
  'Correction round count',
  'Changed-file allowlist',
  'PR head SHA',
  'Remote PR head SHA',
  'Base/main SHA',
  'Worktree state',
  'Tool/runtime versions',
  'Artifact hashes',
  'Evidence scope',
  'Browser/deployed proof',
  'Target URL/environment',
  'Expected deployed SHA',
  'Browser release identity',
  'Browser release match',
  'Cache/reload action',
  'Harness/selectors verified against exact release',
  'Mutation proof',
  'Known limitations',
  'Dependencies/ordering',
  'Substitutions used only for diagnosis',
  'Status',
];

const PLACEHOLDER = /^(?:pending|tbd|todo|unknown|unverified|open)$/i;
const SHA = /^[0-9a-f]{7,40}$/i;

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
}

function clean(value) {
  return value.trim().replace(/^\`|\`$/g, '').trim();
}

function field(body, label) {
  const match = body.match(new RegExp('^- ' + escapeRegex(label) + ':\\s*(.+)$', 'mi'));
  return match ? clean(match[1]) : null;
}

function section(body, heading) {
  const start = body.indexOf(heading);
  if (start < 0) return null;
  const rest = body.slice(start + heading.length);
  const next = rest.search(/^##\s+/m);
  const raw = next < 0 ? rest : rest.slice(0, next);
  return raw.replace(/<!--[\s\S]*?-->/g, '').trim();
}

function meaningful(value) {
  if (!value || PLACEHOLDER.test(value)) return false;
  if (/^n\/?a$/i.test(value)) return false;
  if (/^n\/?a\s*[—-]\s*.{10,}$/i.test(value)) return true;
  return true;
}

export function validatePrBody(body, { draft = true } = {}) {
  const errors = [];

  if (!body.includes('<!-- speaksharp-pr-contract:v1 -->')) {
    errors.push('Missing speaksharp-pr-contract:v1 marker.');
  }

  for (const heading of REQUIRED_HEADINGS) {
    if (!body.includes(heading)) errors.push('Missing required heading: ' + heading);
  }

  // Strip HTML comments so the template's example (e.g. "Refs #123") cannot satisfy the
  // governing-issue requirement; only an author-supplied reference counts.
  const visibleBody = body.replace(/<!--[\s\S]*?-->/g, '');
  if (!/\b(?:Refs|Fixes|Closes)\s+#\d+\b/i.test(visibleBody)) {
    errors.push('A governing issue reference is required: Refs/Fixes/Closes #<number>.');
  }

  for (const label of REQUIRED_FIELDS) {
    if (field(body, label) === null) errors.push('Missing required field: ' + label);
  }

  if (draft) return errors;

  for (const label of REQUIRED_FIELDS) {
    const value = field(body, label);
    if (value !== null && !meaningful(value)) {
      errors.push('Review-ready field is unresolved: ' + label);
    }
  }

  const head = field(body, 'PR head SHA');
  const remote = field(body, 'Remote PR head SHA');
  const base = field(body, 'Base/main SHA');

  if (!SHA.test(head ?? '')) errors.push('PR head SHA must be a 7-40 character hexadecimal SHA.');
  if (!SHA.test(remote ?? '')) errors.push('Remote PR head SHA must be a 7-40 character hexadecimal SHA.');
  if (!SHA.test(base ?? '')) errors.push('Base/main SHA must be a 7-40 character hexadecimal SHA.');
  if (SHA.test(head ?? '') && SHA.test(remote ?? '') && head !== remote) {
    errors.push('PR head SHA does not equal remote PR head SHA.');
  }

  const pending = section(body, '## Evidence pending');
  if (pending !== 'None.') {
    errors.push('Evidence pending must be exactly "None." before review.');
  }

  const completed = section(body, '## Evidence completed');
  if (!completed || /\b(?:pending|tbd|todo|unknown|unverified)\b/i.test(completed)) {
    errors.push('Evidence completed is empty or unresolved.');
  }

  if (field(body, 'Status') !== 'QUALIFIED') {
    errors.push('Status must be QUALIFIED before review.');
  }

  if (/- \[ \]/.test(body)) {
    errors.push('All review-readiness checkboxes must be checked.');
  }

  const browserProof = field(body, 'Browser/deployed proof') ?? '';
  if (/^required$/i.test(browserProof)) {
    const expected = field(body, 'Expected deployed SHA');
    const actual = field(body, 'Browser release identity');
    if (!SHA.test(expected ?? '') || !SHA.test(actual ?? '')) {
      errors.push('Required browser proof needs hexadecimal expected and observed release SHAs.');
    } else if (!(expected.startsWith(actual) || actual.startsWith(expected))) {
      errors.push('Browser release identity does not match the expected deployed SHA.');
    }
    if (!/^yes\b/i.test(field(body, 'Browser release match') ?? '')) {
      errors.push('Browser release match must be YES for required browser proof.');
    }
    if (!/^yes\b/i.test(field(body, 'Harness/selectors verified against exact release') ?? '')) {
      errors.push('Harness/selectors must be verified against the exact browser release.');
    }
  } else if (!/^not required\s*[—-]\s*.{10,}$/i.test(browserProof)) {
    errors.push('Browser/deployed proof must be REQUIRED or NOT REQUIRED — <specific reason>.');
  }

  for (const label of ['Artifact hashes', 'Mutation proof']) {
    const value = field(body, label) ?? '';
    if (/^n\/?a$/i.test(value)) {
      errors.push(label + ' may be N/A only with a specific reason.');
    }
  }

  // Lifecycle gate — a review-ready PR must be exactly Phase 2 with a resolved return
  // and a valid correction-round count.
  const phase = field(body, 'Current phase') ?? '';
  if (!/^phase\s*2\b/i.test(phase)) {
    errors.push('Current phase must be "Phase 2 — Review-ready" for a non-draft PR.');
  }

  const nextTransition = field(body, 'Allowed next transition') ?? '';
  if (!/^phase\s*3\b/i.test(nextTransition)) {
    errors.push('Allowed next transition from a review-ready PR must be "Phase 3 — Under review".');
  }

  const activeReturn = field(body, 'Active review return') ?? '';
  if (!/^(?:none\.?|resolved\b)/i.test(activeReturn)) {
    errors.push('Active review return must be resolved (None. or Resolved — <ref>) before review.');
  }

  const correctionRaw = field(body, 'Correction round count') ?? '';
  if (!/^\d+$/.test(correctionRaw)) {
    errors.push('Correction round count must be a non-negative integer.');
  } else {
    const correctionCount = Number.parseInt(correctionRaw, 10);
    if (correctionCount > 2) {
      errors.push('Correction round count exceeds the two-loop cap; regenerate or rescope the increment.');
    } else if (correctionCount >= 2) {
      const disposition = field(body, 'Correction disposition') ?? '';
      if (!/(?:regenerat|rescope)/i.test(disposition)) {
        errors.push('A second correction loop requires Correction disposition to state Regenerate or Rescope.');
      }
    }
  }

  return errors;
}

function validFixture() {
  return `<!-- speaksharp-pr-contract:v1 -->
## PR lifecycle gate
- Current phase: Phase 2 — Review-ready
- Allowed next transition: Phase 3 — Under review
- Active review return: None.
- Correction round count: 0
- Correction disposition: N/A — not yet at the second correction loop
- Review cadence: One consolidated PM review per review-ready state.
- Stop rule: Missing preconditions => VOID; a second correction loop forces regenerate or rescope.
- Separate authorities: Merge, migration, deployment, activation, and production proof are separately authorized.
## Governing issue
Refs #1316
## User outcome
A repository mechanism prevents stale qualification.
## Scope and allowlist
- Changed-file allowlist: .github/pull_request_template.md
- Explicitly out of scope: Product code
- Production action on merge: None
## Exact artifact and freshness
- PR head SHA: abcdef123456
- Remote PR head SHA: abcdef123456
- Base/main SHA: 123456abcdef
- Worktree state: clean
- Tool/runtime versions: Node 22
- Artifact hashes: N/A — no generated artifact changed
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
<!-- Ready-for-review value must be exactly: None. -->
None.
## Mutation / failure proof
- Mutation proof: Removed the issue link and observed nonzero validation.
## Limitations and dependencies
- Known limitations: Template enforcement begins after merge
- Dependencies/ordering: Merge separately authorized
- Substitutions used only for diagnosis: None
## Status
- Status: QUALIFIED
## Review readiness
- [x] Complete
`;
}

export function runSelfTest() {
  const fixture = validFixture();
  const validErrors = validatePrBody(fixture, { draft: false });
  if (validErrors.length) {
    throw new Error('Validator rejected valid fixture:\n' + validErrors.join('\n'));
  }

  const mutations = [
    ['missing issue link', fixture.replace('Refs #1316', 'No issue')],
    ['stale remote SHA', fixture.replace('Remote PR head SHA: abcdef123456', 'Remote PR head SHA: fedcba654321')],
    ['pending evidence', fixture.replace('\nNone.\n## Mutation / failure proof', '\nPENDING\n## Mutation / failure proof')],
    ['unchecked readiness', fixture.replace('- [x] Complete', '- [ ] Complete')],
    ['unverified browser', fixture.replace('NOT REQUIRED — repository metadata only', 'PENDING')],
    ['wrong phase', fixture.replace('Current phase: Phase 2 — Review-ready', 'Current phase: Phase 1 — Draft')],
    ['wrong next transition', fixture.replace('Allowed next transition: Phase 3 — Under review', 'Allowed next transition: Phase 5 — Apply')],
    ['unresolved active return', fixture.replace('Active review return: None.', 'Active review return: PM return open')],
    ['non-integer correction count', fixture.replace('Correction round count: 0', 'Correction round count: three')],
    ['second correction loop without disposition', fixture
      .replace('Correction round count: 0', 'Correction round count: 2')
      .replace('Correction disposition: N/A — not yet at the second correction loop', 'Correction disposition: patched again')],
    ['correction count over cap', fixture.replace('Correction round count: 0', 'Correction round count: 3')],
  ];

  for (const [name, mutated] of mutations) {
    if (validatePrBody(mutated, { draft: false }).length === 0) {
      throw new Error('Mutation was not detected: ' + name);
    }
  }

  // Valid Draft control: the same body, evaluated as a draft with fields still PENDING,
  // must pass (drafts are allowed unresolved evidence).
  const draftFixture = fixture
    .replace('- Status: QUALIFIED', '- Status: OPEN')
    .replace('\nNone.\n## Mutation / failure proof', '\nPENDING\n## Mutation / failure proof');
  const draftErrors = validatePrBody(draftFixture, { draft: true });
  if (draftErrors.length) {
    throw new Error('Validator rejected a valid draft:\n' + draftErrors.join('\n'));
  }

  // A second correction loop that correctly regenerates/rescopes must pass.
  const regenerated = fixture
    .replace('Correction round count: 0', 'Correction round count: 2')
    .replace('Correction disposition: N/A — not yet at the second correction loop', 'Correction disposition: Regenerated from authoritative sources');
  if (validatePrBody(regenerated, { draft: false }).length) {
    throw new Error('Validator rejected a correctly regenerated second-loop increment.');
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--self-test')) {
    runSelfTest();
    console.log('PASS: PR evidence contract self-test');
    return;
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required.');
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const pullRequest = event.pull_request;
  if (!pullRequest) throw new Error('pull_request payload is required.');

  const errors = validatePrBody(pullRequest.body ?? '', { draft: Boolean(pullRequest.draft) });
  if (errors.length) {
    console.error(errors.map((error) => '- ' + error).join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log('PASS: PR evidence contract (' + (pullRequest.draft ? 'draft' : 'review-ready') + ')');
}

if (import.meta.url === 'file://' + process.argv[1]) {
  main();
}
