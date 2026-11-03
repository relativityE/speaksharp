// Three bounded semantic faults at existing product boundaries. These controls supplement the
// coverage floor; they make no claim about unregistered journeys or a mutation percentage.
export const USER_HARM_CONTROLS = Object.freeze([
  {
    id: 'wrong-account-saved-review',
    harm: 'A cached transcript from another account is shown after an account switch.',
    sourceFile: 'frontend/src/components/session/restorableSession.ts',
    testFile: 'frontend/src/components/session/__tests__/restorableSession1258.test.ts',
    control: [{
      anchor: 'return row.id === restoreId && row.user_id === ownerId ? row : null;',
      replacement: 'return restoreId === row.id && ownerId === row.user_id ? row : null;',
    }],
    mutants: [{
      id: 'ignore-saved-review-owner',
      anchor: 'return row.id === restoreId && row.user_id === ownerId ? row : null;',
      replacement: 'return row.id === restoreId ? row : null;',
      assertion: 'restorableSession CASUALTY: a cached row of ANOTHER account is never shown, even when the id matches',
      assertionAnchor: "expect(restorableSession(row({ user_id: 'owner-a' }), 's1', 'owner-b')).toBeNull();",
    }],
  },
  {
    id: 'lost-detected-focus-point',
    harm: 'A saved partially detected point becomes a false negative in the terminal Focus result.',
    sourceFile: 'frontend/src/utils/focusCoverage.ts',
    testFile: 'frontend/src/utils/__tests__/focusCoverage.test.ts',
    control: [{
      anchor: "const covered = status === 'covered' || status === 'partial';",
      replacement: "const covered = (status === 'covered' || status === 'partial');",
    }],
    mutants: [{
      id: 'drop-partial-terminal-detection',
      anchor: "const covered = status === 'covered' || status === 'partial';",
      replacement: "const covered = status === 'covered';",
      assertion: 'focusCoverage.applyFinalizedCoverageAuthority — terminal truth counts a partial terminal match as detected while preserving the partial status',
      assertionAnchor: "expect(terminal?.coveredCount).toBe(1);\n        expect(terminal?.rows[0]).toMatchObject({ status: 'partial', covered: true });",
    }],
  },
  {
    id: 'discarded-feedback-correction',
    harm: 'A corrected report reuses a possibly committed delivery identity and is silently deduplicated.',
    sourceFile: 'frontend/src/components/IssueReportDialog.tsx',
    testFile: 'frontend/src/components/__tests__/IssueReportDialog.component.test.tsx',
    control: [{
      anchor: 'if (attempted.signature === draftSignature) return;',
      replacement: 'if (draftSignature === attempted.signature) return;',
    }],
    mutants: [{
      id: 'reuse-feedback-delivery-identity-after-edit',
      anchor: 'if (attempted.signature === draftSignature) return;',
      replacement: 'if (attempted !== null) return;',
      assertion: '#1404 Share feedback redesign #1416 editing after a failed attempt sends under a new delivery identity',
      assertionAnchor: 'expect(secondCall.idempotencyKey).not.toBe(firstKey);',
    }],
  },
]);
