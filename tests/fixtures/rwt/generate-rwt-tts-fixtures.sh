#!/usr/bin/env bash
# RWT two-product journey — SYNTHETIC (macOS TTS) speech fixtures for the automated rehearsal suites.
#
# These drive the real browser's fake microphone (Chromium --use-file-for-fake-audio-capture). They are
# SYNTHETIC: a TTS voice reading the PO's public RWT scripts. They are adequate for the product FLOW (model
# download, recording, Stop/save, coaching, Analytics/PDF, feedback, Focus Points setup and point coverage),
# but NOT for the Open Mic filler ground truth: measured locally, whisper-base.en hears every macOS voice's
# "uh" as "ah" (or drops it). The Open Mic filler row therefore needs a HUMAN recording, which must never be
# committed to this public repository.
#
# Chromium LOOPS its fake-audio file, so each fixture ends with TRAILING_SILENCE_S of silence and the suites
# stop recording inside that silence — the speech is heard exactly once.
#
# Regenerate (macOS only): bash tests/fixtures/rwt/generate-rwt-tts-fixtures.sh
# Then update the sha256 values in rwt-fixtures.manifest.json (the suites refuse a checksum mismatch).
set -euo pipefail
cd "$(dirname "$0")"
VOICE=Samantha
RATE=150
TRAILING_SILENCE_S=15

OPEN_MIC="Good morning. Today I want to explain a change to how our team schedules work. Um, deadlines live in different places, which makes updates easy to miss. Uh, I propose a shared board showing each task's owner and due date. We will pilot it with one team for two weeks. Um, each morning the board will highlight work due soon. You know, that gives us time to ask for help before a deadline passes. Uh, every Friday we will review which reminders helped. Um, success means fewer missed deadlines and less time asking for status. If the pilot works, we will invite a second team. Uh, I will share the results and ask for feedback before expanding. Um, everyone should know what comes next and who can help."

FOCUS_POINTS="Here is our plan for a better weekly handoff. First, updates get lost across scattered tools. People cannot tell which changes matter, and we sometimes discover a deadline too late. Second, a shared board assigns an owner and deadline to every task. Daily reminders show what is due soon, and teammates know who to contact for help. Third, we will pilot the board with one team for two weeks. During the pilot, the team will keep its existing process available and tell us where the board feels confusing. Fourth, we will measure missed deadlines and time spent on status requests. A Friday review will compare those measures with the team's earlier weeks. If the numbers improve and the team finds the board useful, we will invite another team."

# Dev fixture for the partial / absent states (not the PO script): point 1 and point 2 stated in full, point 3
# only touched in other words ("try it with a single group"), point 4 never mentioned.
FOCUS_POINTS_PARTIAL="Here is our plan for a better weekly handoff. First, updates get lost across scattered tools. People cannot tell which changes matter. Second, a shared board assigns an owner and deadline to every task, so teammates know who to contact for help. After that we would like to try it with a single group before anyone else uses it. Thanks for listening."

make() { # name text
  say -v "$VOICE" -r "$RATE" -o "$1.aiff" "$2"
  ffmpeg -loglevel error -y -i "$1.aiff" -af "apad=pad_dur=${TRAILING_SILENCE_S}" -ar 16000 -ac 1 -sample_fmt s16 -bitexact -map_metadata -1 "$1.wav"
  rm -f "$1.aiff"
  printf '%s  %s  speech+silence=%ss\n' "$(shasum -a 256 "$1.wav" | cut -c1-64)" "$1.wav" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1.wav")"
}
make open_mic_tts "$OPEN_MIC"
make focus_points_tts "$FOCUS_POINTS"
make focus_points_partial_tts "$FOCUS_POINTS_PARTIAL"
