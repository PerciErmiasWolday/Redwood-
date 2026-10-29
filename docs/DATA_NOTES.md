# Data notes

## Age-group rankings (`data/groups/`)

Each file is used exactly as the teammate built it.

| Group | File | Score column | Notes |
| --- | --- | --- | --- |
| 20–30 | `age_20_30.csv` | `RankingScore` | 5 measures: average income 40, share of residents in their 20s 25, social vulnerability 15, cost of living 15, hazard risk 5. Missing cost of living (286 cities) was filled with the median (93.65). |
| 30–40 | `age_30_40.csv` | `Overall_Score` | 15 measures. County matches corrected; Census county income; FEMA hazard data; remaining gaps filled with tested multiple imputation. |
| 40–50 | `age_40_50.csv` | `weighted_score` | 15 measures; temperatures scored by distance from 40°F (January) and 75°F (July). |
| 50–60 | `age_50_60.csv` | `Score` (to be added) | Raw measures but no score column yet, so it's not in the average. Adding a `Score` column includes it automatically. |

Known quirks, left as submitted: the 20–30, 40–50 and 50–60 files use the shared city-to-county
lookup that matched 100 cities to a neighboring county; 20–30 has 12 cities with the same filler
income; 50–60 has one city with $0 income, 13 with a $300,000 placeholder median income, and blank
hurricane and coastal-flood values for 62 and 87 cities.

## Measures used for each employee's match (`settings.json` → `features`)

Every employee is scored on the same 18 measures for all 500 cities:

- 15 from the 30–40 file (corrected counties; gaps filled and labeled): cost of living, median income,
  poverty, employment, long commutes, housing costs, housing problems, violent crime, uninsured,
  poor mental health, physical inactivity, and four FEMA risk scores.
- 3 from the 40–50 file: January and July temperature, life expectancy (county values, as submitted).

`data/feature_sources.csv` records where each 30–40 value came from: measured, county value,
estimated from the county (no city value), estimated by imputation (gap filled), or inland (coastal
flood set to 0). Values from the 40–50 file are labeled "county value, as submitted". The math view
shows these labels next to every number, with estimates in a dashed badge.

## Not in the data

School quality, actual rents or home prices, job openings, nightlife, specific healthcare services,
neighborhood feel and Redwood office details. The app says so instead of scoring them. City guides in
`content/cities.json` add facts from Wikipedia, each with its source.

## Sources

CDC 500 Cities (2019); county health, climate and labor data from the JsonOfCounties collection;
FEMA National Risk Index; AdvisorSmith Cost of Living Index; Census county income (QuickFacts via
CORGIS); Kaggle U.S. household income (20–30 and 50–60); city coordinates from CDC 500 Cities.
Map outlines from U.S. Census county boundaries (plotly GeoJSON), merged into states.
