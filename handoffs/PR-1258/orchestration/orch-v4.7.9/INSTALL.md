# Orch v4.7.9 installation

Run `Install_Orch.command` once, or `python3 install-orch.py`. There is no separate setup step.
The installer verifies its package, installs under ~/SW_Dev/rwt-pr-handoff-v4.7.9,
registers a user LaunchAgent, starts it, and opens http://127.0.0.1:4317/.
It restores at login and restarts after service exit. Closing the browser does not stop coordination.

The service identifies an existing owned board through its listening process and state directory,
waits for a verified idle boundary, pauses dispatch, rechecks, stops that board, imports verified private
state and artifacts, restores the original pause preferences and starts the new board. Active or
uncertain operations are retained: no forced kill, silent route replacement or task replay.
If several inactive legacy boards exist with no verified running source, migration fails closed;
the local CLI PM must resolve the source. The PO does not choose UUIDs or run repair commands.

Existing gh/Codex subscription login must be available. No API key is installed. Existing recipient
pairing and registered worker threads are retained. Already registered eligible idle Dev workers
resume automatically; active, blocked or uncertain workers require local agent readback.
This does not invent a transport for a browser chat with no wake hook. Such a chat cannot be
promised automatic wake. Use the registered Codex app-server worker path, with real authenticated
receipt/result proof, for unattended execution. No setup is delegated to the PO.

Agent-operated acceptance on the Mac: capture installed version/control issue, startup and restart,
new PR/review/CI/merge transitions, intended actor receipt and actual result, then PM continuation.
Prove an uncertain action is not replayed. Package tests are not a substitute for that host proof.

Agents receive a version notice on first startup and must ACK the installed version/launcher path. Keep watcher cursors and seen IDs across launcher updates. An older LaunchAgent must be retired at a verified idle boundary by the local coordinator/operator; the installer does not overwrite another running service. The PO is not asked to perform that reconciliation.
