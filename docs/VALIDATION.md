# Validation

Run `node --test tests/*.test.js`. 30 checks pass.

**Data and offices**
- The CSV reader handles quoted commas, a byte-order mark and Windows line endings.
- Settings only point to measures, categories and files that exist; presets add up to 100.
- All 500 cities load with coordinates and all 18 measures.
- The five offices are Overland Park, Fishers, Frisco, Naperville and Ann Arbor; no two are within
  40 miles; Olathe is skipped. The 50–60 group waits for a `Score` column.
- Adding a `Score` column to the 50–60 file adds that group to every city's average.
- A missing group file is skipped, not fatal. `office_override` pins the office list.
- Employee answers never change which five cities are offices.

**Weights and scores**
- All three presets give 30/23/17, 40/25/15 and 50/25/15, with the rest split evenly; totals are 100.
- Feature weights follow the team's proportions (Housing 40% becomes 24% and 16%) and total 100.
- Household, home plans, trade-off, concern, what feels like home, needs, age group (when ranking)
  and recreation never change any score.
- Recreation can't take a numeric slot; ranking it gives the same weights as leaving it out.
- Every score equals the sum of its measure points, and one contribution is rebuilt by hand.
- A measure with zero weight adds zero points.
- Changing priorities changes the scores; climate targets change only the weather points.
- Each age-group baseline and the neutral profile add to 100 and carry a disclosure note.
- Every value has a source label, including estimates and inland flood zeros.
- Close calls are flagged when the top two are under 1.5 points apart.
- Four very different fictional employees get valid results; the warm-weather one gets Frisco.
- The AI evidence carries the computed ranking, scores, measure sources and limits.

**AI chat (`api/guide.js`, mocked, no paid calls)**
- GET reports only whether the chat is on and needs a code.
- A wrong access code is refused before any OpenAI call.
- A multi-turn request sends the whole conversation, the evidence, `store: false` and the model.
- The opening request is fixed on the server; client text can't replace it.
- The default model is `gpt-6-luna`; `GUIDE_PROMPT_VERSION=v1` switches to the first instructions.
- The conversation is cleaned: unknown roles dropped, long messages trimmed, last 16 kept.
- A conversation must end with a question, and evidence is required.
- Bad key, unavailable model and other OpenAI errors become plain messages.
- Both instruction versions forbid re-ranking and invented facts.

**In a browser** (Chromium, 1280 px and 390 px wide, light and dark): every step clicked through,
review, results, the strength switch reordering the list, the math tables, city popovers, The cities
and How we chose. No script errors and no sideways scrolling. With photos blocked, the drawn state
maps appear instead.

**Chat, end to end** (local dev server pointed at a stand-in for OpenAI): the full questionnaire leads
to results with the guide right under the best match; a wrong access code shows an error in the code
box; the right code starts "Reading your answers…" and the guide opens with a recommendation built from
all the answers; a suggested question and a typed follow-up (Enter) each get replies, and each request
carries the whole conversation starting with the opening request; changing the strength clears the
conversation with a note and the guide opens again with the new numbers. The terminal key prompt saves
the key to `.env.local` when asked.
