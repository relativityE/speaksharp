# Granite CTC core

Source: IBM's `ibm-granite/granite-speech-streaming-webgpu` Space,
revision `b347f5c68221aaef9cc4b6b8f85f71b8b61cc1e1`, `granite-engine.js`.
Original 65,040-byte file SHA256:
`b7b4554b881d1b74f4bfe688fd6b4cb97561cea135a6b49bf65c6d5784a417ca`.

That revision's README declares `license: apache-2.0`. Its 9,886-byte cached
README SHA256 is `62abb1564beb4643f5b720091f955d34f29eacbabd02cf409f7c13d9a603d72e`.
LICENSE contains the standard Apache License 2.0 text. No separate upstream
copyright or NOTICE file was supplied; none has been invented here.

The extraction retains frontend, tokenizer, and CTC algorithms and their comments.
SpeakSharp changes the module wrapper, replaces network/cache access with supplied
verified buffers, requires an explicit model filename/backend, rejects fallback,
rejects failed warmup on both backends, and adds session/tensor cleanup.
The demo's streaming policy, microphone capture, and UI are not included.
Comments describing upstream parity/performance refer to upstream evidence, not
SpeakSharp validation.

`assetPins.json` comes from the previously acquired manifest (22,769 bytes,
SHA256 `4e0025c895e052e0f4fca4b48093e70577f2e6f754a350306a962ad1ace36a9f`).
It records six model/frontend components and three ORT Web 1.26.0 components.
The README identifies the standard Granite Speech 5.0 470M TurboCTC model, not
the `-nc` model. The export's original checkpoint revision is not recorded.
ORT's MIT runtime code and bundled notices are not vendored in this increment.

This core performs no acquisition. `GraniteCtcEngine` uses the existing shared
asset verifier before passing buffers into its dedicated classic worker. The
worker configures ORT through the pinned source's `wasmBinary`/blob-module API,
uses one thread, and refuses backend fallback. Termination retires pending
requests and releases the worker and object URLs. It is not registered as a runnable product candidate yet. Offline tests
use synthetic assets/runtime doubles; browser execution and frontend parity are
unrun. Production defaults and qualification rules are unchanged.

The reported backend is the single execution provider requested at successful
session creation/warmup, not per-operator backend introspection. No loaded-model
identity is invented. Facade/descriptor registration and persistence attribution
remain separate unfinished integration work. The worker/module/blob loading
must be tested in the actual built application before claiming browser readiness.
# Shared selection contract

`granite:turboctc-q4f16` selects this adapter through PrivateSTT in both the app and
the model-only browser evaluator. It is not activation-ready or approved for the
production comparison. Its nine-file inventory includes the six model/frontend
files and three browser runtime files (339,374,194 bytes). The aggregate is
SHA-256 over path-sorted `path:sha256\n` entries:
`3d20c877a2764c504ed79c38598579f47cdb1f57b004af4b76ee0b4af3944d62`.
This differs intentionally from the historical six-file model aggregate.

A compatible export must implement the pinned core's frontend/config, vocabulary,
CTC input/output tensor and external-data filename contracts. Model filename and
AGC selection are descriptor data; feature extraction and decoding remain adapter
code. Another architecture needs another adapter. The upstream checkpoint revision
is unknown; the descriptor separately records the exact official Space export
revision. No current upstream model revision is substituted.

Source tests verify pin flow, inventory and lifecycle with doubles. They do not
establish real browser initialization, operator backend placement, audio quality,
or persisted product attribution. Backend evidence is the requested execution
provider accepted by initialization/warmup; modelId remains null because the runtime
does not introspect loaded model identity. Server attestation policy is unchanged.
