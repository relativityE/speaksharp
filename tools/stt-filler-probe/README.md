# Private STT filler probe (offline)

Reproduces how the shipped Private speech model (`frontend/public/models/whisper-base.en`, `@xenova/transformers`, the worker's
decode options) transcribes the filler "uh" depending on where it falls in a sentence. Local only: remote model loading is
disabled, nothing is downloaded, and no product code runs. Findings and decisions live in the tracking PR, not here.

## Run (macOS; needs `say`, `ffmpeg`, Python 3, and the repository's installed dependencies)

```bash
mkdir -p /tmp/stt-probe && cd /tmp/stt-probe
<repo>/tools/stt-filler-probe/make-clips.sh          # clips/t_*.wav (filler first) and voices/<Voice>_Uh(h).wav (filler mid-sentence)
python3 -I <repo>/tools/stt-filler-probe/splice.py   # splice_A..D: the same audio moved between sentence positions
node <repo>/tools/stt-filler-probe/transcribe.mjs <repo> clips/*.wav voices/*.wav splice_*.wav
node <repo>/tools/stt-filler-probe/prompt.mjs <repo> clips/t_uh.wav clips/t_ah.wav splice_A_midUh_at_start.wav   # decoding prompts
```

`transcribe.mjs` options: `MODEL_ID` / `MODEL_DIR` to compare another locally available model, `ANTILOOP=1` for the anti-loop
decode settings. `prompt.mjs` option: `BEAMS=5` for beam search.

The splice offsets in `splice.py` were measured on the original 2026-11-11 Samantha clips (silence detection at -40 dB). Freshly
rendered clips can differ slightly; check the token boundaries before relying on the splices.
