"""Bundle the app into one self-contained HTML file (for previews and offline sharing).

Usage: python3 tools/build_preview.py [output.html]

The page, styles, scripts and every data file are inlined. The live site does not need this:
it loads the files from the data/ and content/ folders, so edits there show up on reload.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "preview.html"

settings = json.loads((ROOT / "data/settings.json").read_text())
data_files = ["data/settings.json", "content/questions.json", "content/cities.json", "data/us_states.json",
              "data/city_locations.csv", "data/feature_sources.csv"]
data_files += [g["file"] for g in settings["groups"].values() if (ROOT / g["file"]).exists()]

html = (ROOT / "index.html").read_text()
css = (ROOT / "styles.css").read_text()
engine = (ROOT / "js/engine.js").read_text()
app = (ROOT / "js/app.js").read_text()

blobs = []
for f in data_files:
    text = (ROOT / f).read_text(encoding="utf-8-sig")
    if "</script" in text.lower():
        raise SystemExit(f"{f} contains '</script' and can't be inlined")
    blobs.append(f'<script type="text/plain" data-path="{f}">\n{text}</script>')

html = html.replace('<link rel="stylesheet" href="styles.css">', f"<style>\n{css}\n</style>")
html = html.replace('<script src="js/engine.js"></script>', "\n".join(blobs) + f"\n<script>\n{engine}\n</script>")
html = html.replace('<script src="js/app.js"></script>', f"<script>\n{app}\n</script>")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
