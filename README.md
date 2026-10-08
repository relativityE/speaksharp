## deadlock.5 — visible task delivery and preflight recovery

- Dev deliveries show the task key, assigned branch/worktree, and whether execution stopped before invocation, reached the worker, or returned a result. A returned result is still not a task-specific ACK.
- Worktree preflight failures distinguish a missing target from a non-Git path or wrong branch and include the expected tuple.
- A failed assigned Dev delivery that never invoked Claude queues one idempotent PM recovery with the exact failure and tuple. It does not retry Dev or create a second writer; PM must repair/bootstrap the task route first.
- PM instructions now require a verified-checkout bootstrap before dispatching to a not-yet-created task worktree.
- The PM recovery is a system repair, not a writer continuation: it is exempt from the handoff-depth cap and from a parent's `auto_handoff=0`. The retry API refuses to requeue a Dev delivery that was blocked before invocation, in one guarded statement. A failure and its owed recovery are written together; a restart sweep queues any recovery that a crash left owed. A second block on the same unchanged tuple becomes a board blocker instead of another PM wake.
- A PM `next=dev` route to a tuple that cannot resolve now queues the PM recovery instead of a Dev row (the #34/#36 path). A Dev WRITE lease moves to a new worktree only after that worktree is verified on disk with the right branch.
- Every `REQUEST:` in a Dev/Browser PM/PO post becomes its own ask, including each numbered item. Asks persist independently of the coalesced GitHub queue, travel with every PM turn, and close only through a typed, evidenced `ask_dispositions` entry after the reply publishes, or through an external source-linked disposition. An overdue ask gets one recovery wake, then a board blocker.
- `review_handoffs` record the exact reviewed head, disposition and instruction. The board delivers each one with a `RECEIPT RH-…` token, and it counts as acknowledged only when the owner echoes that token.
- `refresh_reviews`: the PM instructions no longer omit it. The journal key is canonical (one refresh per PR/head/base). Concurrent requests claim by insert. Each lifecycle step is journaled and resumed after a crash without a second cycle. Ready is read back. An existing review is OBSERVED, not executed. Lifecycle completion is recorded separately from review completion, and a later exact-head Code review wakes PM once for disposition. Unsupported action kinds become named, recoverable board blockers.
- The per-PR share location (`handoffs/PR-<n>/` on the documentation branch) is visible to PM, Dev, the dashboard, packet manifests and `GET /api/handoff-location?pr=<n>`. The board names the location but never pushes to it.
- Candidate 3 (Browser PM review 6048387240):
  - A refresh's identity is semantic (PR/head/base). The source comment of every request is kept as separate provenance, so a second authorized source cannot start another cycle.
  - A restart after the Ready write landed but before the journal commit reconciles by readback, with no write.
  - An ask can be `dispatched` to a review handoff of the same turn. It stays open until the owner echoes the handoff's RECEIPT token.
  - A handoff with no receipt gets one PM recovery, then becomes a board blocker.
  - HOLD/BLOCKED/UNCONFIRMED action results hold a dependent Dev handoff (`dev_depends_on_actions`), including the board's none→dev correction for an active assignment. Independent Dev work still proceeds.
  - `GET /api/handoff-verify` reads a published packet back at an exact commit and checks every manifest hash.
- Candidate 4 (PM disposition, delivery 91): resuming an `unconfirmed` refresh now requires winning the atomic `unconfirmed→running` claim. A request that loses the claim, including to another connection or process between its read and its claim, returns RECORDED and executes nothing.

The live deadlock.4 worker rejected the #1570 assignment before Claude invocation because the new target worktree was not yet present. Its generic error did not identify the missing path, and no PM recovery delivery followed. This patch makes that failure diagnosable and recoverable while keeping the single-writer guard.

## deadlock.4 — quieter GitHub coordination

- Routine reconciliation updates the board without posting another GitHub comment. Pins, task directives, evidence, blockers and PO decisions still publish.
- Automated board-PM replies never wake PM again, including replies from older instances. Incoming Dev and PO posts remain actionable.
- Comment polling uses a durable incremental cursor. Dashboard readers share a 90-second cache; mutation guards still read fresh GitHub facts.
- GitHub rate-limit responses pause requests until reset, without replaying a write.
- The five RWT Designer feature branches can use the existing guarded PM executor. This adds no merge, deployment or Production authority.

Stop the old launcher before installing. Preserve your existing board directory and worker state. Disable redundant agent-side polling; the board owns the shared watcher. Set its polling interval to 120 seconds while the shared GitHub credential is under pressure.

Current Designer handoff: `handoffs/PR-1258/designer/65f8714ebab2-rev2/`. Read `PM_REV2_NOTES.md` first, then Rev 2. Rev 1 remains historical only.

These are local regression results, not proof that a particular Mac worker has received a live event. After installation, send one actionable message to CLI PM and verify a new task-specific worker checkpoint. Browser PM and the separate App Dev chat are not directly woken by this bundled CLI transport.

## v4.6.16 deadlock.4 — per-task file handoffs

Files are now stored inside the app, outside the SpeakSharp checkout:

`handoffs/PR-<number>/<folder>/<packet-id>/`

The message box has visible PR/task number, folder and file controls. Select the Designer ZIP or markdown files and send to PM, Dev or Both. Each send preserves original filenames in a new packet, writes a SHA-256 manifest and gives both recipients the absolute paths. ZIP contents are unpacked under `unpacked/`; traversal, symlinks and oversized packets are rejected. Prior packets are never overwritten. The returned manifest path is shown beside the delivery result.

This bundle already includes the PO's four Designer specs and current PO corrections at:

`handoffs/PR-1258/designer/5e77cf0dbf6c/`

Read `PM_OVERRIDES.md` first: Clear Delivery is the visible label; around 10 words is a coaching prompt target, never a length filter. Source documents are preserved unchanged. The corresponding published source is https://github.com/relativityE/speaksharp/tree/5e77cf0dbf6c3942ee1a4bacf2e0aaf8e6d9b358/handoffs/PR-1258/designer

Local paths are readable by the registered CLI workers on this Mac. They are not downloadable attachments for remote/browser agents. GitHub-only posts now explicitly report that distinction. An external reviewer needs a separately published copy, as supplied above; automatic public file publication is not added.

Install: stop the old launcher with Ctrl-C, then run:

```bash
unzip -o ~/Downloads/rwt-pr-handoff-v4.6.16-deadlock.4.zip -d ~/SW_Dev
cd ~/SW_Dev/rwt-pr-handoff-v4.6.16
SPEAKSHARP_REPO="$HOME/SW_Dev/Antigravity_Dev/speaksharp" bash start-rwt-handoff.sh
```

Refresh the board and confirm **4.6.16 (deadlock.4)**. The ZIP preserves existing `.agent-work`, uploads and handoff packets on extraction; it includes no credentials or private session state. Keep this app directory out of the SpeakSharp git checkout.

Verification: 184 Python tests and Node UI smoke pass. Six new tests cover immutable per-task packets, manifests, ZIP extraction, unsafe-path rejection, PM attachment delivery and truthful GitHub-only paths. CLI/GitHub calls are mocked. Installed Mac file access and external-chat wake-up remain unproven; this patch does not claim to wake App Dev or Browser PM chats.

---

## v4.6.16 deadlock.2 — local routing repair

This is a partial repair, not proof that all five actors wake automatically.

- Dev completion/results still wake CLI PM when the automatic handoff limit is reached. The notice is durable and deduplicated per parent delivery; it cannot automatically start another writer turn.
- PM writer dispatch keeps the exact selected task binding. A rejected/capped dispatch no longer marks that assignment as successfully queued.
- External App Dev desktop and Browser PM chats still have no wake transport in this bundle. GitHub publication does not wake those chats. Unattended execution requires the registered CLI workers or a separately implemented, supported external transport.

Verification: 178 Python tests pass and the Node UI smoke passes. CLI and GitHub transport tests use fixtures/mocks. No signed-in Mac end-to-end acceptance was performed here.

Install the patch (stop the old launcher first):

```bash
unzip -o ~/Downloads/rwt-pr-handoff-v4.6.16-deadlock.2.zip -d ~/SW_Dev
cd ~/SW_Dev/rwt-pr-handoff-v4.6.16
SPEAKSHARP_REPO="$HOME/SW_Dev/Antigravity_Dev/speaksharp" bash start-rwt-handoff.sh
```

Confirm **4.6.16 (deadlock.2)** on the board. The archive excludes credentials, state, uploads and sessions. It preserves the existing installation's `.agent-work` directory.

Live acceptance still needed: send a uniquely identified GitHub packet addressed to CLI PM and trace that same packet through durable queue, worker invocation, confirmed publication and the assigned worker's action result. A posted reply alone is not a pass. Repeat with two packets while PM is busy. Do not infer external-chat wake-up from either test.

---

## v4.6.16 deadlock.1 release

This build preserves the existing event-retention and publication fixes and adds:

- A timed-out **read-only Codex PM turn** keeps its original queue ID, payload and source. It retries on a fresh session after 15 seconds, then 30 seconds, at most three attempts total. Other queued packets can run during the backoff. Authentication errors and uncertain writes are not automatically replayed. Exhaustion stays visibly failed.
- A PM reply missing task/player reconciliation gets one fresh recovery turn. A second incomplete reply stays visibly unreconciled; this cannot create an endless reply loop. Unconfirmed publication blocks recovery.
- GitHub conversation ingestion covers #1258, #1304 and the selected release PR. Configure additional issues with `RWT_WATCH_ISSUES=1304,1491`. A partial read failure keeps the prior cursor instead of losing posts.
- A malformed selection request cannot silently clear the current PR. The page displays **4.6.16 (deadlock.1)** so an older same-version install is identifiable.

The board launches its bundled CLI PM and CLI Dev workers. It does **not** launch or wake the separate Browser PM or App Dev desktop chat. Those actors need a supported external transport before automatic wake-up can be claimed. GitHub publication is evidence of publication, not evidence that a recipient acted.

Upgrade: stop the old launcher with Ctrl-C, run the installation commands below with `unzip -o`, and refresh the page. The ZIP contains no database, credentials, uploads or agent sessions; extracting it preserves the existing `.agent-work` state. Confirm **deadlock.1** on the page, then correlate a new GitHub packet with a queued delivery, worker turn and published reply. Live Mac acceptance remains required.

# v4.6.16 delivery reliability update

Automation polls GitHub, preserves every new control-issue comment, queues local worker wake-ups, and publishes PM replies. It is polling (not a GitHub webhook) and does not directly control external Browser PM or App Dev chat sessions. A local CLI session must be configured/reconciled to the intended worktree before writer dispatch; an unbound session is refused.

This release fixes lost burst comments, pending payload replacement while busy, cursor advancement before durable enqueue, silent valid PM replies without a board patch, and repeated timestamp-only assignment dispatch. Valid text may publish without a board patch; actions and writer dispatch remain gated. Queue labels distinguish reply returned from a confirmed published comment. Neither is proof the recipient acted or the task completed.

Install after downloading the zip (quit the old board first):

```bash
mkdir -p ~/SW_Dev
unzip -o ~/Downloads/rwt-pr-handoff-v4.6.16.zip -d ~/SW_Dev
cd ~/SW_Dev/rwt-pr-handoff-v4.6.16
SPEAKSHARP_REPO="$HOME/SW_Dev/Antigravity_Dev/speaksharp" bash start-rwt-handoff.sh
```

The launcher retains the existing backup/state migration procedure. Confirm live version4.6.16. For a live acceptance check, post a harmless uniquely identified message addressed to CLI PM on #1258, observe the exact comment in the queue, the worker attempt/session, and its published response. Then post two messages while it is busy; both must remain in the pending payload. Do not label automatic wake-up proven until that sequence is observed on the installed machine. No Production run, merge or deployment is needed for this check.

## Local verification

151 Python tests pass, plus Node UI smoke. New regressions cover multiple comments per poll, busy queue accumulation and deduplication, immutable in-flight delivery, truthful publication labels, unchanged assignment suppression, and valid reply publication without board reconciliation. Transport and CLI calls are mocked; this receipt does not prove live Mac worker delivery or external-session wake-up.

---

## v4.6.16 unattended PM repair

CLI PM processes complete push-pin packets through automatically published reconciliation replies; Browser PM chat need not wake. Complete packets unanswered for two minutes get one extra reconciliation wake when PM is idle, no delivery is queued, and publication is not uncertain. Pause/login/errors and CI concurrency remain visible holds.

New refresh_reviews performs guarded Draft→Ready after a new-head push. Existing Codex reviews, active related CI or changed bytes prevent duplicate transitions. Merge/deploy/Production authority remains separate.

A visible health panel shows poll/wake, publication, pending packet and actual publisher error. Publication failure marks CLI PM blocked rather than silent idle. Uncertain writes are recovered by marker, never blindly repeated. This update cannot repair credentials automatically.

Verify on your installed Mac that a real new complete Dev packet receives a published CLI PM pin or precise HOLD without copying it into Browser PM chat. Tests below are fixtures, not signed-in live operation proof.

## v4.6.16 display correction

The selected agent detail panel refreshes on every dashboard poll, including status, task, blocker, next action and age. No repeated click is needed. This changes display refresh only; a WORKING state still requires runtime evidence.

# RWT Board v4.6.16

A local SpeakSharp coordination board. This update closes the GitHub-to-local-PM-to-GitHub communication loop and adds bounded PM lifecycle/CI execution. Python 3 and the standard library run the server; no pip installation is needed.

## Install, including a fresh installation

You do not need v4.6.7 or any older package. Stop a running board with Ctrl-C before installing. Keep old version folders beside this one if you want their history migrated.

```bash
mkdir -p ~/SW_Dev
unzip -o ~/Downloads/rwt-pr-handoff-v4.6.16.zip -d ~/SW_Dev
cd ~/SW_Dev/rwt-pr-handoff-v4.6.16
chmod +x start-rwt-handoff.sh
SPEAKSHARP_REPO="$HOME/SW_Dev/Antigravity_Dev/speaksharp" ./start-rwt-handoff.sh
```

Replace the SpeakSharp path with your actual git checkout. Open http://127.0.0.1:4317/. The launcher and page must both say 4.6.16. Use `RWT_PORT=4318` before the launcher if 4317 is already occupied.

For live operation, GitHub CLI (`gh`) must already be installed and signed in with access to relativityE/speaksharp. CLI PM uses an installed, signed-in Codex CLI; CLI Dev uses installed, signed-in Claude Code. Check `gh auth status`, `codex login status`, and your Claude login before sending work. The board's transport indicator distinguishes unknown authentication from verified readiness. No credentials or private checkout are included in this ZIP.

With no prior state, it creates waiting, unassigned release tasks and unknown external-agent activity. With prior state, it copies the newest modified sibling `rwt-pr-handoff-v*/.agent-work/state.db` using SQLite backup, including committed WAL changes, and copies uploads. An existing v4.6.16 database is never overwritten. Original folders remain intact. This supports the earlier sibling versions, including v4.6.10–v4.6.12, directly.

History and branch ownership survive restart. Activity must be reconciled from fresh checkpoints; preserved leases are not automatically stolen. In-flight deliveries become uncertain failures rather than replaying potential mutations. Historical Dev deliveries without a bound task cannot execute. After startup, PM must checkpoint the CLI Dev assignment before dispatch can resume.

## First-use verification

1. Confirm the version is 4.6.16 and GitHub observations show a recent time without an error.
2. Startup should automatically create a GitHub→PM reconciliation delivery. Verify its reply applies owner/task/source updates and is published to #1258. No PO copy/paste is needed. If the wake fails, inspect the watcher/outbox error rather than assuming an idle actor acknowledged it.
3. Confirm the release order is #1555 → #1558 → #1554 → #1559, skipping merged entries. On 5 October, read merged state live; the board skips verified merged core PRs and advances in the explicit order. A newly updated coaching PR cannot jump ahead.
4. Before CLI Dev work, PM must assign its own task with the correct branch and absolute worktree path. Current release PR is a display, not a Dev worktree selector. An independent navigation task must remain independent of App Dev's release work.
5. Watch an incoming Dev checkpoint wake PM, and its reply return to #1258. Watch Delivery queue move from queued to delivering to responded. Confirm the task owner/next action and source-linked REPORTED external checkpoint changed too. A replied message without task AND player updates is UNRECONCILED, not a completed handoff. A queued item is not an acknowledgment. Failed delivery shows its error and needs an explicit new handoff after fixing the cause.

For rollback, stop this board and start the previous folder. It still has its original database; later changes in 4.6.16 are not automatically copied back.

## Repairs

- Version 4.6.16 throughout the server, dashboard and launcher.
- Explicit release order and verified merged/closed reconciliation.
- Separate task-owned worktrees; frozen delivery branch/path/head validation.
- Atomic task/player updates, including new tasks and writer conflicts. Rejected patches do not dispatch.
- Restart preserves ownership while marking external activity unknown. App Dev and Browser PM are checkpoint reports, not observed local processes; reports older than 30 minutes show unknown.
- Control-issue pagination and separate CI run IDs preserve overlapping cancelled evidence. Failed/cancelled and running rows are shown together; branch protection remains authoritative.
- User message composition and command-adapter board updates repaired. PM → Dev → PM adapter replies retain delivery history.
- Transport preflight prevents silent partial “Both” delivery.
- Queue, release order and delivery status visible without opening Advanced.

The first Open Mic and Focus Points RWT use v2 and explicitly report v2, per #1258 comment 5995973085. v4 qualification follows separately through #1552. Model selection does not grant merge, deployment, activation or Production-run permission. The PM contract and five-player protocol describe exact authority boundaries and journey-based #1491 deferral.

## Verification included

```bash
python3 -m unittest -q test_server.py test_regressions.py test_reconciliation.py
bash -n start-rwt-handoff.sh
```

See TEST_RECEIPT.md for actual results and limits. Local adapter round trips use deterministic subprocess fixtures. They prove pipes, JSON parsing, queue updates and task targeting; they do not prove your Mac's signed-in Codex/Claude sessions or external-agent receipt. The first-use steps above complete that check on your machine.

## Automatic communications and bounded PM execution

The GitHub watcher was not removed. It polls #1258 and relevant PR/CI state, wakes the local CLI PM worker, and coalesces repeated queued notifications. In this release control comments wake PM independently of the review toggle. PM receives full bounded recent source packets and current board state.

Accepted reconciled PM replies are automatically posted to #1258 with a durable delivery marker. App Dev's existing watcher can read and ACK that comment ID without the PO copying messages. Published is not acknowledged: the board reports the distinction. Its own PM comments do not self-wake; a later Dev ACK/new packet does. A missing task/player patch or failed publication is visible, not a completed delivery. The outbox records uncertain writes and checks the remote marker before any repeat.

The Codex child remains read-only; no sandbox or approval restriction is removed. A separate closed host executor accepts typed proposals only for: Ready transition, Draft PR opening, failed/cancelled CI job recovery, and full ci.yml dispatch. It locks to relativityE/speaksharp, source packets authored by relativityE on #1258, exact candidate/base, RWT branch names and live concurrency. Recovery runs the repository's exact-head collector using the existing gh login. Draft-only skipped evidence cannot be repaired by pretending a report pass is full-lane proof. Duplicate completed/unconfirmed operations are journaled; no blind replay occurs.

Merge, deployment, migrations, secrets, model activation and Production RWT operations are not exposed. Their exact PO authorization and named executor requirements remain. The model may publish a bounded PM push pin referencing the accepted exact packet; it cannot grant PO authority. Another PM's existing operation must be observed, not duplicated.

The board's label says connected/bounded executor; GitHub permissions still determine whether the allowlisted action succeeds. Denied actions surface as HOLD/unconfirmed and are not permission-bypassed. This implementation is locally tested with deterministic adapters. Your Mac's signed-in gh/Codex/Claude sessions and external App Dev watcher have not been exercised here.

Keep the launcher running. This local worker continues after the browser PM chat turn ends; it does not wake or read a separate ChatGPT chat window. #1258 is the durable shared communication channel.

## Verification

```bash
python3 -m unittest -q test_server.py test_regressions.py test_reconciliation.py test_comms.py
node test_ui.js
bash -n start-rwt-handoff.sh
```

On startup the watcher wakes reconciliation automatically. Verify one incoming Dev checkpoint produces a source-linked task/player update and a posted CLI PM reply in #1258. Verify Dev's subsequent ACK produces another wake. Inspect Delivery queue and outbox status for failures; PO should not act as a message courier. Do not infer acknowledgment from a published badge.
