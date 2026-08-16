#!/usr/bin/env bash
# eval/run.sh <claude|codex> <name> <prompt-file>
# Runs one headless agent session in a fresh scratch dir with the user's real global instructions,
# simulates the human (comment via API + Done Reviewing) whenever the agent opens `myd view --wait`,
# and writes a scored report. Usage: eval/run.sh claude plan eval/prompts/plan.txt
set -uo pipefail
AGENT="$1"; NAME="$2"; PROMPT_FILE="$(realpath "$3")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$HOME/tmp/myd-eval/$AGENT-$NAME-$(date +%H%M%S)"
mkdir -p "$WORK"; cd "$WORK"
LOG="$WORK/session.log"; SIM="$WORK/sim.log"
[ -f "$ROOT/eval/fixtures/$NAME.md" ] && cp "$ROOT/eval/fixtures/$NAME.md" "$WORK/"
PROMPT="$(sed "s|__WORK__|$WORK|g" "$PROMPT_FILE")"

# ---- human simulator: reacts to each `myd view ... --wait` seen in the log ----
(
  seen=0; port=$(python3 -c "import json;print(json.load(open('$HOME/.mydraft/server.json'))['port'])" 2>/dev/null || echo 7474)
  while true; do
    sleep 4
    n=$(python3 "$ROOT/eval/tools.py" "$LOG" 2>/dev/null | grep -cE '^Bash +.*myd view .*--wait'); n=${n:-0}
    if [ "$n" -gt "$seen" ]; then
      seen=$n; sleep 8   # give the viewer a moment
      f=$(python3 "$ROOT/eval/tools.py" "$LOG" | grep -E '^Bash +.*myd view .*--wait' | tail -1 | grep -oE 'myd view "?[^ "]+' | tail -1 | sed 's/myd view "\{0,1\}//')
      [ -f "$f" ] || f=$(ls -t "$WORK"/*.md 2>/dev/null | head -1)
      echo "$(date +%T) view #$seen detected for $f" >> "$SIM"
      port=$(python3 -c "import json;print(json.load(open('$HOME/.mydraft/server.json'))['port'])" 2>/dev/null || echo 7474)
      if [ "$seen" -eq 1 ]; then
        python3 - "$f" "$port" >> "$SIM" 2>&1 <<'PY'
import sys, json, re, urllib.request, urllib.parse
f, port = sys.argv[1], sys.argv[2]
d = json.load(urllib.request.urlopen(f"http://localhost:{port}/api/doc?path={urllib.parse.quote(f)}"))
m = re.search(r'<p data-pos="(\d+-\d+)"[^>]*>(.*?)</p>', d["html"], re.S)
if not m: print("no paragraph to annotate"); sys.exit()
text = re.sub(r"<[^>]+>", "", m.group(2)); words = text.split()
anchor = " ".join(words[:5])
body = json.dumps({"path": f, "version": d["version"], "blockPos": m.group(1), "anchorText": anchor, "prefix": "", "kind": "comment", "body": "Can you expand on this — what's the concrete risk here?", "by": "user"}).encode()
r = urllib.request.urlopen(urllib.request.Request(f"http://localhost:{port}/api/annotate", data=body, headers={"content-type": "application/json"}))
print("annotated:", r.status, anchor)
PY
        note="Left one comment inline. Otherwise good."
      else
        note="Thanks, that addresses it. Done."
      fi
      sleep 2
      curl -s -X POST "localhost:$port/api/done" -H 'content-type: application/json' -d "{\"path\":\"$f\",\"note\":\"$note\",\"by\":\"user\"}" >> "$SIM"; echo >> "$SIM"
      echo "$(date +%T) done #$seen posted" >> "$SIM"
    fi
    ap=$(cat "$WORK/agent.pid" 2>/dev/null); [ -n "$ap" ] && ! kill -0 "$ap" 2>/dev/null && break
  done
) &
SIM_PID=$!

# ---- run the agent ----

if [ "$AGENT" = claude ]; then
  timeout 600 claude -p "$PROMPT" --output-format stream-json --verbose --max-turns 40 \
    --allowedTools "Bash,Read,Write,Edit,Skill,Glob,Grep" > "$LOG" 2> "$WORK/stderr.log" &
else
  timeout 600 codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C "$WORK" "$PROMPT" > "$LOG" 2> "$WORK/stderr.log" &
fi
AGENT_PID=$!
# make AGENT_PID visible to the simulator loop (it read the exported var at fork time; re-export via file)
echo $AGENT_PID > "$WORK/agent.pid"
wait $AGENT_PID; RC=$?
kill $SIM_PID 2>/dev/null

# ---- score ----
python3 "$ROOT/eval/tools.py" "$LOG" > "$WORK/tools.txt"; grep -E '^Bash +.*myd ' "$WORK/tools.txt" | grep -oE 'myd [a-z-]+' | sort | uniq -c | sort -rn > "$WORK/myd-calls.txt"
{
  echo "agent=$AGENT test=$NAME rc=$RC work=$WORK"
  echo "--- myd calls ---"; cat "$WORK/myd-calls.txt"
  echo "--- checks ---"
  T="$WORK/tools.txt"
  chk() { if grep -qE "$2" "$T"; then echo "PASS $1"; else echo "FAIL $1"; fi; }
  nchk() { if grep -qE "$2" "$T"; then echo "FAIL $1"; else echo "PASS $1"; fi; }
  [ -f "$ROOT/eval/fixtures/$NAME.md" ] || chk  "wrote a .md file"                 '^Write +.*\.md'
  chk  "used myd view --wait"             '^Bash +.*myd view .*--wait'
  nchk "no roughdraft/rd-open"            '^Bash +.*(roughdraft open|rd-open)'
  chk  "ran myd comments after Done"      '^Bash +.*myd comments'
  chk  "replied/resolved via CLI"         '^Bash +.*myd (reply|resolve)'
  nchk "no hand-edit of the reviewed .md" '^Edit +.*\.md'
  if python3 - "$T" <<'PY'
import sys,re
L=open(sys.argv[1]).read().split("\n")
v=[i for i,l in enumerate(L) if re.search(r'^Bash +.*myd view .*--wait',l)]
a=[i for i,l in enumerate(L) if re.search(r'^Bash +.*myd (reply|resolve|set-block)',l)]
sys.exit(0 if v and a and any(x>min(a) for x in v) else 1)
PY
  then echo "PASS re-opened with --wait after handling"; else echo "FAIL re-opened with --wait after handling"; fi
  chk  "loaded skill or myd help/guide"   '^Skill +myd|^Bash +.*myd (help|guide)'
  [ "$NAME" = explainer ] && { if grep -q '```mermaid' "$WORK"/*.md 2>/dev/null; then echo "PASS mermaid fence in doc"; else echo "FAIL mermaid fence in doc"; fi; }
  echo "--- simulator ---"; cat "$SIM" 2>/dev/null
} > "$WORK/report.txt"
cat "$WORK/report.txt"
