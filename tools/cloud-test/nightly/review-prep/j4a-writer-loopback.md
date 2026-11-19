# #1884: transport completion is not writer termination

Run the focused proof without sockets:

    node --test tools/cloud-test/nightly/tests/j4a-writer-evidence.test.cjs

Run this separate regression only on a local executor that already permits
ephemeral IPv4 loopback sockets:

    node --test tools/cloud-test/tests/node/manual/j4a-writer-loopback.cjs

The test owns its only server, binds explicitly to 127.0.0.1 on an ephemeral
port and uses no proxy, provider, product, test credentials, or hosted resource.
A synthetic POST accepts deferred work, then sends an entire HTTP 200 while
the work remains eligible to commit. The decision must be HOLD and the
trusted-parent verifier must return no stopped-writer capability. This is not
an endpoint oracle, a claim that real product endpoints behave like the fixture,
or proof of Linux containment. A bind failure is NOT RUN for the scenario.

A positive path still needs: (1) authoritative Linux owned-writer termination,
(2) actual guard drain and complete parent-owned send journal armed before any
case writer, recording exact reviewed routes and the distinction between a
verified pre-send drop and any possible upstream transmission, (3) trustworthy
endpoint-specific terminal receipt or independently bound durable readback for
each forwarded attempt, and (4) exact fresh owner/take/lease readback plus the
separately reviewed run-bound save-journal facility. Unknown outcomes are HOLD.
The tests do not wire a production producer for any of these facts or alter
production admission.
