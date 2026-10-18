// Synthetic protocol fixture only; actual catalogs are exercised in db/native tests.
export function enforcedClosureReceipt() {
    return { mode: 'verify', passed: true, stages: [
        { mode: 'enforced', passed: true, checks: { exact_routine_inventory: true, routine_identity_and_acl: true,
            tables_closed_and_rls: true, billing_guard_enabled: true } },
        { mode: 'rollout-enforced', passed: true, checks: { exact_table_definitions: true, required_columns: true,
            signup_trigger: true, trial_email_arbiter: true, trial_owner_fk: true } },
        { mode: 'drain-after', passed: true, checks: { drain_routine_inventory: true, drain_routine_identity_acl: true,
            drain_tables_closed_rls: true, drain_table_identity: true } },
        { mode: 'enforcement-after', passed: true, checks: { enforcement_inventory: true, enforcement_routine_identity_acl: true,
            legacy_owner_only: true, journal_columns_private: true } },
        { mode: 'disabled', passed: true, checks: { rollout_disabled: true } },
    ] };
}
