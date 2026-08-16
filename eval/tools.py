#!/usr/bin/env python3
"""Print the ordered tool calls of a claude stream-json log (Bash commands, Write paths, Skill names)."""
import sys, json
for line in open(sys.argv[1]):
    try: ev = json.loads(line)
    except: continue
    if ev.get("type") != "assistant": continue
    for c in ev.get("message", {}).get("content", []):
        if c.get("type") == "tool_use":
            n = c["name"]; i = c.get("input", {})
            if n == "Bash": s = i.get("command", "").replace("\n", " ⏎ ")
            elif n == "Edit": s = i.get("file_path", "") + "  OLD=" + i.get("old_string", "").replace("\n", " ⏎ ")[:200]
            elif n in ("Write", "Read"): s = i.get("file_path", "")
            elif n == "Skill": s = i.get("skill", "")
            else: s = json.dumps(i)[:100]
            print(f"{n:6} {s[:600]}")
        elif c.get("type") == "text" and c["text"].strip():
            print(f"TEXT   {c['text'].strip()[:160]!r}")
