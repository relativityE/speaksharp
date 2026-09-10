import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  evaluateReviewQualification,
  isSubstantiveImplementationFile,
} from '../../scripts/review-qualification.mjs';
import {
  applyEnforcementToReceipt,
  readReviewThreadResolutionEnforcement,
  buildReviewReceipt,
  resolveQualificationTarget,
  reviewThreadResolutionIsEnforced,
} from '../../scripts/collect-review-qualification.mjs';
import {
  CANONICAL_PRODUCTION_ORIGIN,
  classifyDiagnosticEvidence,
  evaluateProductionEvidenceTarget,
  extractDeployedRelease,
  qualifyEvidenceTarget,
} from '../../scripts/lib/releaseEvidenceEligibility.mjs';
import {
  COVERAGE_RELEASE_FLOOR,
  MEANINGFUL_COVERAGE_MANIFEST,
  parseCiAuditOverride,
  validateSoftwareQualityEvidence,
} from '../../scripts/lib/softwareQualityEvidenceQualification.mjs';

const SHA = 'a97b740b39f678e8b5e8f769725e272d59428c64';
const OTHER_SHA = 'b97b740b39f678e8b5e8f769725e272d59428c64';

describe('Q-08 automated review qualification', () => {
  const complete = (over = {}) => ({
    currentSha: SHA,
    reviewedSha: SHA,
    reviewStatus: 'completed',
    findingCount: 0,
    changedFiles: ['scripts/review-qualification.mjs', 'tests/unit/finalReleaseQualification.test.js'],
    ...over,
  });

  it('qualifies a completed zero-finding review of the exact substantive head', () => {
    expect(evaluateReviewQualification(complete())).toMatchObject({ qualified: true, reasons: [] });
  });

  it('CASUALTY: a zero-finding review of a scaffold is not green', () => {
    const result = evaluateReviewQualification(complete({
      changedFiles: ['docs/findings/final-release-qualification.md'],
    }));
    expect(result.qualified).toBe(false);
    expect(result.reasons).toContain('no_substantive_implementation');
  });

  it('CASUALTY: zero findings without an explicitly completed review is not green', () => {
    for (const reviewStatus of [undefined, 'pending', 'failed', 'in_progress']) {
      const result = evaluateReviewQualification(complete({ reviewStatus }));
      expect(result.qualified).toBe(false);
      expect(result.reasons.some((reason) => reason.startsWith('review_not_completed:'))).toBe(true);
    }
  });

  it('CASUALTY: a completed scaffold review cannot survive an implementation commit', () => {
    const result = evaluateReviewQualification(complete({ reviewedSha: OTHER_SHA }));
    expect(result.qualified).toBe(false);
    expect(result.reasons).toContain('reviewed_sha_is_not_current_head');
  });

  it('fails closed on missing or malformed receipt fields and on open findings', () => {
    expect(evaluateReviewQualification({}).qualified).toBe(false);
    expect(evaluateReviewQualification(complete({ findingCount: 1 })).reasons).toContain('open_findings:1');
    expect(evaluateReviewQualification(complete({ findingCount: '0' })).reasons)
      .toContain('finding_count_missing_or_invalid');
  });

  it('implementation means executable production/control code, not tests or prose alone', () => {
    expect(isSubstantiveImplementationFile('.github/workflows/rc-gates.yml')).toBe(true);
    expect(isSubstantiveImplementationFile('scripts/review-qualification.mjs')).toBe(true);
    expect(isSubstantiveImplementationFile('tests/unit/finalReleaseQualification.test.js')).toBe(false);
    expect(isSubstantiveImplementationFile('docs/findings/final-release-qualification.md')).toBe(false);
  });

  it('qualifies only live GitHub state with a current Codex review and no current unresolved release finding', () => {
    const github = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: {
        nodes: [{ author: { login: 'chatgpt-codex-connector' }, commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z' }],
        pageInfo: { hasPreviousPage: false },
      },
      reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
    };
    expect(buildReviewReceipt({ pullRequest: github, expectedHeadSha: SHA })).toMatchObject({ qualified: true, findingCount: 0 });

    const fabricated = { ...github, headRefOid: OTHER_SHA };
    expect(buildReviewReceipt({ pullRequest: fabricated, expectedHeadSha: SHA }).reasons)
      .toContain('github_pr_head_is_not_workflow_head');
  });

  const prWithFinding = (body) => ({
    number: 1430,
    headRefOid: SHA,
    files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
    reviews: {
      nodes: [{ author: { login: 'chatgpt-codex-connector[bot]' }, commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z' }],
      pageInfo: { hasPreviousPage: false },
    },
    reviewThreads: {
      nodes: [{
        isResolved: false,
        comments: {
          nodes: [{
            author: { login: 'chatgpt-codex-connector' },
            commit: { oid: SHA }, originalCommit: { oid: SHA }, pullRequestReview: { commit: { oid: SHA } },
            body,
          }],
          pageInfo: { hasPreviousPage: false },
        },
      }],
      pageInfo: { hasNextPage: false },
    },
  });

  it('CASUALTY: ONE readable surface cannot conclude "not enforced" for the other', async () => {
    /**
     * #1430 P1, found by exact-head CI on my own first fix. `/rules/branches/<b>` is readable and
     * returns an empty list; `/branches/<b>/protection` needs admin scope and is not. Reporting
     * `unverified` only when BOTH were unreadable let the readable half speak for the whole answer,
     * and an empty rules list cannot see legacy branch protection at all — so the gate again stated
     * "not enforced" about something it could not observe.
     *
     * Enforcement can come from either surface, so a definite `false` requires having read both.
     */
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => (String(url).includes('/protection')
      ? { ok: false, status: 403, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => [] });
    try {
      await expect(readReviewThreadResolutionEnforcement({
        repository: 'o/r', branch: 'main', token: 't',
      })).resolves.toBe('unverified');
    } finally {
      globalThis.fetch = original;
    }
  });

  describe('#1430 P1 — a definite "not enforced" requires having read BOTH surfaces', () => {
    /**
     * Enforcement can be established by EITHER surface: legacy branch protection with
     * `required_conversation_resolution`, or an active ruleset requiring review-thread resolution. So a
     * POSITIVE finding stands on whichever surface proved it, while a NEGATIVE one is only sound when
     * both were readable. My first correction reported `unverified` solely when both were unreadable,
     * which let a readable-but-empty rules list speak for unreadable legacy protection.
     */
    // Returns the verdict; each case asserts it itself. Asserting inside the helper hid the
    // expectation from `vitest/expect-expect`, which reads a test with no visible `expect` as one that
    // proves nothing — and on a release gate that lint is right to be strict.
    const enforcementUnder = async (handler) => {
      const original = globalThis.fetch;
      globalThis.fetch = handler;
      try {
        return await readReviewThreadResolutionEnforcement({
          repository: 'o/r', branch: 'main', token: 't',
        });
      } finally {
        globalThis.fetch = original;
      }
    };
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    const denied = { ok: false, status: 403, json: async () => ({}) };
    const ENFORCING_RULE = [{ type: 'pull_request', parameters: { required_review_thread_resolution: true }, ruleset_id: 7 }];
    const ENFORCING_PROTECTION = {
      required_conversation_resolution: { enabled: true },
      enforce_admins: { enabled: true },
      required_pull_request_reviews: {},
    };

    it('CASUALTY: empty rules + UNREADABLE protection is unverified, not "not enforced"', async () => {
      const verdict = await enforcementUnder(async (url) => (String(url).includes('/protection') ? denied : ok([])));
      expect(verdict).toBe('unverified');
    });

    it('CASUALTY: UNREADABLE rules + empty protection is unverified, not "not enforced"', async () => {
      const verdict = await enforcementUnder(async (url) => (String(url).includes('/rules/branches') ? denied : ok({})));
      expect(verdict).toBe('unverified');
    });

    it('enforcement found on the RULESET surface establishes it, even with protection empty', async () => {
      const verdict = await enforcementUnder(async (url) => {
        const u = String(url);
        if (u.includes('/protection')) return ok({});
        if (u.includes('/rules/branches')) return ok(ENFORCING_RULE);
        return ok({ id: 7, enforcement: 'active', bypass_actors: [] });
      });
      expect(verdict).toBe(true);
    });

    it('enforcement found on the legacy PROTECTION surface establishes it, even with rules empty', async () => {
      const verdict = await enforcementUnder(async (url) => (String(url).includes('/protection') ? ok(ENFORCING_PROTECTION) : ok([])));
      expect(verdict).toBe(true);
    });

    it('CONTROL: both readable and negative is a real "not enforced"', async () => {
      const verdict = await enforcementUnder(async (url) => (String(url).includes('/protection')
        ? ok({ required_conversation_resolution: { enabled: false } })
        : ok([])));
      expect(verdict).toBe(false);
    });
  });

  it('CASUALTY: an unreadable RULESET DETAIL is blindness too, not absence', async () => {
    /**
     * #1430 P1 — the rules list can be readable and name a ruleset that requires review-thread
     * resolution, while that ruleset's own detail needs admin scope and is not readable. Filtering the
     * unreadable detail out and evaluating what remained dropped the very rule that would have proven
     * enforcement, and returned the definite `false`.
     */
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/protection')) return { ok: true, status: 200, json: async () => ({}) };
      if (u.includes('/rules/branches')) {
        return { ok: true, status: 200, json: async () => ([
          { type: 'pull_request', parameters: { required_review_thread_resolution: true }, ruleset_id: 7 },
        ]) };
      }
      // The referenced ruleset's detail — admin-scoped, unreadable.
      return { ok: false, status: 403, json: async () => ({}) };
    };
    try {
      await expect(readReviewThreadResolutionEnforcement({
        repository: 'o/r', branch: 'main', token: 't',
      })).resolves.toBe('unverified');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('CONTROL: both surfaces readable and negative is a real "not enforced"', async () => {
    // The relaxation must not swallow the genuine finding it exists to preserve.
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => (String(url).includes('/protection')
      ? { ok: true, status: 200, json: async () => ({ required_conversation_resolution: { enabled: false } }) }
      : { ok: true, status: 200, json: async () => [] });
    try {
      await expect(readReviewThreadResolutionEnforcement({
        repository: 'o/r', branch: 'main', token: 't',
      })).resolves.toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('CASUALTY: a 401 from an invalid credential is UNREADABLE, not a hard failure', async () => {
    /**
     * #1430 — the regression that took exact-head CI down at `5fbfc28563`. `GH_PAT` is expired and
     * returns 401; `optionalGithubRequest` handled only 403/404, so a 401 threw `github_api_401` and
     * the whole job failed with one uninformative reason instead of three honest ones.
     *
     * An invalid credential is the same epistemic state as an unauthorised one — we cannot see the
     * setting — so it resolves to `unverified` rather than exploding.
     */
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    try {
      await expect(readReviewThreadResolutionEnforcement({
        repository: 'o/r', branch: 'main', token: 'expired',
      })).resolves.toBe('unverified');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('CONTROL: a genuine server error is still a hard failure, not silently unverified', async () => {
    // The relaxation must not swallow real breakage: 500 is not an authorisation state.
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    try {
      await expect(readReviewThreadResolutionEnforcement({
        repository: 'o/r', branch: 'main', token: 't',
      })).rejects.toThrow(/github_api_500/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('CASUALTY: enforcement we could not READ is not reported as enforcement that is ABSENT', () => {
    /**
     * #1430 P1 — branch protection and rulesets need admin scope, which `github.token` lacks, so those
     * reads returned 401/403/404 and the gate published
     * `review_thread_resolution_not_enforced_at_merge` — a definite claim that the repository does NOT
     * enforce review-thread resolution. It was asserting a fact it had no ability to observe.
     *
     * Three outcomes, kept distinct: enforced, not enforced, and unreadable.
     */
    /*
     * #1430 P1 — `unverified` NOW HOLDS, REVERSING WHAT THIS CASE USED TO ASSERT.
     *
     * It previously required `qualified === true`, on the reasoning that a credential gap is not the
     * candidate's defect. That reasoning did not account for REOPENED THREADS: GitHub emits no event
     * when a thread is resolved or unresolved, so no trigger list can refresh a green check after a
     * reopen. The only remaining protection is the repository enforcing conversation resolution at
     * merge — so if enforcement cannot be verified, neither can that protection, and a stale green
     * plus unknown enforcement is exactly how a reopened P1 merges.
     *
     * The receipt still distinguishes the two causes, so an operator fixes credentials or protection
     * rather than guessing which is missing.
     */
    const unverified = applyEnforcementToReceipt({ qualified: true, reasons: [] }, 'unverified');
    expect(unverified.qualified, 'unverifiable enforcement is unverifiable protection').toBe(false);
    expect(unverified.reasons, 'and the reason names the credential gap, not absent enforcement')
      .toContain('review_thread_resolution_enforcement_unverified');
    expect(unverified.reasons, 'never stated as a definite absence we did not observe')
      .not.toContain('review_thread_resolution_not_enforced_at_merge');
    expect(unverified.warnings, 'still surfaced for audit')
      .toContain('review_thread_resolution_enforcement_unverified');

    const enforced = applyEnforcementToReceipt({ qualified: true, reasons: [] }, true);
    // CONTROL: live enforcement is what lets a qualifying head stay qualified. Without this, the case
    // above would pass against a function that simply always disqualifies.
    expect(enforced.qualified, 'live enforcement keeps a qualifying head qualified').toBe(true);

    const absent = applyEnforcementToReceipt({ qualified: true, reasons: [] }, false);
    expect(absent.qualified, 'a READ absence is still a real finding and still blocks').toBe(false);
    expect(absent.reasons).toContain('review_thread_resolution_not_enforced_at_merge');
  });

  it('CASUALTY: an unresolved P2 does NOT block, and is reported rather than hidden', () => {
    /**
     * #1430 P1 — `RELEASE_FINDING` matched `P[012]`, so one advisory finding disqualified the head and
     * failed the merge gate. That contradicts the standing closure rule, under which P2 and below route
     * to the hardening ledger and never hold a release. A gate that blocks on advice trains people to
     * bypass it, which costs more than the advice is worth.
     *
     * Non-blocking is not the same as invisible: the count is published on the receipt.
     */
    const receipt = buildReviewReceipt({ pullRequest: prWithFinding('P2 Badge: tidy this later'), expectedHeadSha: SHA });

    expect(receipt.findingCount, 'a P2 is not a blocking finding').toBe(0);
    expect(receipt.qualified, 'and it does not disqualify the head').toBe(true);
    expect(receipt.advisoryFindingCount, 'but it is still counted and reported').toBe(1);
  });

  it('CONTROL: a P1 at the same head still blocks', () => {
    // The half that must not regress with the P2 relaxation: narrowing the severity band must not
    // narrow it past the findings that genuinely hold a release.
    const receipt = buildReviewReceipt({ pullRequest: prWithFinding('P1 Badge: current defect'), expectedHeadSha: SHA });

    expect(receipt.findingCount).toBe(1);
    expect(receipt.qualified, 'a P1 still disqualifies').toBe(false);
  });

  it('CASUALTY: an unresolved current-head Codex P0/P1 fails qualification', () => {
    const github = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: {
        nodes: [{ author: { login: 'chatgpt-codex-connector[bot]' }, commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z' }],
        pageInfo: { hasPreviousPage: false },
      },
      reviewThreads: {
        nodes: [{
          isResolved: false,
          comments: { nodes: [{ author: { login: 'chatgpt-codex-connector' }, commit: { oid: SHA }, originalCommit: { oid: SHA }, pullRequestReview: { commit: { oid: SHA } }, body: 'P1 Badge: current defect' }], pageInfo: { hasPreviousPage: false } },
        }],
        pageInfo: { hasNextPage: false },
      },
    };
    expect(buildReviewReceipt({ pullRequest: github, expectedHeadSha: SHA })).toMatchObject({ qualified: false, findingCount: 1 });
  });

  it('does not relabel an old unresolved thread as current when GitHub rebases its displayed commit', () => {
    const github = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: {
        nodes: [{ author: { login: 'chatgpt-codex-connector' }, commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z' }],
        pageInfo: { hasPreviousPage: false },
      },
      reviewThreads: {
        nodes: [{
          isResolved: false,
          comments: { nodes: [{
            author: { login: 'chatgpt-codex-connector' },
            commit: { oid: SHA },
            originalCommit: { oid: OTHER_SHA },
            pullRequestReview: { commit: { oid: OTHER_SHA } },
            body: 'P1 Badge: fixed on a later head',
          }], pageInfo: { hasPreviousPage: false } },
        }],
        pageInfo: { hasNextPage: false },
      },
    };
    expect(buildReviewReceipt({ pullRequest: github, expectedHeadSha: SHA })).toMatchObject({ qualified: true, findingCount: 0 });
  });

  it('fails closed when GitHub pagination could hide files, reviews, or findings', () => {
    const base = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: {
        nodes: [{ author: { login: 'chatgpt-codex-connector' }, commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z' }],
        pageInfo: { hasPreviousPage: false },
      },
      reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
    };
    expect(buildReviewReceipt({ pullRequest: { ...base, files: { ...base.files, pageInfo: { hasNextPage: true } } }, expectedHeadSha: SHA }).qualified).toBe(false);
    expect(buildReviewReceipt({ pullRequest: { ...base, reviews: { ...base.reviews, pageInfo: { hasPreviousPage: true } } }, expectedHeadSha: SHA }).qualified).toBe(false);
    expect(buildReviewReceipt({ pullRequest: { ...base, reviewThreads: { ...base.reviewThreads, pageInfo: { hasNextPage: true } } }, expectedHeadSha: SHA }).qualified).toBe(false);
    expect(buildReviewReceipt({ pullRequest: {
      ...base,
      reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [], pageInfo: { hasPreviousPage: true } } }], pageInfo: { hasNextPage: false } },
    }, expectedHeadSha: SHA }).reasons).toContain('review_thread_comments_incomplete');
  });

  it('does not accept a lookalike reviewer login or a dismissed exact-head review', () => {
    const base = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: { nodes: [], pageInfo: { hasPreviousPage: false } },
      reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
    };
    for (const review of [
      { author: { login: 'fake-chatgpt-codex-connector' }, state: 'COMMENTED', commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z' },
      { author: { login: 'chatgpt-codex-connector' }, state: 'DISMISSED', commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z' },
    ]) {
      expect(buildReviewReceipt({ pullRequest: { ...base, reviews: { ...base.reviews, nodes: [review] } }, expectedHeadSha: SHA }))
        .toMatchObject({ qualified: false, reviewStatus: 'missing' });
    }
  });

  it('CASUALTY: a change-requesting exact-head review body cannot qualify', () => {
    const github = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: {
        nodes: [{
          author: { login: 'chatgpt-codex-connector' }, state: 'CHANGES_REQUESTED',
          commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z', body: 'P1: release blocker',
        }],
        pageInfo: { hasPreviousPage: false },
      },
      reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
    };
    expect(buildReviewReceipt({ pullRequest: github, expectedHeadSha: SHA })).toMatchObject({
      qualified: false,
      reviewStatus: 'changes_requested',
    });
  });

  it('CASUALTY: an exact-head P0/P1/P2 in the overall review body cannot qualify', () => {
    const github = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: {
        nodes: [{
          author: { login: 'chatgpt-codex-connector' }, state: 'COMMENTED',
          commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z', body: 'P1 Badge: release blocker',
        }],
        pageInfo: { hasPreviousPage: false },
      },
      reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
    };
    expect(buildReviewReceipt({ pullRequest: github, expectedHeadSha: SHA })).toMatchObject({
      qualified: false,
      findingCount: 1,
    });
  });

  it('CASUALTY: merge authority requires live unresolved-thread enforcement', () => {
    expect(reviewThreadResolutionIsEnforced({})).toBe(false);
    expect(reviewThreadResolutionIsEnforced({ branchProtection: {
      required_conversation_resolution: { enabled: false },
    } })).toBe(false);
    expect(reviewThreadResolutionIsEnforced({ branchRules: [{
      type: 'pull_request',
      parameters: { required_review_thread_resolution: false },
    }] })).toBe(false);

    expect(reviewThreadResolutionIsEnforced({ branchProtection: {
      required_conversation_resolution: { enabled: true },
      enforce_admins: { enabled: true },
    } })).toBe(true);
    expect(reviewThreadResolutionIsEnforced({ branchRules: [{
      type: 'pull_request',
      ruleset_id: 42,
      parameters: { required_review_thread_resolution: true },
    }], branchRulesets: [{
      id: 42,
      enforcement: 'active',
      bypass_actors: [],
    }] })).toBe(true);
  });

  it('CASUALTY: merge authority rejects admin and named-actor bypasses', () => {
    expect(reviewThreadResolutionIsEnforced({ branchProtection: {
      required_conversation_resolution: { enabled: true },
      enforce_admins: { enabled: false },
    } })).toBe(false);
    expect(reviewThreadResolutionIsEnforced({ branchProtection: {
      required_conversation_resolution: { enabled: true },
      enforce_admins: { enabled: true },
      required_pull_request_reviews: {
        bypass_pull_request_allowances: { users: [{ login: 'release-admin' }], teams: [], apps: [] },
      },
    } })).toBe(false);
  });

  it('CASUALTY: a ruleset must be active, readable, and free of bypass actors', () => {
    const branchRules = [{
      type: 'pull_request',
      ruleset_id: 42,
      parameters: { required_review_thread_resolution: true },
    }];
    expect(reviewThreadResolutionIsEnforced({ branchRules })).toBe(false);
    expect(reviewThreadResolutionIsEnforced({
      branchRules,
      branchRulesets: [{ id: 42, enforcement: 'active' }],
    })).toBe(false);
    expect(reviewThreadResolutionIsEnforced({
      branchRules,
      branchRulesets: [{
        id: 42,
        enforcement: 'active',
        bypass_actors: [{ actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' }],
      }],
    })).toBe(false);
    expect(reviewThreadResolutionIsEnforced({
      branchRules,
      branchRulesets: [{ id: 42, enforcement: 'evaluate', bypass_actors: [] }],
    })).toBe(false);
  });

  it('the full CI lane invokes authenticated GitHub review qualification after evidence', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow).toContain('name: exact-head-review-qualification');
    expect(workflow).toContain('node scripts/collect-review-qualification.mjs');
    expect(workflow).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(workflow).toContain('needs: [scope, full-evidence]');
    expect(workflow).toContain('full-evidence, review-qualification]');
    expect(workflow).toContain('[...REQUIRED_JOBS, "review-qualification"]');
    expect(workflow).toMatch(/pull_request_review:[\s\S]{0,120}types:\s*\[submitted, edited, dismissed\]/);
    expect(workflow).toMatch(/pull_request_review_comment:[\s\S]{0,120}types:\s*\[created, edited, deleted\]/);
    expect(workflow).toContain("github.event_name == 'pull_request_review'");
    expect(workflow).toContain("github.event_name == 'pull_request_review_comment'");
    expect(workflow).toContain('postMergePush ? formatPostMergeVerification(decision) : formatQualification(decision)');
    const collector = readFileSync('scripts/collect-review-qualification.mjs', 'utf8');
    expect(collector).toContain('/rules/branches/${encodedBranch}?per_page=100');
    expect(collector).toContain('review_thread_resolution_not_enforced_at_merge');
  });
});

describe('Q-10 canonical Production evidence eligibility', () => {
  it('qualifies only the exact canonical root with exact deployed release equality', () => {
    expect(evaluateProductionEvidenceTarget({
      baseUrl: `${CANONICAL_PRODUCTION_ORIGIN}/`,
      expectedReleaseSha: SHA,
      observedReleaseSha: SHA,
    })).toMatchObject({
      releaseProofEligible: true,
      evidenceScope: 'canonical-production',
      origin: CANONICAL_PRODUCTION_ORIGIN,
      reasons: [],
    });
  });

  it('CASUALTY: Preview and lookalike URLs cannot become canonical proof', () => {
    for (const baseUrl of [
      'https://speaksharp-git-fix.vercel.app',
      'https://speaksharp-public.vercel.app.evil.example',
      'http://speaksharp-public.vercel.app',
      'https://speaksharp-public.vercel.app/a-preview-path',
    ]) {
      const result = evaluateProductionEvidenceTarget({
        baseUrl,
        expectedReleaseSha: SHA,
        observedReleaseSha: SHA,
      });
      expect(result.releaseProofEligible).toBe(false);
      expect(result.reasons).toContain('not_canonical_production_url');
    }
  });

  it('rejects Preview before making a network request', async () => {
    const fetchImpl = vi.fn();
    const result = await qualifyEvidenceTarget({
      baseUrl: 'https://speaksharp-git-fix.vercel.app',
      expectedReleaseSha: SHA,
      evidenceScope: 'canonical-production',
      fetchImpl,
    });
    expect(result.releaseProofEligible).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('CASUALTY: a canonical host serving the wrong or unknown release is not proof', () => {
    expect(evaluateProductionEvidenceTarget({
      baseUrl: CANONICAL_PRODUCTION_ORIGIN,
      expectedReleaseSha: SHA,
      observedReleaseSha: OTHER_SHA,
    }).reasons).toContain('deployed_release_sha_mismatch');
    expect(evaluateProductionEvidenceTarget({
      baseUrl: CANONICAL_PRODUCTION_ORIGIN,
      expectedReleaseSha: SHA,
      observedReleaseSha: null,
    }).reasons).toContain('deployed_release_sha_missing_or_invalid');
  });

  it('reads the deployed release marker from served HTML', () => {
    expect(extractDeployedRelease(`<script>window.__APP_RELEASE__ = "${SHA}";</script>`)).toBe(SHA);
    expect(extractDeployedRelease('<script>window.__APP_RELEASE__ = "unknown";</script>')).toBeNull();
  });

  it('CASUALTY: a failed deployed identity read fails closed', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network unavailable'));
    const result = await qualifyEvidenceTarget({
      baseUrl: CANONICAL_PRODUCTION_ORIGIN,
      expectedReleaseSha: SHA,
      evidenceScope: 'canonical-production',
      fetchImpl,
    });
    expect(result.releaseProofEligible).toBe(false);
    expect(result.reasons).toContain('deployed_release_read_failed');
  });

  it('diagnostic/Preview evidence is explicitly and machine-readably ineligible', () => {
    expect(classifyDiagnosticEvidence({ baseUrl: 'https://example-preview.vercel.app' })).toMatchObject({
      evidenceScope: 'diagnostic',
      releaseProofEligible: false,
      reasons: ['preview_or_noncanonical_run_ineligible_for_release_proof'],
    });
  });

  it('the workflow uses distinct artifact identities and carries the eligibility receipt', () => {
    const workflow = readFileSync('.github/workflows/rc-gates.yml', 'utf8');
    expect(workflow).toContain('Classify Gate 3 evidence target');
    expect(workflow).toContain('gate-3-evidence-eligibility.json');
    expect(workflow).toContain('gate-3-dast-production-${{ github.sha }}');
    expect(workflow).toContain("if: ${{ success() && github.event.inputs.diagnostic_dast_spec == '' }}");
    expect(workflow).toContain('gate-3-dast-canonical-ineligible-${{ github.sha }}');
    expect(workflow).toContain('gate-3-dast-diagnostic-ineligible-${{ github.sha }}');
    expect(workflow).not.toMatch(/name:\s*gate-3-dast-artifacts\s*$/m);
  });

  it('CASUALTY: a diagnostic run ends the Gate 3 job red even when its selected spec passes', () => {
    const workflow = readFileSync('.github/workflows/rc-gates.yml', 'utf8');
    expect(workflow).toContain('Reject diagnostic run as release qualification');
    expect(workflow).toMatch(/Reject diagnostic run as release qualification[\s\S]*diagnostic_dast_spec != ''[\s\S]*exit 1/);
  });
});

describe('Q-08 software-quality evidence completeness', () => {
  const complete = (over = {}) => ({
    tests: {
      unit: {
        passed: 100,
        failed: 0,
        skipped: 0,
        total: 100,
        testFiles: MEANINGFUL_COVERAGE_MANIFEST.map(({ testFile }) => testFile),
      },
      e2e: { passed: 20, failed: 0, skipped: 0, total: 20 },
    },
    runtime: { totalRuntimeSeconds: 120 },
    performance: { initialChunkSize: '412K' },
    targets: { coverage: { releaseFloor: COVERAGE_RELEASE_FLOOR } },
    coverage: { statements: 80, branches: 80, functions: 80, lines: 80 },
    ...over,
  });

  it('CASUALTY: a release-path file that SKIPPED a casualty is not signed off by its neighbours', () => {
    /**
     * #1430 P1 — `testFiles` admits a file as soon as ONE test in it asserted. A manifest-listed
     * release-path file could therefore hold one passing test and a SKIPPED acceptance casualty, be
     * reported as executed, and satisfy meaningful coverage while the criterion it exists to prove
     * never ran. The suite-level skip count stayed non-negative, so nothing objected.
     *
     * The zero-skip release floor is now enforced at the only granularity that matters: the path.
     */
    const target = MEANINGFUL_COVERAGE_MANIFEST[0];
    const result = validateSoftwareQualityEvidence(complete({
      tests: {
        unit: {
          passed: 99,
          failed: 0,
          skipped: 1,
          total: 100,
          testFiles: MEANINGFUL_COVERAGE_MANIFEST.map(({ testFile }) => testFile),
          skippedTestFiles: [target.testFile],
        },
        e2e: { passed: 20, failed: 0, skipped: 0, total: 20 },
      },
    }));

    expect(result.valid, 'a skipped release path cannot qualify').toBe(false);
    expect(result.reasons).toContain(`meaningful_coverage_path_skipped:${target.id}`);
  });

  it('CONTROL: a skip OUTSIDE the manifest does not block the release', () => {
    // Rejecting per path rather than suite-wide is deliberate. A skip elsewhere in the unit suite is
    // not a release claim, and failing on it would push people to delete the manifest, not fix the skip.
    const result = validateSoftwareQualityEvidence(complete({
      tests: {
        unit: {
          passed: 99,
          failed: 0,
          skipped: 1,
          total: 100,
          testFiles: MEANINGFUL_COVERAGE_MANIFEST.map(({ testFile }) => testFile),
          skippedTestFiles: ['frontend/src/services/__tests__/someUnrelatedThing.test.ts'],
        },
        e2e: { passed: 20, failed: 0, skipped: 0, total: 20 },
      },
    }));

    expect(result.valid, 'an unrelated skip is not a release-path claim').toBe(true);
  });

  it('accepts complete metrics using the shared coverage authority', () => {
    expect(COVERAGE_RELEASE_FLOOR).toBe(75);
    expect(validateSoftwareQualityEvidence(complete())).toMatchObject({ valid: true, reasons: [] });
  });

  it('CASUALTY: unit 0/0 is missing evidence, not a plausible green count', () => {
    const result = validateSoftwareQualityEvidence(complete({
      tests: { unit: {
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        testFiles: MEANINGFUL_COVERAGE_MANIFEST.map(({ testFile }) => testFile),
      } },
    }));
    expect(result.reasons).toContain('unit_metrics_missing_or_empty');
  });

  it('CASUALTY: failing unit or E2E tests cannot qualify a release', () => {
    const unitFailure = validateSoftwareQualityEvidence(complete({
      tests: {
        unit: {
          passed: 90,
          failed: 10,
          skipped: 0,
          total: 100,
          testFiles: MEANINGFUL_COVERAGE_MANIFEST.map(({ testFile }) => testFile),
        },
        e2e: { passed: 20, failed: 0, skipped: 0, total: 20 },
      },
    }));
    expect(unitFailure.reasons).toContain('unit_tests_failed:10');

    const e2eFailure = validateSoftwareQualityEvidence(complete({
      tests: {
        unit: complete().tests.unit,
        e2e: { passed: 18, failed: 2, skipped: 0, total: 20 },
      },
    }));
    expect(e2eFailure.reasons).toContain('e2e_tests_failed:2');
  });

  it('CASUALTY: test outcome counts must be present and reconcile to the total', () => {
    const missingFailureCount = validateSoftwareQualityEvidence(complete({
      tests: {
        unit: complete().tests.unit,
        e2e: { passed: 20, skipped: 0, total: 20 },
      },
    }));
    expect(missingFailureCount.reasons).toContain('e2e_failed_count_missing_or_invalid');

    const inconsistent = validateSoftwareQualityEvidence(complete({
      tests: {
        unit: complete().tests.unit,
        e2e: { passed: 20, failed: 0, skipped: 1, total: 20 },
      },
    }));
    expect(inconsistent.reasons).toContain('e2e_test_counts_inconsistent');
  });

  it('CASUALTY: the Markdown fallback preserves failures instead of relabelling them skipped', () => {
    const parsed = parseCiAuditOverride(`
### Unit Tests
- **Passed**: 90 / 100
- **Failed**: 10
### E2E Tests (Playwright)
- **Passed**: 18 / 20
- **Failed**: 2
`);
    expect(parsed).toMatchObject({
      unit_tests: { passed: 90, failed: 10, skipped: 0, total: 100 },
      e2e_tests: { passed: 18, failed: 2, skipped: 0, total: 20 },
    });
  });

  it('CASUALTY: zero runtime is missing evidence, not a valid measurement', () => {
    const result = validateSoftwareQualityEvidence(complete({ runtime: { totalRuntimeSeconds: 0 } }));
    expect(result.reasons).toContain('runtime_metric_missing_or_zero');
  });

  it('CASUALTY: an unknown initial chunk cannot publish qualified evidence', () => {
    for (const initialChunkSize of [null, undefined, 'unknown', 'N/A', '0K']) {
      const result = validateSoftwareQualityEvidence(complete({ performance: { initialChunkSize } }));
      expect(result.reasons).toContain('initial_chunk_metric_missing_or_unknown');
    }
  });

  it('CASUALTY: the historical 60% floor cannot override the shared 75% authority', () => {
    const result = validateSoftwareQualityEvidence(complete({
      targets: { coverage: { releaseFloor: 60 } },
    }));
    expect(result.reasons).toContain('coverage_release_floor_not_authoritative');
  });

  it('CASUALTY: aggregate 75%+ without meaningful-path execution receipts cannot qualify', () => {
    const result = validateSoftwareQualityEvidence(complete({
      coverage: { statements: 90, branches: 90, functions: 90, lines: 90 },
      tests: { unit: { passed: 100, failed: 0, skipped: 0, total: 100, testFiles: [] } },
    }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('meaningful_coverage_execution_receipt_missing');
    for (const { id } of MEANINGFUL_COVERAGE_MANIFEST) {
      expect(result.reasons).toContain(`meaningful_coverage_path_missing:${id}`);
    }
  });

  it('enforces the authoritative floor against every aggregate coverage metric', () => {
    const result = validateSoftwareQualityEvidence(complete({
      coverage: { statements: 75, branches: 74.99, functions: 75, lines: 75 },
    }));
    expect(result.reasons).toContain('coverage_below_release_floor:branches');
  });

  it('the meaningful manifest admits behavior/casualty evidence only', () => {
    expect(MEANINGFUL_COVERAGE_MANIFEST.map(({ id }) => id)).toEqual([
      'stt', 'session-lifecycle', 'quota-billing', 'pdf', 'analytics-truth', 'failure-handling',
    ]);
    expect(MEANINGFUL_COVERAGE_MANIFEST.every(({ evidenceType }) => evidenceType === 'behavior-casualty'))
      .toBe(true);
  });

  it('fails closed when the meaningful-coverage manifest is absent', () => {
    const result = validateSoftwareQualityEvidence(complete(), { meaningfulCoverageManifest: [] });
    expect(result.reasons).toContain('meaningful_coverage_manifest_missing');
  });

  it('the workflow aggregates before generating evidence and preserves canonical unit counts', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow.indexOf('- name: Aggregate CI Metrics')).toBeLessThan(
      workflow.indexOf('- name: Generate qualified software quality evidence'),
    );
    expect(workflow).toContain('test-results/unit/results.json');
  });

  it('publishes qualified evidence only after final assertions and never under always()', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const assertAt = workflow.indexOf('- name: Assert Required Evidence Is Present');
    const verifyAt = workflow.indexOf('- name: Verify Canonical Artifacts');
    const generateAt = workflow.indexOf('- name: Generate qualified software quality evidence');
    const uploadAt = workflow.indexOf('- name: Upload CI Metrics');
    expect(assertAt).toBeGreaterThan(0);
    expect(assertAt).toBeLessThan(verifyAt);
    expect(verifyAt).toBeLessThan(generateAt);
    expect(generateAt).toBeLessThan(uploadAt);
    expect(workflow.slice(uploadAt, uploadAt + 120)).not.toContain('if: always()');
  });
});

/**
 * #1430 P1 — A REOPENED THREAD CANNOT RETAIN A QUALIFYING RESULT.
 *
 * GitHub emits NO workflow event when a review thread is resolved or unresolved, so no trigger list can
 * refresh a check after a reopen — a green `review-qualification` from before the reopen stays green.
 * There is no trigger to add, and inventing one would be worse than the gap.
 *
 * Two things therefore have to hold, and both are asserted here:
 *   1. whenever the check DOES run, an unresolved release finding disqualifies the head; and
 *   2. qualification depends on LIVE, VERIFIABLE conversation-resolution enforcement, so that in the
 *      window where the check has not re-run, the repository itself blocks the merge — and when that
 *      enforcement cannot be verified, the result HOLDS rather than standing.
 */
describe('#1430 P1 — reopened threads and push qualification', () => {
  const reviewedSha = 'a'.repeat(40);
  const bot = { login: 'chatgpt-codex-connector' };
  const pullWith = (threads) => ({
    number: 1,
    headRefOid: reviewedSha,
    baseRefName: 'main',
    files: { nodes: [{ path: 'scripts/collect-review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
    reviews: {
      nodes: [{ author: bot, state: 'COMMENTED', commit: { oid: reviewedSha }, body: 'reviewed', submittedAt: '2026-09-10T00:00:00Z' }],
      pageInfo: { hasPreviousPage: false },
    },
    reviewThreads: { nodes: threads, pageInfo: { hasNextPage: false } },
  });
  const thread = (isResolved, body) => ({
    isResolved,
    comments: {
      nodes: [{ author: bot, body, commit: { oid: reviewedSha }, originalCommit: { oid: reviewedSha }, pullRequestReview: { commit: { oid: reviewedSha } } }],
      pageInfo: { hasPreviousPage: false },
    },
  });

  it('CASUALTY: an UNRESOLVED release finding at the reviewed head does not qualify', () => {
    // The reopen case at the data level: a thread that was resolved and is now open again is simply an
    // unresolved thread, and the receipt must refuse it whenever the check runs.
    const receipt = buildReviewReceipt({
      pullRequest: pullWith([thread(false, 'P1 Badge — a live release finding')]),
      expectedHeadSha: reviewedSha,
    });
    expect(receipt.qualified, 'a reopened P1 thread cannot ride a qualifying receipt').toBe(false);
  });

  it('CONTROL: the same head with that thread RESOLVED does qualify', () => {
    // Without this the case above would pass against a receipt builder that refuses everything.
    const receipt = buildReviewReceipt({
      pullRequest: pullWith([thread(true, 'P1 Badge — addressed and resolved')]),
      expectedHeadSha: reviewedSha,
    });
    expect(receipt.qualified, 'resolution is what clears it').toBe(true);
  });

  it('CASUALTY: a qualifying receipt HOLDS when resolution enforcement cannot be verified', () => {
    /**
     * The window the reopen exploits. The check may not re-run at all, so the standing protection has
     * to be the repository's own enforcement — and an unverifiable enforcement is an unverifiable
     * protection, which must not read as qualified.
     */
    const receipt = buildReviewReceipt({
      pullRequest: pullWith([thread(true, 'P1 Badge — resolved')]),
      expectedHeadSha: reviewedSha,
    });
    expect(receipt.qualified, 'qualifying on its own terms first').toBe(true);
    expect(applyEnforcementToReceipt(receipt, 'unverified').qualified,
      'but it cannot stand while the mechanism that would catch a reopen is unverifiable').toBe(false);
  });

  describe('the push lane fails closed', () => {
    const withFetch = async (payload, fn) => {
      const original = globalThis.fetch;
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => payload });
      try { return await fn(); } finally { globalThis.fetch = original; }
    };
    const pushSha = 'b'.repeat(40);
    const target = () => resolveQualificationTarget({
      repository: 'o/r', expectedHeadSha: pushSha, token: 't', explicitNumber: '', eventName: 'push',
    });

    it('CASUALTY: a DIRECT push with no associated merged PR holds', async () => {
      // The defect this whole correction exists for: `review-qualification` used to skip `push`
      // entirely, so a commit pushed straight to `main` was reported release-qualified having had no
      // review authority examined at all.
      await withFetch([], async () => {
        await expect(target()).rejects.toThrow(/push_without_verifiable_associated_pr:0/);
      });
    });

    it('CASUALTY: an AMBIGUOUS push with two associated merged PRs holds', async () => {
      const merged = (n) => ({ number: n, state: 'closed', merged_at: '2026-09-10T00:00:00Z', merge_commit_sha: pushSha, head: { sha: reviewedSha } });
      await withFetch([merged(1), merged(2)], async () => {
        await expect(target()).rejects.toThrow(/push_without_verifiable_associated_pr:2/);
      });
    });

    it('CONTROL: one associated merged PR qualifies the SHA IT WAS REVIEWED AT, not the merge commit', async () => {
      /**
       * The reviewed SHA and the pushed SHA are different commits after a squash. Returning the pushed
       * merge commit would qualify a commit nobody reviewed, so this pins which one governs — and it is
       * what makes the two holds above meaningful rather than a blanket refusal of all pushes.
       */
      await withFetch([{ number: 7, state: 'closed', merged_at: '2026-09-10T00:00:00Z', merge_commit_sha: pushSha, head: { sha: reviewedSha } }], async () => {
        await expect(target()).resolves.toEqual({ number: 7, reviewedSha });
      });
    });
  });
});
