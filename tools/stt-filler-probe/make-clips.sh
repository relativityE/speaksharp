#!/usr/bin/env bash
# Rebuild the synthetic probe clips (macOS only: uses `say`; needs ffmpeg). Output: 16 kHz mono s16 WAV, like the RWT fixtures
# (scripts/generate-rwt-tts-fixtures.sh). Writes into ./clips and ./voices under the current directory; nothing is committed.
#   clips/t_<filler>.wav       Samantha, the filler at the START of the sentence ("Uh, I propose ...")
#   voices/<Voice>_Uh(h).wav   each voice, the filler MID-sentence ("So, uh, I propose ...")
set -euo pipefail
command -v say >/dev/null || { echo "macOS 'say' is required" >&2; exit 2; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 2; }
mkdir -p clips voices
LINE="I propose a shared board showing each task's owner."
render() { # <voice> <text> <out.wav>
    local tmp; tmp="$(mktemp -t sttprobe).aiff"
    say -v "$1" -r 150 -o "$tmp" "$2"
    ffmpeg -loglevel error -y -i "$tmp" -af apad=pad_dur=1 -ar 16000 -ac 1 -c:a pcm_s16le "$3"
    rm -f "$tmp"
}
for f in Uh Uhh Uh... Ah Um Er; do
    name="t_$(echo "$f" | tr 'A-Z' 'a-z' | sed 's/\.\.\./dots/')"
    [ "$f" = "Uh..." ] && text="Uh... $LINE" || text="$f, $LINE"
    render Samantha "$text" "clips/${name}.wav"
done
for v in Alex Allison Ava Daniel Evan Fred Karen Moira Nathan Rishi Samantha Susan Tessa Tom Victoria Zoe; do
    render "$v" "So, uh, $LINE" "voices/${v}_Uh.wav"
    render "$v" "So, uhh, $LINE" "voices/${v}_Uhh.wav"
done
echo "clips and voices written; next: python3 -I splice.py, then node transcribe.mjs <repoRoot> clips/*.wav voices/*.wav splice_*.wav"
