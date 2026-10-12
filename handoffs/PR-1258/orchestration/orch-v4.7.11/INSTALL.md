# Orch v4.7.11 installation

Only the PO downloads and extracts this package. From its folder, run `python3 orch-setup.py`, exactly as with the last working release. `Start_Orch.command` uses that same entry point. `install-orch.py` is a compatibility alias; it registers no service.

Keep the terminal running. Browser launch waits for the v4.7.11 API to respond. Closing the browser does not stop the board; stopping this terminal does. No login background service is installed.

A completed v4.7.10 migration is selected first, retaining its latest action journal; otherwise the verified last-serving v4.7.7-candidate state is selected automatically when the new folder has no state and no explicit migration override. Its database, private pairing and packet artifacts are copied with verification; the source remains intact. Existing target state is retained. Other ambiguous migrations remain a HOLD. The inactive owned v4.7.9 LaunchAgent registration is archived to prevent its failed startup at login; a loaded or unfamiliar service is preserved and blocks takeover.

Existing GitHub and Codex subscription login are required. Recipient routes and registered workers are preserved; unsupported browser chats still have no automatic wake hook. Events and version handshakes require actual recipient ACK and result. No Dev downloads or installs this package.

Offline checks do not establish Mac readiness. Acceptance requires HTTP readiness, an actual event delivery/ACK/result and CLI PM continuation on this host. Do not claim hands-off coordination until that proof exists.
