#!/usr/bin/env bash
# Test-agent environment self-check.
#
# Run at the START of every Test-agent session. RC-gate / CI / STT-proof work
# requires GitHub + npm network, a valid `gh` token, a writable `.git`, and a
# launchable Playwright Chromium. When a sandbox regresses, these break and the
# agent CANNOT own GitHub/CI/RC work — Dev covers it until this returns GREEN.
#
# Usage:  bash scripts/test-env-selfcheck.sh
# Exit:   0 = ENV GREEN (resume ownership) · 1 = ENV BLOCKED (Dev covers)
set +e
REPO="$(git -C "$(dirname "${BASH_SOURCE[0]:-$0}")" rev-parse --show-toplevel 2>/dev/null || pwd)"
PASS=0; FAIL=0
ok(){ echo "  PASS  $1"; PASS=$((PASS+1)); }
no(){ echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

echo "== TEST ENV SELF-CHECK $(date -u +%FT%TZ) =="

# 1) GitHub reachable (DNS + TLS)
code=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' https://github.com 2>/dev/null)
case "$code" in 200|301|302) ok "github.com reachable (HTTP $code)";; *) no "github.com NOT reachable (got '${code:-no-response}')";; esac

# 2) npm registry reachable
ncode=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' https://registry.npmjs.org 2>/dev/null)
case "$ncode" in 200) ok "registry.npmjs.org reachable";; *) no "registry.npmjs.org NOT reachable (got '${ncode:-no-response}')";; esac

# 3) gh auth valid (LIVE API call, not just a cached token)
who=$(gh api user -q .login 2>/dev/null)
if [ -n "$who" ]; then ok "gh authenticated as $who"; else no "gh NOT authenticated / token invalid (run: gh auth login)"; fi

# 4) gh can read this repo's Actions
if gh run list -R relativityE/speaksharp -L 1 >/dev/null 2>&1; then ok "gh can read GitHub Actions"; else no "gh cannot read GitHub Actions"; fi

# 5) real repo .git writable
if [ -w "$REPO/.git" ] && ( : > "$REPO/.git/.selfcheck_wtest" ) 2>/dev/null; then rm -f "$REPO/.git/.selfcheck_wtest"; ok ".git writable ($REPO)"; else no ".git NOT writable ($REPO)"; fi

# 6) Playwright Chromium can launch
if [ -d "$REPO/node_modules/playwright" ]; then
  if ( cd "$REPO" && node -e "const{chromium}=require('playwright');chromium.launch({headless:true}).then(b=>b.close()).then(()=>process.exit(0)).catch(()=>process.exit(1))" ) >/dev/null 2>&1; then
    ok "Playwright Chromium launches"
  else
    no "Playwright Chromium launch BLOCKED (mach-port / Permission denied 1100?)"
  fi
else
  no "playwright not installed (pnpm install once network is back)"
fi

echo "== RESULT: $PASS pass / $FAIL fail =="
if [ "$FAIL" -eq 0 ]; then
  echo "VERDICT: ENV GREEN -> Test can resume GitHub/CI/RC-gate/STT-proof ownership. Post 'TEST resuming (env green <date>)' on the board."
  exit 0
else
  echo "VERDICT: ENV BLOCKED -> Dev keeps GitHub/CI/RC ownership. Post the FAIL line(s) + date on the board."
  exit 1
fi
