# SpeakSharp Testing Strategy

> [!NOTE]
> The authoritative testing strategy, mock hierarchy, and decision tree have been centralized in the main architecture documentation.

Please refer to:
👉 **[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md#3-testing-strategy--governance)**

## Summary of Strategy

1.  **Hierarchy**: Real Imp > E2E Config > TestRegistry > `vi.mock`.
2.  **Stores**: Use Real Stores + Reset (avoid manual mocks).
3.  **Governance**:
    -   Business Logic: 85% Coverage
    -   Hooks: 80% Coverage

## Related Guides

-   **[E2E Guide](./README.md)**: specific details on Playwright infrastructure.
-   **[Test Playbook](./TEST_PLAYBOOK.md)**: Execution details for CI, Soak, and Agent-Safe (`test:agent`) pipelines.
-   **[Detailed Approach](./CODEBASE_FIX_APPROACH.md)**: common issues and resolutions.
