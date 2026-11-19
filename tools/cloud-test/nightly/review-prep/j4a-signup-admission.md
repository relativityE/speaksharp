# #1884 signup transport admission, offline contract only

The reviewed legacy production template does not list /auth/v1/signup.
build_plan.py adjusts existing rules and does not add one. Keep that default.
AHT-05 calls the guarded signup UI inside one parent createAccount grant, but
that only guards the click: createGo currently transmits retries and request id
to the child, not an address-bound authorization that the actual guard can
consume at the final upstream send. No current proof that one click sends one
request. There is no owner UUID to bind before signup; bind the exact parent
reservation/address and owned-case browser context instead, and confirm the
new owner independently afterwards.

This offline fixture models a private per-run parent admission (exact J4.a
AHT-05, target HTTPS origin, run binding/context, reserved address, durable
single create attempt, still-live signal) and an object-identity grant. Only
the exact POST path with a closed synthetic email/password envelope can call
the stand-in transport, once. A malformed attempted use spends the grant;
a cloned grant never works. The fixture forwards the exact validated body
snapshot, no redirects/retries, without exposing contents in output. Its
forwarded flag means the synthetic callback was invoked or possibly invoked,
not observed upstream delivery. Either success or callback throw remains
unresolved until there is independent terminal evidence.

Smallest missing positive capability: reviewed parent provenance for the full
scope inside the already recorded authoritative create callback, delivered to
the trusted guard only, not exposed as an arbitrary child IPC/CLI field.
The reviewed proxy must consume it atomically immediately before the emitter,
including race, expiry, loss and no replay/restart recovery; bind the exact
installed Supabase SDK's wire encoding/options and keep closed schema,
duplicate-key rejection and secret-free evidence. The synthetic canonical
wire shape here does not certify that SDK; inspect and independently verify
actual bytes before proposing the separately reviewed route. Terminal Auth
resolution, profile/owner confirmation and cleanup remain separate. This
fixture does not open the policy, wire final transport, or authorize a run.

    node --test tools/cloud-test/tests/node/manual/j4a-signup-admission-review.test.cjs
