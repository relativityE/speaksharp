# Normalises `supabase functions list -o json` into the complete, sorted roster the account-closure-only route compares.
# Refuses (jq error, non-zero exit) on an incomplete or ambiguous read: a non-array, an entry without a string slug,
# a numeric version, an updated_at (the Management API returns an integer; a non-empty string is also accepted) and a
# string status, or a duplicated slug. Metadata only; never source or secrets.
if type != "array" then error("functions list is not an array") else . end
| map(
    if (.slug | type) == "string" and (.slug | length) > 0 and (.version | type) == "number"
       and (((.updated_at | type) == "number") or ((.updated_at | type) == "string" and (.updated_at | length) > 0))
       and (.status | type) == "string"
    then {slug, version, status, updated_at}
    else error("incomplete function metadata") end)
| sort_by(.slug)
| if (map(.slug) | unique | length) != length then error("duplicate function slug") else . end
