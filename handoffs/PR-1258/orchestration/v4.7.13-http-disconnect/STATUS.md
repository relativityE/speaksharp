# Mac trial finding: client disconnect traceback

Observed by PO on2026-10-13 at v4.7.13 startup: BrokenPipeError in sendj while writing /api/live, followed by HTTP-ready message. This is a disconnected client response, not proof that the board stopped. Which local client disconnected is not independently established.

Source correction: shared JSON/HTML response helper catches only BrokenPipeError/ConnectionResetError at header/body writes; other serialization/I/O errors remain visible. Disconnected responses never authorize undo/replay of committed task callbacks. Readiness polls permit5 seconds instead of1 per HTTP response.

Regression: real TCP client reset reproduces server.handle_error on released code and passes after fix; deterministic header/body broken-pipe/reset cases pass; unrelated application/I/O failures still propagate.143 HTTP/startup/channel/event-recovery test executions passed in9.381 seconds.

Fix committed as patch against the immutable published v4.7.13 ZIP. NOT applied to PO's running Mac; next bundle can include it. Preserve the running trial and continue event/receipt testing. No LaunchAgent or new service introduced.
