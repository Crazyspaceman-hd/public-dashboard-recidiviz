# Florida OBIS data: profiling notes

Source: Florida Department of Corrections, public OBIS download
(https://www.fdc.myflorida.com/statistics-and-publications/public-records-requests-for-the-obis-database).
Tab-delimited text files, Google Drive folder dated Nov 2, 2026; latest dates in the data are 2026-11-01.
Raw files live in `fl-data/raw/` (git-ignored: they contain names and birth dates).

## Size

| File | Rows | Distinct people |
|---|---:|---:|
| Active inmates (root) | 92,409 | 92,409 |
| Active inmates, stay history | 202,566 | 92,404 |
| Released inmates since 10-1-1997 (root) | 483,844 | 483,844 |
| Released inmates, stay history | 944,294 | 483,111 |
| Current supervision (root) | 137,360 | 137,360 |

All files parse cleanly: every row has the expected number of columns, and every date is `MM/DD/YYYY`.
`DCNumber` is unique in each root file and links all tables.

## Race and ethnicity

One combined field: W, B, H (Hispanic), A (Asian or Pacific Islander), I (American Indian), U (other/unknown).

| Group | Active prison | Released since 1997 | Supervision |
|---|---:|---:|---:|
| Black | 48.5% | 41.2% | 33.7% |
| White | 45.0% | 54.2% | 58.2% |
| Hispanic | 5.8% | 4.2% | 6.8% |
| Other/unknown | 0.5% | 0.3% | 1.2% |
| American Indian | 0.1% | 0.1% | 0.1% |
| Asian/Pacific Islander | 0.04% (36 people) | 0.02% | 0.1% |

**Hispanic share differs sharply from Census (unexplained).** Census estimates Florida at about 29%
Hispanic (Vintage 2024), while only 4–7% of FDC records are coded Hispanic. FDC uses one combined
race/ethnicity field; Census asks about Hispanic origin separately. One possible explanation is that the
single field leads to Hispanic people being recorded as W or B, but that is **not verified**, and the site
makes no claim about the cause. Policy: no race-based assumptions on the site without supporting evidence.
Evidence that could settle it: FDC's own published population statistics by ethnicity, or FDC
documentation of how race/ethnicity is collected at intake.

**Small groups.** Asian (36) and American Indian (107) counts in prison are tiny. Charts must suppress or
pool small cells rather than error out (this is the Spotlight "Asian" crash, in real data).

## Data quality flags

| Issue | Count | Handling |
|---|---:|---|
| Stay admission date of 1901-01-01 (placeholder) | 1 active, 1 released | Exclude from time series |
| Supervision birth date in the future (2032) | ≥1 | Treat as missing |
| Active inmate born 2011 (age 15) | ≥1 | Plausible (tried as adult); verify, don't drop |
| Offense date in year 2997 | 1 | Typo; treat as missing |
| Projected prison release up to year 7378 | ≥1 | Sentinel or typo; projected dates aren't used for history |
| Supervision termination 9999-12-30 | some | "No end date" sentinel |
| Stay released before it began | 2 | Exclude |
| Conviction before offense date | 24 | Flag; minor |
| Released person with no stay-history rows | 733 | Can't use for stay length or recidivism |
| Release date in root not matching any stay | 17,933 (3.7%) | Investigate before building recidivism |
| Life sentence / death sentence / "to be set" | 14,817 / 221 / 1,829 active | Exclude from projected-release metrics |
| Supervision status absconder/fugitive | 22,047 (16%) | Report separately from "active" |
| In prison and on supervision at once | 2,022 | Likely another case or data lag; note |

Note: OBIS removes sealed and expunged records, so history is a slight undercount, worse for older years.

## Cleaned output 1: current prison population

Built by `fl-data/scripts/build_prison_population.py` (stdlib Python; run `python -I build_prison_population.py fl-data`).
Outputs in `fl-data/clean/` contain only counts, no identifiers.

- `incarceration_population_by_facility_by_demographics.json`: Spotlight format, 949 rows, `state_code` `US_FL`,
  snapshot `2026-10-30` (latest admission date in the active file). `facility` holds the dropdown parent ID.
- `prison_localities.json`: the 67 dropdown entries (`id`, `label`), ready for the tenant config's
  `localities.Prison.entries`.
- `facility_lookup.csv`: all 213 source locations with their parent, display label, type and population.
  Use it for hand review.
- `cleaning_report.txt`: every check and its result.

**Rules**
- Population = everyone in the active-inmate file (92,409), wherever FDC currently has them.
- Race codes: W→WHITE, B→BLACK, H→HISPANIC, A→ASIAN, I→AMERICAN_INDIAN_ALASKAN_NATIVE, U→OTHER.
  FDC's own labels are "ASIAN OR PACIFIC ISLANDER" and "AMERICAN INDIAN OR PACIFIC ISL"; chart labels should say so.
- Sex: M→MALE, F→FEMALE (no other values in the active file).
- Age at the snapshot date, in Spotlight's buckets (<25 … 70<). Ages outside 12–110 would be treated as a
  birth-date error; none were. 86 people are under 18 and are kept (juveniles can be sentenced as adults).
- No rows dropped. Checks: facilities sum to the statewide total, and every race, sex and age breakdown sums to
  its total, at every facility (0 failures).

**Facility types** (name-based; reviewed by hand)

| Type | People | Share | Locations |
|---|---:|---:|---:|
| Major institution (incl. reception centers) | 81,115 | 87.8% | 72 |
| Work camp | 6,526 | 7.1% | 25 |
| Community release / work release | 2,618 | 2.8% | 31 |
| Re-entry center | 1,747 | 1.9% | 5 |
| Other agency (federal, I.N.S., DCF, DJJ, central office) | 185 | 0.2% | 6 |
| Out of state | 147 | 0.2% | 41 |
| Florida county (likely jail or court custody) | 71 | 0.1% | 33 |

To confirm with FDC: "Largo R.P." and "Loxahatchee R.P." are typed as community release; "R.P." may mean
road prison. Reception centers (CFRC, NWFRC, RMC, SFRC, Florida Women's Reception Center) are counted as
major institutions; they could be split out.

**Facility dropdown: 213 locations grouped into 67 entries**
- Annexes, work camps and extra units roll up to the institution they are named after
  (e.g. Lowell C.I. + Lowell Annex + Lowell Work Camp → Lowell Correctional Institution). FSP West Unit → Florida State Prison.
- Re-entry centers stay separate, even when they share a town name with a prison (e.g. Everglades).
- Satellites whose main unit has no one in it (Baker Work Camp, Mayo C.I. Annex, Quincy Annex, Ft. Myers and
  Gainesville work camps) stay as their own entries rather than inventing a parent.
- Groups with no main unit are labelled "(all units)": Apalachee (East + West), DeSoto (Annex + Work Camp).
- Pooled into one entry each: the 31 community release centers, 41 out-of-state, 33 county and 6 other-agency locations.
- Display labels spell out C.I./C.F., expand reception-center acronyms (CFRC, NWFRC, RMC, SFRC) and restore names
  FDC cut at 20 characters (e.g. "Baker Re-Entry Centr"). All name-based; confirm against FDC's facility directory.
- Every check still passes: groups sum to 92,409 and every breakdown sums to its total.

**Small cells**
- 159 breakdown cells (group × one race, sex or age bucket) have fewer than 10 people, down from 734 before grouping.
  They are not suppressed, so every total adds up; the chart should combine or hide them on display.

## What Spotlight charts this supports

- Prison population by facility, custody level, race, sex, age: yes (213 facilities, 5 custody levels).
- Prison population over time: rebuildable from stay dates, but complete only from 10-1-1997.
- Length of stay: yes, from stay dates.
- Recidivism (return to FL prison within 1/3/5 years): yes, after resolving the 3.7% date mismatch.
  Benchmark against FDC's published 3-year recidivism report.
- Supervision snapshot by type (14 types), office (20 locations), status: yes; no history.
- Release reason, admission reason, supervision success, revocation type: not in OBIS.

## Full dashboard build: what is real and what is synthetic

Build order (all stdlib Python, run with `py -3.10 -I`, argument is the `fl-data` folder):
`build_prison_population.py` → `build_real_metrics.py` → `build_synthetic_metrics.py`
→ `write_tenant_content.py <repo root>`, then copy `fl-data/clean/*.json` metric files to
`spotlight-api/core/demo_data/US_FL/`. Reports: `clean/real_metrics_report.txt`,
`clean/synthetic_metrics_report.txt`.

| Page | Chart | Source |
|---|---|---|
| Prisons | Who is in prison (by facility) | Real (OBIS active inmates) |
| Prisons | Population over 20 years | Real (rebuilt from 1.14M stay records) |
| Prisons | Admission reasons | **Synthetic** split on real totals |
| Prisons | Length of stay | Real (76,539 releases, last 3 years) |
| Prisons | Recidivism, cumulative and over time | Real (return to FDC prison, cohorts 2015-2024) |
| Probation | Who is on probation (by office) | Real (124,295 people) |
| Probation | Population over time | **Synthetic** history ending at the real count |
| Probation | Success rates | **Synthetic** |
| Probation | Revocation reasons | **Synthetic** |
| Parole & Conditional Release | Who is on post-prison supervision (by office) | Real (4,665 people) |
| Parole & Conditional Release | Population over time, success rates, revocation reasons | **Synthetic** |
| Racial Disparities | State population vs. people under FDC control | Real (Census V2024 + OBIS) |
| Racial Disparities | Supervision and revocations | **Synthetic** |

Each synthetic section has `dataSource: "synthetic"` in `us_fl.ts`, which renders an
"Illustrative data" notice next to the chart, and its methodology states how it was generated.

Checks run during the build:
- Monthly population for Nov 1, 2026 is 92,391, against 92,409 people listed in custody; the
  peak was 103,217 in Nov 2010 and the low was 79,493 in Dec 2021. These match the known shape
  of Florida's prison population; not yet checked line by line against FDC's monthly reports.
- 3-year return rates are 22-28% for the 2015-2022 cohorts. FDC publishes its own 3-year
  rate; this build has not been benchmarked against it yet.
- Every demographic breakdown sums to its total in every month (0 unassigned).
- Racial disparities: FDC records 6% Hispanic against 29% of Floridians (Census). The cause of the
  gap is not established; the page states both figures and the difference in how the two sources
  collect ethnicity, without attributing the gap to either.

Census source: Vintage 2024 state estimates, `sc-est2024-alldata6.csv` (STATE=12, SEX=0,
POPESTIMATE2024), streamed and summed without saving the file. Hispanic = any race;
other groups non-Hispanic; Other = NHPI + two or more races.

## Arrest data (FDLE Criminal Justice Data Transparency) and the county example

Source: FDLE CJDT county detention arrest records, full download `CountyDetentionArrest.zip`
(person-based, adults only, no personal identifiers; charge-level rows linked by `MDM_PERSON_ID`;
race and ethnicity in separate fields). Builder: `fl-data/scripts/build_arrest_comparison.py`;
report: `fl-data/clean/arrest_comparison_report.txt`.

- Coverage grows each year (counties appearing: 30 in 2021, 51 in 2023, 61 in 2024, 67 in 2025),
  but most 2025 submissions are not usable to count people by race and ethnicity:
  21 counties send no person identifier (and no age), others leave race or ethnicity blank
  (e.g. Duval and Pinellas 100%), and some report almost nothing (e.g. Polk).
- Completeness rule (2025): person identifier on 90%+ of records, at least 5 people booked per
  1,000 adults (a natural break: usable counties are all 10+, the next is 4.2), race/ethnicity
  missing for at most 10% of people. 14 of 67 counties pass (44.9% of Florida adults), so a
  statewide arrest comparison is not published.
- Ethnicity field use varies even among passing counties: Lake and Walton record 0.0% of people
  booked as Hispanic, Broward 4.2% and St. Lucie 5.8%, against 20-34% of their adults. Whether the
  field is informative there cannot be told from this data; no claim is made about it.
- The site shows one county as an example of what complete data allows: **Hillsborough**
  (1.6M people; 33,528 adults booked in 2025; race/ethnicity unknown for 0.5%; ethnicity field in
  use). Four bars, adults 18+: Census population (ages 18-19 approximated as 2/5 of the 15-19
  band), people booked in 2025, people found guilty in Hillsborough courts in 2025 (see below),
  people under FDC control whose most recent offense was convicted in Hillsborough. FDC records
  race and ethnicity in one field; the other three sources separately.

## Court data (FDLE CJDT Clerk of Court cases)

Source: FDLE CJDT Clerk of Court case records, full download `CjdtClerkCase.zip` (4.5M charge rows,
adults, dispositions 1985-2026; `MDM_PERSON_ID` blank on 0.8%; race and ethnicity separate).

- **Court bar for Hillsborough**: charges closed in 2025 as Adjudicated Guilty or Adjudication
  Withheld (single-letter codes G/W included), age 18+, each person counted once: 18,897 people,
  487 with unknown race/ethnicity left out. Shares (Black / White / Hispanic): 38.3 / 46.2 / 14.5%,
  vs. 40.3 / 32.9 / 25.7% booked. Counting every closed case instead gives nearly the same shares.
- The bars are separate snapshots, not one cohort: cases closed in 2025 include earlier arrests.
- Recorded Hispanic share falls at each source (Census 30%, booked 26%, court 14%, FDC 9%), while
  White + Hispanic combined is roughly level from booking (58.6%) to court (60.7%). The data does
  not show why; the page states the difference without explaining it.
- **Person-level linkage, bookings -> court** (by `MDM_PERSON_ID`; charge IDs never match between
  the two files): statewide, 43% of people booked in 2025 have a court record and 34% have a charge
  closed on or after their first 2025 booking. **Hillsborough links to almost none (14 of 33,535
  people)**, though its clerk reported 48,244 dispositions in 2025, so its jail records appear not
  to carry the statewide person ID. Counties that link well (60%+ of booked people with a court
  record) include Volusia, Palm Beach, Lake, Pinellas, Pasco, Bay, Collier, Manatee, St. Lucie and
  Leon; of those, only Collier, Manatee and St. Lucie also pass the race/ethnicity completeness
  rule with an ethnicity field in use (Lake records 0.0% Hispanic). A per-booking outcome rate by
  race is possible there, but not published: many 2025 cases are still open.
