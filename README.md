# Redwood Relocation Guide

A web app for Redwood Financial employees. It shows the five new office cities our team chose and
ranks them for each employee from a short questionnaire, with the numbers behind every score.

- **Find your fit:** five short steps, a "Here's what matters to you" review, then results. Results show
  the best match, all five in the employee's order, why the others could still work, their dealbreaker
  checked across all five, and notes based on their other answers. Right under the result, an AI guide
  opens a conversation with its recommendation, written from all of their answers, and keeps the
  back-and-forth going. It explains the results; it can't change them.
- **The cities:** a guide to each office city with photos, facts and key numbers.

Plain HTML, CSS and JavaScript. No build step and no packages to install.

## Run it on your computer

Double-click `Start guide (Mac).command` or `Start guide (Windows).bat`, or run:

```bash
node tools/dev-server.js         # asks for the OpenAI key once, then opens http://localhost:8080
node --test tests/*.test.js      # 30 checks (or: npm test)
```

No Node? `python3 -m http.server 8080` also works, without the chat. Either way, open it through a
local server, not by double-clicking `index.html` (browsers block the data files from disk).
To turn on the chat, see `docs/DEPLOY.md`.

## Folders

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css`, `js/app.js` | The page |
| `js/engine.js` | All scoring (also used by the tests) |
| `data/settings.json` | Office rules, age-group files, categories, measures, weights, presets, climate choices |
| `data/groups/` | Each age group's ranking file, as the teammate submitted it |
| `data/city_locations.csv` | City, state, county, latitude, longitude for the 500 cities |
| `data/feature_sources.csv` | Where each value came from (measured, county value, estimated) |
| `data/us_states.json` | Map outlines (made by `tools/build_map.py`) |
| `content/questions.json` | Question wording (safe to edit) |
| `content/cities.json` | City guides and photo file names (safe to edit) |
| `api/guide.js` | The AI chat (runs on Vercel or `tools/dev-server.js`; needs the OpenAI key) |
| `api/_instructions.js` | The guide's instructions, first (`v1`) and revised (`v2`) versions |
| `tools/dev-server.js` | Runs the whole app on your computer, chat included |
| `tools/build_preview.py` | Makes a single-file copy of the app for previews |
| `docs/` | How scoring works, deployment and chat setup, AI testing worksheet, data notes, validation |

## Last-minute data changes

Everything is read from files when the page loads, so changes show up on the next reload (or the next
Vercel deploy). No code changes needed.

- **Replace an age group's ranking:** drop the new CSV into `data/groups/` with the same file name. It
  needs `City`, `State` and the score column named in `settings.json` (for example `Overall_Score`).
  If the column name changes, update `score_column` for that group.
- **Add the 50–60 scores:** add a column named `Score` to `data/groups/age_50_60.csv`. The app
  includes that group in the average automatically, and the office picks update.
- **Change the office rule:** in `settings.json`, edit `offices` (how many), `min_miles_between_offices`,
  or `exclude_cities` (for example `["Naperville, IL"]`).
- **Pin the five by hand:** set `office_override` to a list like `["Fishers, IN", "Frisco, TX", ...]`.
  The app then uses exactly those cities. Leave it as `[]` to go back to the automatic picks.
- **City guides and photos:** edit `content/cities.json`. A city without an entry still works; it shows
  its data and a drawn map in place of a photo.
- **Question wording:** edit labels and help text in `content/questions.json`. Keep the `id` values.

After a change, run the tests. One test checks the current five offices on purpose; if the five change
because of new data, update that list in `tests/engine.test.js`.

## Putting it online

See `docs/DEPLOY.md` (GitHub, then Vercel, then a Google Sites embed). Never put the OpenAI key in
GitHub; it goes in Vercel's environment variables.
