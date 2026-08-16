#!/usr/bin/env python3
"""Print the ordered tool calls of a claude stream-json log (Bash commands, Write paths, Skill names)."""
import sys, json
for line in open(sys.argv[1]):
    try: ev = json.loads(line)
    except: continue
    # --- codex exec --json ---
    if ev.get("type") in ("item.completed", "item.started"):
        it = ev.get("item", {}); t = it.get("type")
        if t == "command_execution" and ev["type"] == "item.completed" and it.get("id") in globals().setdefault("_seen", set()): continue
        if t == "command_execution" and ev["type"] == "item.started": globals().setdefault("_seen", set()).add(it.get("id"))
        if t != "command_execution" and ev["type"] == "item.started": continue
        if t == "command_execution":
            cmd = it.get("command", ""); import re as _re
            m = _re.match(r"^/bin/bash -lc '(.*)'$", cmd, _re.S); cmd = m.group(1) if m else cmd
            print(f"Bash   {cmd.replace(chr(10), ' ⏎ ')[:600]}")
        elif t == "file_change":
            for ch in it.get("changes", []): print(f"{'Write' if ch.get('kind') in ('add','create') else 'Edit':6} {ch.get('path','')}")
        elif t == "agent_message":
            print(f"TEXT   {it.get('text','').strip()[:160]!r}")
        continue
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
