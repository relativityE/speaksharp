# v4.7.1 UI patch 1

Restores a compact ledger panel: fixed 160-pixel contents height, internal vertical scrollbar, keyboard focus/scroll support and long-text wrapping. The heading is Pending work. No other dashboard layout or coordination logic changes.

Apply to the existing installation:

```bash
unzip -o "$HOME/Downloads/rwt-pr-handoff-v4.7.1-ui.1.zip" -d "$HOME/SW_Dev"
```

Reload the browser. No server restart or database migration is required. This archive replaces only static/index.html and package metadata/instructions; it includes no state database or server code.

Validation: existing Node UI smoke passed. Browser layout test was attempted but could not run because this environment has no Chromium executable. Confirm the panel stays 160px high with many rows and scrolls internally on the installed browser.
