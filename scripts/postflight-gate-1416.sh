#!/usr/bin/env bash
# #1416 — MACHINE-ENFORCED pre/postflight gate for the Share Feedback storage contract
# (20260904150000_share_feedback_redesign.sql).
#
# Asserts each expectation and EXITS NONZERO on any deviation, so a partial or wrong apply cannot be
# mistaken for a completed one. A readback that only prints state is a diagnostic, not a gate.
#
# WHY `before` MATTERS. If the column and the exact pairing are already present, this migration has
# nothing to do and the run must stop rather than report a success it did not cause.
#
# WHAT THIS PROTECTS, specifically:
#
#   1. The uniqueness backing `ON CONFLICT (idempotency_key)` must be UNCONDITIONAL. PostgREST cannot
#      use a PARTIAL unique index as a conflict target, so a `WHERE` clause here does not merely
#      weaken the guarantee — it makes every normal Send fail. `indpred IS NULL` is the assertion.
#   2. `feedback_type`, `feedback_kind` and `severity` must be one contract. The application boundary
#      derives all three together, so any other writer can otherwise store a record the product could
#      never have produced — a `praise` routed as an issue, or a `blocked` report ranked `low`.
#
# The pairing is asserted against `pg_get_constraintdef`, which reports the definition the database
# actually holds. This gate is READ-ONLY: it issues SELECTs and writes nothing, not even inside a
# rolled-back transaction. The rejection BEHAVIOUR is proven against real DDL in
# `tests/db/share-feedback-redesign.integration.test.ts`, which exercises every accepted and
# rejected pair; this gate proves the deployed database carries that same definition.
#
# CONNECTION: uses DB_URL if set, else the ambient PG* env — never a URI with an embedded credential.
#
# Usage:  DB_URL=postgres://… postflight-gate-1416.sh before|after
set -euo pipefail

MODE="${1:-}"
[ "$MODE" = "before" ] || [ "$MODE" = "after" ] || { echo "usage: DB_URL=… $0 before|after" >&2; exit 2; }

if [ -n "${DB_URL:-}" ]; then PSQL=(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt)
else PSQL=(psql -v ON_ERROR_STOP=1 -qAt); fi
q() { "${PSQL[@]}" -c "$1"; }

fails=0
check() {
  if [ "$2" = "$3" ]; then printf '  OK   %-56s %s\n' "$1" "$3"
  else printf '  FAIL %-56s expected=%s actual=%s\n' "$1" "$2" "$3"; fails=$((fails+1)); fi
}

TABLE="public.user_issue_reports"

idem_column="$(q "SELECT count(*)::text FROM information_schema.columns
  WHERE table_schema='public' AND table_name='user_issue_reports' AND column_name='idempotency_key'")"

idem_column_type="$(q "SELECT coalesce(max(data_type),'-') FROM information_schema.columns
  WHERE table_schema='public' AND table_name='user_issue_reports' AND column_name='idempotency_key'")"

# Unique AND unconditional. A partial index is unusable as a PostgREST conflict target.
idem_index_total="$(q "SELECT count(*)::text FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relname = 'user_issue_reports_idempotency_key_unique' AND i.indisunique")"

idem_index_partial="$(q "SELECT count(*)::text FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relname = 'user_issue_reports_idempotency_key_unique' AND i.indpred IS NOT NULL")"

constraint_def="$(q "SELECT coalesce(max(pg_get_constraintdef(oid)),'-') FROM pg_constraint
  WHERE conrelid = '${TABLE}'::regclass AND conname = 'user_issue_reports_severity_safe'")"

has_pair() { case "$constraint_def" in *"$1"*) echo present;; *) echo absent;; esac; }

# Normalised text of each exact pairing the contract requires.
minor_low="$(has_pair "'minor'")"
pair_low="$(has_pair "= 'low'")"
pair_medium="$(has_pair "= 'medium'")"
pair_high="$(has_pair "= 'high'")"
kind_issue="$(has_pair "= 'issue'")"
kind_comment="$(has_pair "= 'comment'")"
# The any-of form the exact pairing replaced. Its presence means the weak constraint is still live.
weak_form="$(has_pair "severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])")"

echo "#1416 Share Feedback storage contract — mode=$MODE"

if [ "$MODE" = "before" ]; then
  check 'idempotency_key column absent'                 0        "$idem_column"
  check 'unconditional unique index absent'             0        "$idem_index_total"
  check 'exact type/kind pairing not yet enforced'      absent   "$kind_issue"
else
  check 'idempotency_key column present'                1        "$idem_column"
  check 'idempotency_key is uuid'                       uuid     "$idem_column_type"
  check 'unique index on idempotency_key present'       1        "$idem_index_total"
  check 'unique index is NOT partial'                   0        "$idem_index_partial"
  check 'severity_safe constraint present'              present  "$(if [ "$constraint_def" = '-' ]; then echo absent; else echo present; fi)"
  check 'exact pair minor is named'                     present  "$minor_low"
  check 'exact pair target low is named'                present  "$pair_low"
  check 'exact pair target medium is named'             present  "$pair_medium"
  check 'exact pair target high is named'               present  "$pair_high"
  check 'broke is bound to kind issue'                  present  "$kind_issue"
  check 'other types are bound to kind comment'         present  "$kind_comment"
  check 'permissive any-of severity form is gone'       absent   "$weak_form"
fi

if [ "$fails" -ne 0 ]; then
  echo "::error::#1416 storage-contract gate failed $fails assertion(s) in mode $MODE"
  exit 1
fi
echo "#1416 storage-contract gate passed ($MODE)"
