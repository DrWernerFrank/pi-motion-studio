"""script.py: the narration script parser (mission M3) — script.md -> sentences.json, plus the lint.

  python script.py <film_dir>          writes <film_dir>/sentences.json, prints {ok, sentences, lint, warnings}
  python script.py <film_dir> --check  same, without writing

Grammar (one construct per line; stdlib only, so it runs under any python):

  # scene s02_meaning: What the determinant measures          (any heading level; the title is optional)
  [s02.1] A matrix moves every point of the plane. Watch the unit square {shows}as the matrix acts{applies} on it.
  [s02.2] The new area is five times the old one.

- scene order = file order; a sentence belongs to the scene header above it.
- `[<id>] <prose>`: the id is explicit (stable: editing other sentences never renumbers this one) and
  must match ^s\\d+\\.\\d+$. `{bookmark}` spans mark a moment in the prose; the spoken text is the prose
  minus the spans. A bookmark points at the word that FOLLOWS it (`at_word` = index into spoken.split()).
- other headings (`# Title`), blank lines and single-line `<!-- comments -->` are ignored; any other
  line (prose without an id, text before the first scene) is an error.

Errors carry line numbers (`script.md:7: ...`): duplicate sentence ids, an unclosed or stray brace,
a malformed id, prose without an id, a scene used by scenes/*.py (`scene_id = "..."`) that the script
never declares ("unknown scene", reported at the .py line). A script scene with no scenes/*.py file
is a warning. The lint flags raw symbols a voice would mangle in the SPOKEN text.
"""
import json, os, re, sys

ID_RE = re.compile(r"^s\d+\.\d+$")
SCENE_RE = re.compile(r"^#{1,6}\s*scene\s+([^\s:]+)\s*(?::\s*(.*))?$")
SENT_RE = re.compile(r"^\[([^\]]*)\]\s*(.*)$")
BOOK_RE = re.compile(r"^[A-Za-z0-9_\-]+$")
SCENE_ID_PY = re.compile(r"""^\s*scene_id\s*=\s*["']([^"']+)["']""")
LINT_CHARS = "\\{}^_=+<>λθπ∑≤≥×÷√∞∈≠≈"


class ScriptError(Exception):
    def __init__(self, errors):
        super().__init__("\n".join(errors))
        self.errors = errors


def split_prose(prose, where):
    """prose with {spans} -> (spoken, bookmarks[{id, at_word}]); raises ValueError on bad braces."""
    spoken, books, i = "", [], 0
    while i < len(prose):
        c = prose[i]
        if c == "{":
            j = prose.find("}", i + 1)
            if j < 0:
                raise ValueError(f"{where}: a '{{' at column {i + 1} never closes")
            name = prose[i + 1:j].strip()
            if "{" in name:
                raise ValueError(f"{where}: nested '{{' inside a bookmark at column {i + 1}")
            if not BOOK_RE.match(name):
                raise ValueError(f"{where}: bad bookmark id {{{name}}} at column {i + 1} (letters, digits, _ or -)")
            if any(b["id"] == name for b in books):
                raise ValueError(f"{where}: bookmark {{{name}}} used twice in one sentence")
            books.append({"id": name, "_pos": len(spoken)})
            i = j + 1
            continue
        if c == "}":
            raise ValueError(f"{where}: a stray '}}' at column {i + 1} (no matching '{{')")
        spoken += c
        i += 1
    # collapse the whitespace the spans leave behind; bookmark positions follow the collapse
    out, pos_map, prev_space = "", [], True
    for ch in spoken:
        pos_map.append(len(out))
        if ch.isspace():
            if not prev_space:
                out += " "
            prev_space = True
        else:
            out += ch
            prev_space = False
    pos_map.append(len(out))
    trimmed = out.rstrip()
    for b in books:
        p = min(pos_map[b.pop("_pos")], len(trimmed))
        # the word that follows the span = the count of words started before it (a span inside a
        # word therefore points at the next whole word); == len(words) when the span ends the sentence
        b["at_word"] = len(trimmed[:p].split())
    return trimmed, books


def parse_text(src, film_dir=None, name="script.md"):
    """-> (doc, warnings). Raises ScriptError with every error found (line-numbered)."""
    errors, warnings = [], []
    scenes, sentences, seen = [], [], {}
    scene = None
    for ln, raw in enumerate(src.splitlines(), 1):
        line = raw.strip()
        where = f"{name}:{ln}"
        if not line or (line.startswith("<!--") and line.endswith("-->")):
            continue
        m = SCENE_RE.match(line)
        if m:
            sid, title = m.group(1), (m.group(2) or "").strip()
            if not re.match(r"^[A-Za-z0-9_]+$", sid):
                errors.append(f"{where}: bad scene id '{sid}' (letters, digits, _)")
            if any(s["id"] == sid for s in scenes):
                errors.append(f"{where}: scene {sid} declared twice")
            scene = {"id": sid, "title": title, "line": ln}
            scenes.append(scene)
            continue
        if line.startswith("#"):
            continue  # the document title or any other heading
        m = SENT_RE.match(line)
        if not m:
            errors.append(f"{where}: prose without a sentence id (write '[s01.1] ...'): {line[:40]!r}")
            continue
        sid, prose = m.group(1).strip(), m.group(2)
        if not ID_RE.match(sid):
            errors.append(f"{where}: bad or missing sentence id '[{sid}]' (wanted s<scene>.<n>, like s02.1)")
            continue
        if sid in seen:
            errors.append(f"{where}: duplicate sentence id {sid} (first used at line {seen[sid]})")
            continue
        seen[sid] = ln
        if scene is None:
            errors.append(f"{where}: sentence {sid} comes before any '# scene <id>: <title>' header")
            continue
        try:
            spoken, books = split_prose(prose, where)
        except ValueError as e:
            errors.append(str(e))
            continue
        if not spoken:
            errors.append(f"{where}: sentence {sid} has no spoken text")
            continue
        sentences.append({"id": sid, "scene": scene["id"], "text": prose.strip(), "spoken": spoken,
                          "bookmarks": books, "line": ln})

    if film_dir and os.path.isdir(os.path.join(film_dir, "scenes")):
        declared = {s["id"] for s in scenes}
        used = set()
        for f in sorted(os.listdir(os.path.join(film_dir, "scenes"))):
            if not f.endswith(".py"):
                continue
            with open(os.path.join(film_dir, "scenes", f), encoding="utf-8") as fh:
                for pln, pl in enumerate(fh, 1):
                    m = SCENE_ID_PY.match(pl)
                    if m:
                        used.add(m.group(1))
                        if m.group(1) not in declared:
                            errors.append(f"scenes/{f}:{pln}: unknown scene {m.group(1)}: {name} has no '# scene {m.group(1)}: ...' header")
        for s in scenes:
            if s["id"] not in used:
                warnings.append(f"{name}:{s['line']}: scene {s['id']} has no scenes/*.py file (scene_id = \"{s['id']}\")")
    if errors:
        raise ScriptError(errors)
    doc = {"version": 1, "scenes": [{"id": s["id"], "title": s["title"]} for s in scenes], "sentences": sentences}
    return doc, warnings


def lint(doc):
    """Raw symbols in the spoken text a voice would mangle: [{id, char, line}]."""
    out = []
    for s in doc["sentences"]:
        for ch in LINT_CHARS:
            if ch in s["spoken"]:
                out.append({"id": s["id"], "char": ch, "line": s["line"],
                            "message": f"{s['id']} (line {s['line']}): raw '{ch}' in spoken text — say it in words"})
    return out


def to_markdown(doc):
    """sentences.json -> script.md (the GUI's edit-a-sentence path; parse(to_markdown(d)) == d up to line numbers)."""
    lines = []
    for sc in doc["scenes"]:
        lines.append(f"# scene {sc['id']}: {sc['title']}" if sc["title"] else f"# scene {sc['id']}")
        for s in doc["sentences"]:
            if s["scene"] == sc["id"]:
                lines.append(f"[{s['id']}] {s['text']}")
        lines.append("")
    return "\n".join(lines)


def dumps(doc):
    return json.dumps(doc, indent=1, ensure_ascii=False) + "\n"


def main(argv):
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    film_dir = argv[0]
    path = os.path.join(film_dir, "script.md")
    if not os.path.exists(path):
        print(json.dumps({"ok": False, "errors": [f"no script.md in {film_dir}"]}))
        return 1
    with open(path, encoding="utf-8") as f:
        src = f.read()
    try:
        doc, warnings = parse_text(src, film_dir)
    except ScriptError as e:
        print(json.dumps({"ok": False, "errors": e.errors}, ensure_ascii=False))
        return 1
    if "--check" not in argv:
        with open(os.path.join(film_dir, "sentences.json"), "w", encoding="utf-8") as f:
            f.write(dumps(doc))
    print(json.dumps({"ok": True, "sentences": len(doc["sentences"]), "scenes": len(doc["scenes"]),
                      "lint": lint(doc), "warnings": warnings}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
