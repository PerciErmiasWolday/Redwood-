# How the guide turns answers into a ranking

A one-page explainer for the presentation. All numbers below come from the current data files.

## Two separate decisions

1. **Which five cities get offices** is the team's decision. It's the same for every employee.
2. **Which of those five fits you** is the employee's. Their answers reorder the five; they never
   add or remove a city.

## 1. How the team picked the five offices

- Each age group ranked all 500 cities with its own measures and weights.
- A city's team score is the plain average of the age-group scores, every group counting the same.
  Today that's 20–30, 30–40 and 40–50; the 50–60 file joins automatically once it has a `Score` column.
- Going down that list, we skip any city within 40 miles of an office already picked, so each office
  is in a different metro area. Olathe, KS (#3) was skipped: it's 7 miles from Overland Park.

| Office | Team average | 20–30 | 30–40 | 40–50 |
| --- | --- | --- | --- | --- |
| Overland Park, KS | 74.61 | 68.4 | 79.7 | 75.7 |
| Fishers, IN | 72.51 | 64.3 | 81.0 | 72.2 |
| Frisco, TX | 70.68 | 74.4 | 70.2 | 67.5 |
| Naperville, IL | 70.37 | 73.5 | 70.4 | 67.2 |
| Ann Arbor, MI | 69.14 | 74.8 | 68.5 | 64.1 |

## 2. What each question does

| Question | What it does | Changes the score? |
| --- | --- | --- |
| Who's relocating with you | Picks which notes you see (schools, partner's job) | No |
| Age group (optional) | Used only if you skip ranking: your age group's research weights | Only if you skip ranking |
| Next home | Points you to the housing measures that fit your plan | No |
| **Top three priorities** | Sets the category weights | **Yes** |
| **How much the first one counts** | Picks the preset below | **Yes** |
| **Weather you'd enjoy** (asked if you rank weather) | Sets your target temperatures | **Yes, weather only** |
| Recreation and lifestyle | Not in our data as a score; shown as city facts | No |
| Hardest to compromise on | Checked across all five, with the numbers. No city is removed | No |
| Trade-off you'd make | Shows which city fits that trade-off | No |
| What feels like home | Shows matching facts from the city guides | No |
| Needed nearby | Notes on jobs, schools, healthcare, with what the data can't tell you | No |

## 3. From top three to weights

Eight categories can be measured. The employee ranks three, then chooses a strength:

| Strength | 1st | 2nd | 3rd | Other five, split evenly |
| --- | --- | --- | --- | --- |
| Balanced | 30% | 23% | 17% | 30% (6% each) |
| Strong preference | 40% | 25% | 15% | 20% (4% each) |
| Main deciding factor | 50% | 25% | 15% | 10% (2% each) |

These percentages are our design choice, not a research finding. The app checks that they add up to 100.

Inside each category, the weight is split across its measures in the same proportions our team used:

| Category | Measures (team weight) |
| --- | --- |
| Financial comfort | Cost of living (12), median household income (8), poverty rate (5) |
| Career opportunities | Employment rate (12) |
| Shorter commutes | Workers with a long solo commute (8) |
| Housing | Housing costs per year (15), severe housing problems (10) |
| Personal safety | Violent crime rate (7) |
| Health and well-being | Uninsured adults (5), poor mental health (5), physical inactivity (5), life expectancy (4) |
| Environmental safety | FEMA hazard risk (4), coastal flood (2), heat wave (1), tornado (1) |
| Weather and climate | January temperature (2), July temperature (2) |

Weights for the first seven are the 30–40 model's; life expectancy and the temperatures come from the
40–50 model.

**Example:** Strong preference with Housing first gives Housing 40%, split 24% housing costs and 16%
housing problems (15 : 10).

## 4. Scoring a city

Each measure is scored 0–100 against all 500 cities (not just the five): 100 for the best city,
0 for the worst, flipped when lower is better. Temperatures score by how close a city is to the
employee's target (or 40°F in January and 75°F in July if they didn't choose one).

City score = sum of (measure score × measure weight) ÷ 100.

**Example**, Fishers, with Housing, Financial comfort, then Personal safety at Strong preference:

| Measure | Value | Score 0–100 | Weight | Points |
| --- | --- | --- | --- | --- |
| Housing costs per year | $8,088 | 88.8 | 24% | 21.31 |
| Severe housing problems | 8.9% | 98.0 | 16% | 15.68 |
| Cost of living index | 95.0 | 87.3 | 12% | 10.47 |
| Median household income | $98,173 | 69.7 | 8% | 5.58 |
| Poverty rate | 4.2% | 100.0 | 5% | 5.00 |
| Violent crimes per 100,000 | 33 | 100.0 | 15% | 15.00 |
| Twelve other measures | | | 20% | 13.26 |
| **Total** | | | **100%** | **86.30** |

Housing costs: (26,364 − 8,088) ÷ (26,364 − 5,784) × 100 = 88.8, and 88.8 × 24 ÷ 100 = 21.31.

That employee's order: Fishers 86.3, Overland Park 83.2, Frisco 75.0, Naperville 73.6, Ann Arbor 70.5.
Someone who ranks weather, health and safety and wants warm weather gets Frisco first (77.9 to 83.9
depending on strength).

## 5. What the results show

- **Best match** with two measured reasons (its biggest contributions where it beats at least 60% of
  cities) and its trade-off (the weighted measure where it's worse than most cities and loses the
  most points).
- **Close call** when the top two are less than 1.5 points apart.
- **All five** with bars split by category, and **See the math** for every measure: value, where it
  came from (measured, county value, or estimated), score, weight and points. The points add up to the total.
- **Why the others could still work:** where each city beats the other four offices.
- If the employee ranked priorities, a switch to try the other two strengths and see if the order holds.

## 6. If the employee skips ranking

The app uses their age group's research weights, grouped into the same eight categories, and says so.
Measures with no shared equivalent are left out and the rest rescaled to 100 (for example the 20–30
model's "share of residents in their 20s"). With no age group either, all eight categories count 12.5%.

## Limits to say out loud

- A higher score means a closer match to the employee's answers, not a better city.
- Most measures are county values applied to a city; some are estimates, and each is labeled.
- No data on school quality, actual rents or home prices, job openings or neighborhood feel; the app
  says so rather than guessing.
- The AI guide explains the computed results; it can't change them.
