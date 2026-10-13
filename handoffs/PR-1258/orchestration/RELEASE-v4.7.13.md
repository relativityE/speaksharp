# Orch v4.7.13 / coordination.7 — authorized Mac trial

Published at PO request on 2026-10-13. Only PO installs. Stop the older foreground board in its launcher terminal with Ctrl-C when idle before this block; keep the new terminal running. Launch opens the browser after the actual API responds and migrates verified prior state. No LaunchAgent/login service is installed.

Archive SHA256: `00163bc0919900acc37c857c35aa590dcc8197be752e7f61644ee4fb9f85bd45`; bytes327699; Git blob81095837c581ad55af46b8697513f05c9b35916f;74 packaged files.

```bash
bash <<'BASH'
set -euo pipefail
orch_install_root="$HOME/SW_Dev"
mkdir -p "$orch_install_root"
gh api repos/relativityE/speaksharp/git/blobs/81095837c581ad55af46b8697513f05c9b35916f --jq '.content' |
  python3 -c 'import sys,base64; sys.stdout.buffer.write(base64.b64decode(sys.stdin.read()))' > "$orch_install_root/rwt-pr-handoff-v4.7.13.zip"
printf '%s  %s\n' '00163bc0919900acc37c857c35aa590dcc8197be752e7f61644ee4fb9f85bd45' "$orch_install_root/rwt-pr-handoff-v4.7.13.zip" | shasum -a 256 -c -
unzip -o "$orch_install_root/rwt-pr-handoff-v4.7.13.zip" -d "$orch_install_root"
cd "$orch_install_root/rwt-pr-handoff-v4.7.13"
exec python3 orch-setup.py
BASH
```

Validation:781 full Python test executions passed;8 startup tests passed after adding verified12 predecessor coverage; dashboard Node smoke and launcher syntax passed; final manifest and clean ZIP extraction verified. Includes simplified delegated PM review/CI, actual-PR source authority, Ops/Beta lifecycle support, durable per-route outage incidents, priority/current checkpoints, state migration, startup readiness, ownership/status separation and wrapping. MAC-ACCEPTANCE.md in the bundle maps all captured complaints.

Installed idle wake and full no-copy-paste handoff remain acceptance tests, not claims. Browser sessions lacking an inbound integration cannot be awakened by posting GitHub comments; native CLI PM is the supported coordinator. Real pairing/session routes and watcher recovery must be validated on the Mac. No Production merge/deploy/migration/provider/RWT/credential authority is granted by installing this coordination tool.
