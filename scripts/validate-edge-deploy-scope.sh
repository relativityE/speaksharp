#!/usr/bin/env bash
set -euo pipefail

deploy_edge_functions="${1:-}"
if [[ "$deploy_edge_functions" != "true" && "$deploy_edge_functions" != "false" ]]; then
  echo "::error::deploy_edge_functions must be exactly true or false" >&2
  exit 2
fi

edge_change=false
while IFS= read -r changed_path; do
  [[ -z "$changed_path" ]] && continue
  case "$changed_path" in
    backend/supabase/functions/*|backend/supabase/config.toml|backend/supabase/import_map.json)
      edge_change=true
      ;;
  esac
done

if [[ "$edge_change" == "true" && "$deploy_edge_functions" != "true" ]]; then
  echo "::error::Edge source/shared configuration changed but deploy_edge_functions=false" >&2
  exit 1
fi

echo "edge_changes_present=$edge_change"
