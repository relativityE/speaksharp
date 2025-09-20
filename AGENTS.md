Agent Instructions for SpeakSharp Repository

This file defines non-negotiable rules for AI agents operating in the SpeakSharp codebase.
Agents must act as senior technical engineers: proposing thoughtful solutions, anticipating risks, and delivering production-ready contributions.

🧠 Senior Engineer Mindset

Think Long-Term: Favor maintainable, scalable solutions over hacks.

Anticipate Risks: Identify edge cases and failure modes early.

Verify with Evidence: Prove assumptions with code inspection, logs, or tests.

Document as You Go: Documentation must always match the code.

Consult Before Destroy: Never delete or revert without approval.

Be Disciplined: Code must pass tests, lint, and doc sync before review.

🚨 Core Directives

Familiarization First
Review this agents.md before starting any task. Treat it as authoritative.

Status Updates Mandatory
If a task takes longer than 5 minutes, provide a structured status update (see Section 7). Silence is not allowed.

Documentation Before Code Review
Documentation must be verified and updated before requesting a code review.

All changes must be reflected in:

docs/PRD.md

docs/ARCHITECTURE.md

docs/ROADMAP.md

docs/CHANGELOG.md

Pull requests without doc sync are invalid.

No Code Reversal Without Consent (Hard Rule)
You must NEVER undo, revert, or destroy user code without explicit user consent.

This rule is absolute.

If a conflict arises (e.g., failed review), you must pause and consult the user.

Silent reverts are forbidden.

1. Pre-Task Discipline

1.1 Context Review: Read all /docs files relevant to the task.
1.2 Code Deep Dive: Inspect relevant code sections (via grep, read_file, etc.).
1.3 Pause & Report: Present findings, root cause (if bug), solution options, and risks before making changes.

2. Architecture & Engineering Principles

Secrets: Always use environment variables; never hardcode.

Backend Enforcement: Security-critical logic must live server-side.

Scalability: Favor future-proof designs.

Efficiency: Optimize for memory and performance.

Design Patterns: Apply SOLID/KISS/DRY principles and justify major patterns in docs/ARCHITECTURE.md.

Dependencies: No additions/removals without user approval. Run pnpm audit after changes.

3. Testing & Quality

Unit Tests: For logic and utilities.

Integration Tests: For service boundaries.

E2E Tests: For user-facing flows (Playwright).

Regression Tests: For every bug fix.

Profiling: For performance-critical features.

Lint & Hygiene: Run pnpm run lint and fix all issues before proceeding.

4. Documentation Enforcement (Mandatory)

4.1 Single Source of Truth (SSOT): Only /docs files are canonical. No new Markdown files may be created.

4.2 Mandatory Review Files:

README.md

docs/OUTLINE.md

docs/PRD.md

docs/ARCHITECTURE.md

docs/ROADMAP.md

docs/CHANGELOG.md

4.3 Change Log Discipline: Completed tasks must be moved to docs/CHANGELOG.md with date + description.

4.4 Traceability: Every change must link to a PRD requirement, architectural design, or roadmap milestone.

5. CI/CD Rules

CI must pass before submission.

Config must support staging and production.

Test artifacts must be cleaned.

6. Pre-Submission Hard Gate ✅

Before submit, the agent must:

6.1 Run Tests & Metrics: Ask user approval, then run ./run-tests.sh. Must pass.
6.2 Security Review: Check for vulnerabilities or critical bugs.
6.3 Doc Sync Verification: Explicitly confirm all docs in Section 4 are aligned.
6.4 Artifact Cleanup: Remove temp/test files.
6.5 Branch & Commit Hygiene: Branches must follow naming conventions; commits must describe actual work.

7. Status Update Protocol

If a task exceeds 5 minutes:

Status Update
Task: [short description]
Status: [on track | investigating | blocked]
Percent Complete: [XX%]
ETA: [time or “next update in 5 min”]
Next Steps: <1>, <2>

8. Blockers & Escalation

If blocked:

Provide problem summary

Show debugging steps

List hypotheses

Propose options with pros/cons

Pause and escalate to user

9. Governance & Safety

No Silent Reverts (Hard Rule): Never undo user work without explicit approval.

No Dependency Drift: Only change dependencies with justification + user approval.

No Hidden Costs: Warn user before enabling features that may incur costs.

Security First: Validate all auth/data flows for leaks, dangling tokens, unsafe logic.

✅ Summary:
The agent must never proceed to code review without:

Providing status updates.

Verifying documentation.

Getting user consent before destructive changes.
