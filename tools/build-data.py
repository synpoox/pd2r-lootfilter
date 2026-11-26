"""Export the PD2R item data the filter builder needs.

Usage: python tools/build-data.py <path to pd2-resurrected checkout>
Writes data/pd2r-items.json from files/data (the committed mod tables).
"""
import csv
import json
import re
import subprocess
import sys
from pathlib import Path

repo = Path(sys.argv[1] if len(sys.argv) > 1 else "../pd2-resurrected").resolve()
data = repo / "files" / "data"
excel = data / "global" / "excel"
out = Path(__file__).resolve().parent.parent / "data" / "pd2r-items.json"

strings = {}
for f in ("item-names.json", "item-runes.json"):
    p = data / "local" / "lng" / "strings" / f
    if p.exists():
        strings.update({r["Key"]: r["enUS"] for r in json.loads(p.read_text(encoding="utf-8-sig"))})

TYPOS = {"Saphire": "Sapphire"}


def clean(text):
    text = re.sub(r"(�|ÿ)c.", "", text or "").strip()
    return TYPOS.get(text, text)


def rows(name):
    with open(excel / name, encoding="latin-1", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))


def label(row):
    return clean(strings.get(row.get("namestr", ""), "") or row.get("name", ""))


bases = {}
for kind, table in (("weapon", "weapons.txt"), ("armor", "armor.txt")):
    for r in rows(table):
        code = r["code"].strip()
        if not code or r.get("name") in ("", "Expansion"):
            continue
        tier = {r["normcode"]: "normal", r["ubercode"]: "exceptional", r["ultracode"]: "elite"}.get(code, "normal")
        bases[code] = {"n": label(r), "t": r["type"], "tier": tier, "kind": kind,
                       "lvl": int(r["level"] or 0), "sock": int(r["gemsockets"] or 0)}

misc = {}
for r in rows("misc.txt"):
    code = r["code"].strip()
    if code and r.get("name") not in ("", "Expansion"):
        misc[code] = {"n": label(r), "t": r["type"]}

types = {r["Code"]: {"n": r["ItemType"], "p": [x for x in (r["Equiv1"], r["Equiv2"]) if x]}
         for r in rows("itemtypes.txt") if r["Code"]}


def names_by_base(table, base_col):
    found = {}
    for r in rows(table):
        name, base = clean(strings.get(r["index"], r["index"])), r[base_col].strip()
        if not name or r.get("spawnable", "1") == "0" or (base not in bases and base not in misc):
            continue
        if name not in found.setdefault(base, []):
            found[base].append(name)
    return found


commit = subprocess.run(["git", "-C", str(repo), "rev-parse", "--short", "HEAD"],
                        capture_output=True, text=True).stdout.strip()
result = {
    "source": {"repo": "synpoox/pd2-resurrected", "commit": commit},
    "bases": bases,
    "misc": misc,
    "types": types,
    "uniques": names_by_base("uniqueitems.txt", "code"),
    "sets": names_by_base("setitems.txt", "item"),
}
assert len(bases) > 300 and len(misc) > 250 and "r33" in misc, "PD2R tables look incomplete"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"wrote {out} ({len(bases)} bases, {len(misc)} misc, commit {commit})")
