#!/usr/bin/env bash
# Relaunch pi until a mission's verifier passes. The agent cannot relaunch itself; this is the outer loop.
#   bash templates/prompts/run-until-done.sh math        # or: producer
# Run it in WSL (a normal interactive terminal), from anywhere. Stop it with `touch STOP` in the repo root
# (checked between runs). Knobs: MAX_RUNS (default 40 relaunches), PI_CMD (default pi).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1

case "${1:-}" in
  math) PROMPT=templates/prompts/math-video-engine.md; VERIFY=verify-math; DOCS=docs/math; SID=math-video-engine ;;
  producer) PROMPT=templates/prompts/producer.md; VERIFY=verify-produce; DOCS=docs/produce; SID=producer ;;
  *) echo "usage: bash templates/prompts/run-until-done.sh math|producer" >&2; exit 2 ;;
esac
PI_CMD=${PI_CMD:-pi}; MAX_RUNS=${MAX_RUNS:-40}
command -v "${PI_CMD%% *}" >/dev/null || { echo "${PI_CMD%% *} not found: use a login shell (bash -lic) or fix PATH" >&2; exit 1; }
STATE="$HOME/.cache/pi-motion-studio"; mkdir -p "$STATE"; STARTED="$STATE/mission-$1.started"
MSG="Read $DOCS/PROGRESS.md and $PROMPT, then continue from the first unchecked item. Do not stop until ./studio $VERIFY exits 0 and $DOCS/verify-last.json says \"pass\": true."

# Done = the verifier ran, exited 0, and wrote a fresh result file that says pass. An unknown command prints
# help and exits non-zero, and a stale file never counts.
done_yet() {
  local mark ok; mark=$(mktemp)
  ./studio "$VERIFY" >/dev/null 2>&1; local rc=$?
  [ $rc -eq 0 ] && [ "$DOCS/verify-last.json" -nt "$mark" ] && grep -q '"pass": true' "$DOCS/verify-last.json"
  ok=$?; rm -f "$mark"; return $ok
}

quick=0
for ((n = 1; n <= MAX_RUNS; n++)); do
  [ -f STOP ] && { echo "STOP file found: stopping."; exit 0; }
  t0=$SECONDS
  if [ ! -f "$STARTED" ]; then
    echo "[$(date +%T)] run $n: starting the mission ($SID)"
    $PI_CMD -p --session-id "$SID" @"$PROMPT" "Execute the attached mission end to end. $MSG"
    touch "$STARTED"
  else
    echo "[$(date +%T)] run $n: relaunching ($SID)"
    $PI_CMD -p --session-id "$SID" "$MSG"
  fi
  if (( SECONDS - t0 < 30 )); then quick=$((quick + 1)); else quick=0; fi
  if (( quick >= 3 )); then echo "pi exited in under 30 s three times in a row: something is wrong (login? model?). Stopping." >&2; exit 1; fi
  echo "[$(date +%T)] checking ./studio $VERIFY (a full run can take up to an hour)"
  if done_yet; then echo "DONE: $VERIFY passes."; exit 0; fi
  sleep 5
done
echo "reached MAX_RUNS=$MAX_RUNS without a passing verify" >&2
exit 1
