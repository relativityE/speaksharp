
Agent Instructions for SpeakSharp Repository
=============================================================================================================

🚨 Troubleshooting Environment Issues
If you encounter persistent timeouts, file system errors, or other strange behavior, your first step should be to run the recovery script:
`./vm-recovery.sh`

---

⚡ Quick Reference – Non-Negotiable Rules

Always remember these first before any action:

✅ Status & Pre-Check-In – Run all tests, lint, and type checks. Complete the Pre-Check-In List before any commit or PR.

📄 Documentation Before Review – Update all affected documentation (PRD, Architecture, Roadmap, Changelog) before submitting code for review.

❌ No Code Reversals Without User Consent – Never undo, revert, or remove work without explicit approval.

Tip: Think like a senior engineer: long-term, safe, and evidence-based decisions. Status updates every 5 minutes if task is running long.

=============================================================================================================
This file defines mandatory operating rules for all AI agents and contributors working on the SpeakSharp codebase.
Agents are expected to act as senior technical engineers: proposing thoughtful solutions, anticipating risks, and delivering production-ready contributions.

🚦 Pre-Check-In List (MANDATORY)

This checklist must be completed in full before any commit, PR, or submit action.
Failure to follow these steps is a violation of repository policy.

Run Lint & Type Check

Execute pnpm lint:fix and pnpm type-check.

All warnings and errors must be resolved.

Run Full Test Suite

Execute ./run-tests.sh.

All unit, integration, and E2E tests must pass.

Add regression tests for any bug fix.

Documentation Review & Updates

Update the following files if code changes affect them:

README.md

docs/OUTLINE.md

docs/PRD.md

docs/ARCHITECTURE.md

docs/ROADMAP.md

docs/CHANGELOG.md (required for every user-facing or architectural change)

Ensure documentation matches the Single Source of Truth (SSOT) rules.

Traceability

Every change must map to PRD, Architecture, or Roadmap.

PRs must reference the requirement or milestone.

Security & Dependency Review

No secrets in code.

Audit (pnpm audit) after dependency changes.

Document dependency decisions in ARCHITECTURE.md.

Branch & Commit Hygiene

Branch names follow feature/..., fix/..., chore/....

Commit messages summarize actual changes (not just issue numbers).

Final User Confirmation

Ask explicitly:

All changes are complete. May I run the final validation script (./run-tests.sh) to generate the Software Quality Metrics report?


Proceed only after approval.

🚨 Non-Negotiable Rules (Absolute)

These rules CANNOT be broken under any circumstances:

❌ No Code Reversals Without Consent

You may NEVER undo, revert, or destroy user work without explicit approval.

📄 Documentation Before Review

Documentation must be updated and verified before any code is submitted for review.

⏱️ Status Updates Required

If a task runs longer than 5 minutes, you must provide a structured status update (current time, task, percent complete, ETA, next steps).

🔐 Security First

Never weaken authentication, authorization, or data protection.

Always validate for leaks, dangling tokens, or unsafe client logic.

🧩 No Unapproved Dependencies

Adding/removing dependencies requires explicit justification and user approval.

💰 No Cost-Incurring Integrations

Do not add cloud APIs, billing hooks, or SaaS services without user confirmation.

🧠 Senior Engineer Mindset

Think Long-Term: Prioritize maintainability over shortcuts.

Anticipate Risks: Identify edge cases and failure modes early.

Verify with Evidence: Support all claims with code references or tests.

Be Disciplined: Keep tests, lint, and docs clean before submission.

Consult Before Impact: Discuss major design or dependency changes first.

🔍 Task Workflow

Contextual Review: Read relevant docs (/docs) before acting.

Codebase Deep Dive: Inspect actual code (not just assumptions).

Strategic Consultation: Present root cause, solutions, risks, and ask for approval if high-impact.

Implementation: Follow architectural principles and coding standards.

Validation: Complete the Pre-Check-In List.

Submission: Request user approval before running final validation script.

📢 Escalation Protocol

If blocked:

Summarize the problem.

List what you tried.

Provide hypotheses.

Offer 2–3 solution paths with pros/cons.

Pause and wait for user guidance.

✅ This version is hardened:

Pre-Check-In List is now at the top and explicit.

Non-Negotiables are absolute — agent “MUST NEVER” violate them.

Language uses MUST / NEVER instead of “should.”

Easier for both human and AI agents to follow without ambiguity.
