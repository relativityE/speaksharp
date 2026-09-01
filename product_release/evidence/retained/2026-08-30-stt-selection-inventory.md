**Status:** Evidence (retained) · **Class:** Inventory · **Date:** 2026-08-30
**Baseline:** `main@024b574f` · **Authority:** the mechanical inventory behind the config-driven
STT model-selection umbrella. **Not** a design document and **not** an implementation.

# STT model-selection mechanisms present on `main@024b574f`

> **HISTORICAL EVIDENCE — point-in-time inventory, NOT current release truth.**
> This is a mechanical scan of one commit, `main@024b574f`. Every path and line number below is true of
> that tree and of no other. It is **not** maintained against `main`: as soon as a selection site moves,
> this file is wrong about where it lives, and it must not be edited to look current — an inventory
> rewritten to match today's tree stops being evidence that these mechanisms were ever fragmented.
> Re-scan rather than trust it. What it is authoritative for is the *count and shape* of the problem the
> config-driven umbrella has to retire.

Selection today is **fragmented, not absent.** Anything replacing it must retire these deliberately —
each entry below was found by scanning the tree, not recalled.

## URL parameters read as selection input

| Parameter | Read at |
|---|---|
| `privateEngine` | `sttIdentity.ts:202`, `privateModelFlag.ts:112,137` |
| `privateModel` | `privateModelFlag.ts:64,84,114,141` |
| `v4Device` | `privateModelFlag.ts:67` |
| `v4Variant` | `privateModelFlag.ts:69` |

## localStorage keys read as selection input

`privateEngine` · `privateModel` · `speaksharp.private.engine`
Values observed in the same paths: `base_q4`, `distil_q4`, `default`.

## Independent mechanisms that influence which model runs

| Mechanism | File |
|---|---|
| Engine/model override resolution | `services/transcription/utils/privateModelFlag.ts` |
| v4 experiment assignment | `services/transcription/privateV4Experiment.ts` |
| v4 feature/kill flags | `services/transcription/privateV4Flags.ts` (`private_stt_v4_enabled`, `private_stt_v4_distil_enabled`) |
| Build-time veto | `VITE_PRIVATE_STT_V4_DISABLED` |
| Variant registry + rollout floor | `services/transcription/sttConstants.ts` (`PRIV_STT_V4_VARIANTS`, `PRIV_STT_V4_DEFAULT_VARIANT`) |
| Runtime path resolution | `services/transcription/utils/privateRuntimePath.ts` |
| Engine construction | `engines/PrivateSTT.ts`, `TransformersJSEngine.ts`, `TransformersJSV4Engine.ts` |
| Model download/size reporting | `services/transcription/ModelManager.ts` |
| Identity/debug mirror | `services/transcription/sttIdentity.ts` |

30 files reference at least one of these tokens (19 source, 11 test).

## Verified defect — metadata can misreport the candidate

`engines/PrivateSTT.ts:184-187`

```ts
const variant: EngineVariant = isV4 ? 'private_v4' : 'private_v2';
const model = isV4 ? PRIV_STT_V4_DEFAULT_VARIANT : 'whisper-base.en';
engineVersion: buildEngineVersion(variant, model),
```

`model` is read from the **default** variant constant, not from what actually resolved and ran.
`PRIV_STT_V4_DEFAULT_VARIANT` is `base_q4`. **A human A/B test of `base_int8` would therefore be
recorded as `base_q4`** — the evidence would name the wrong model, and no amount of careful test
procedure would catch it, because the identity is fabricated after the fact rather than observed.

This is the same class of defect as the benchmark's `productBaseline`/`executionSha` conflation
(#1304): an identity asserted from a default instead of recorded from the run.

## Not covered by this inventory

Moonshine has **no product engine**. `@moonshine-ai/moonshine-wasm` appears only in the benchmark
harness and the pin registries. A registry entry does not make it reachable from the product.

---

## CORRECTION — 2026-09-01

**Appended, not rewritten.** The original claims above are left exactly as first recorded: an inventory
edited to look correct stops being evidence of what was actually asserted. Everything below was
re-verified by scanning the same commit this document names, `main@024b574f`.

### Confirmed correct

| Claim | Verified |
|---|---|
| `privateEngine` read at `sttIdentity.ts:202` | yes |
| `privateModel` read at `privateModelFlag.ts:64` | yes |
| 30 files reference at least one token | yes (30) |
| Moonshine has no product engine at this commit | yes |
| The `PrivateSTT.getMetadata` defect (model read from the DEFAULT variant constant) | yes |

### Factually wrong, and how

The **line numbers were right and the filenames were wrong** — several distinct modules were collapsed
into `privateModelFlag.ts`:

| Original claim | Actual location at `024b574f` |
|---|---|
| `v4Device` at `privateModelFlag.ts:67` | `privateV4Experiment.ts:67` |
| `v4Variant` at `privateModelFlag.ts:69` | `privateV4Experiment.ts:69` |
| `privateEngine` at `privateModelFlag.ts:112` | `engines/PrivateSTT.ts:112` |
| "19 source, 11 test" | **18 source, 12 test** (total 30 is correct) |

This matters beyond tidiness. The inventory's stated purpose is the *count and shape* of the problem the
config plane had to retire, and a reader following it to `privateModelFlag.ts` would have found no
device or variant handling there, concluded the entry was stale, and moved on — leaving
`privateV4Experiment` unretired. The one number that would have caught the mis-attribution, the
source/test split, was also wrong in the direction that made the source surface look smaller than it was.

### Disposition of the mechanisms listed above

All of them are retired as of #1263: the URL parameters, the `speaksharp.*` storage keys and
`window.__PRIVATE_MODEL__` are gone from production source, `privateV4Experiment` is deleted, and a
repository-wide guard blocks their return. Selection is the checked-in config file, a one-way remote
safety kill that can only force `v2:base.en`, and an internal-build-only in-page switch.
