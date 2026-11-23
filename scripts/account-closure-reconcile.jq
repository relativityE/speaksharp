# account-closure-only reconciliation over two complete rosters (scripts/edge-roster.jq), $before[0] and $after[0].
#   publishedAdvanced: the target existed before AND after, and its version strictly increased.
#   othersUnchanged:   every OTHER function is identical (slug, version, status, updated_at), with no additions or removals.
($before[0]) as $b | ($after[0]) as $a
| ($b | map(select(.slug == $published))) as $tb
| ($a | map(select(.slug == $published))) as $ta
| ($b | map(select(.slug != $published))) as $ob
| ($a | map(select(.slug != $published))) as $oa
| {
    schemaVersion: 2, route: "account-closure-only", deployOutcome: $outcome, published: $published,
    target: {before: ($tb[0].version // null), after: ($ta[0].version // null)},
    publishedAdvanced: (($tb | length) == 1 and ($ta | length) == 1 and ($ta[0].version > $tb[0].version)),
    othersUnchanged: ($ob == $oa),
    added: [($oa | map(.slug)) - ($ob | map(.slug)) | .[]],
    removed: [($ob | map(.slug)) - ($oa | map(.slug)) | .[]],
    changed: [$ob[] as $x | ($oa | map(select(.slug == $x.slug)) | first) as $y | select($y != null and $y != $x) | $x.slug]
  }
| .changedOthers = (.added + .removed + .changed)
