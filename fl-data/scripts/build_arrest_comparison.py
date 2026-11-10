"""Before-prison comparison: Florida population, people arrested, people under FDC control.

All three are restricted to the SAME set of counties (those whose 2025 arrest reporting is
complete) and to people age 20 and older, so the bars compare like with like.

Inputs (fl-data/raw, never committed):
  census/cc-est2024-alldata-12.csv          Census Vintage 2024 county estimates (July 1, 2024)
  arrests/CountyDetentionArrest.zip         FDLE Criminal Justice Data Transparency jail bookings
  clerk_case/CjdtClerkCase.zip              FDLE CJDT Clerk of Court case dispositions (example county)
  inmate_active/, offender/                 FDC public OBIS files (current prison and supervision)

Outputs (fl-data/clean):
  arrest_comparison.json                    counts by group for each bar, plus the county list
  arrest_comparison_report.txt              every rule, exclusion and check

Usage:  python -I build_arrest_comparison.py <fl-data dir>
"""
import collections
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # sibling helpers (our own code)
from build_prison_population import RACE_MAP, parse_date, read_rows  # noqa: E402
from build_real_metrics import (  # noqa: E402
    SUPERVISION_STATUS_EXCLUDED, SUPERVISION_TYPE, age_on)

csv.field_size_limit(10**7)

ARREST_YEAR = "2025"           # first calendar year in which every county appears in the data
MIN_AGE = 18                   # adults; FDLE's arrest data contains adult records only
CENSUS_YEAR_CODE = "6"         # cc-est2024 YEAR=6 -> July 1, 2024 estimate
CENSUS_ADULT_AGEGRPS = {str(a) for a in range(5, 19)}  # AGEGRP 5 (20-24) .. 18 (85+), counted fully
# Census county ages come in 5-year bands, so ages 18-19 are approximated as two-fifths of the
# 15-19 band (AGEGRP 4), i.e. assuming people are spread evenly across those five ages.
CENSUS_PARTIAL_AGEGRP = ("4", 2 / 5)
# completeness rule for a county's 2025 arrest reporting
# people arrested per 1,000 adults: a natural break in the 2025 data (every county with usable
# data is at 10+; the next county down is at 4.2), so 5 separates partial reporters from full ones
MIN_ARRESTS_PER_1000 = 5.0
MAX_UNKNOWN_SHARE = 0.10        # race or ethnicity missing for at most 10% of people
MAX_NO_ID_SHARE = 0.10          # rows without a person identifier: people cannot be counted

# the single county shown on the site as an example of what complete data allows. Chosen from the
# counties that pass the completeness rules: large (1.6M people), race/ethnicity unknown for 0.5% of
# people booked, and an ethnicity field that is in use (25.6% recorded Hispanic). Not Broward: its
# fields are filled in for everyone, but only 4.2% of people booked are recorded as Hispanic against
# 34% of its adults, so whether that field is informative there cannot be told from this data.
EXAMPLE_COUNTY = "HILLSBOROUGH"

GROUPS = ["WHITE", "BLACK", "HISPANIC", "ASIAN", "AMERICAN_INDIAN_ALASKAN_NATIVE", "OTHER"]
ARREST_RACE = {
    "White": "WHITE",
    "Black": "BLACK",
    "Asian": "ASIAN",
    "American Indian or Native Alaskan": "AMERICAN_INDIAN_ALASKAN_NATIVE",
    "Pacific Islander": "OTHER",
}
# the clerk (court) file spells one value differently; "Unknown" and "Not Available" stay unknown
COURT_RACE = {**ARREST_RACE, "American Indian or Alaska Native": "AMERICAN_INDIAN_ALASKAN_NATIVE"}
# court outcomes counted at the court stage: a finding of guilt, with or without formal adjudication
# (Florida's "adjudication withheld"). "G"/"W" are the same outcomes coded as single letters.
COURT_GUILTY = {"Adjudicated Guilty", "Adjudication Withheld", "G", "W"}


def county_key(name):
    """'Miami-Dade County' / 'MIAMI-DADE' / 'St. Johns County' -> 'MIAMIDADE' / 'STJOHNS'."""
    name = re.sub(r"\s+COUNTY$", "", name.strip().upper())
    return re.sub(r"[^A-Z]", "", name)


def main(base):
    raw = os.path.join(base, "raw")
    out = os.path.join(base, "clean")
    report = []
    log = report.append

    # ------------------------------------------------------------------ Census
    census = collections.defaultdict(collections.Counter)  # county -> group -> people 20+
    county_label = {}
    with open(os.path.join(raw, "census", "cc-est2024-alldata-12.csv"), encoding="latin-1", newline="") as f:
        for r in csv.DictReader(f):
            if r["YEAR"] != CENSUS_YEAR_CODE:
                continue
            if r["AGEGRP"] in CENSUS_ADULT_AGEGRPS:
                weight = 1.0
            elif r["AGEGRP"] == CENSUS_PARTIAL_AGEGRP[0]:
                weight = CENSUS_PARTIAL_AGEGRP[1]
            else:
                continue
            k = county_key(r["CTYNAME"])
            county_label[k] = r["CTYNAME"]
            n = lambda *cols: weight * sum(int(r[c]) for c in cols)  # noqa: E731
            c = census[k]
            c["TOTAL"] += n("TOT_POP")
            c["HISPANIC"] += n("H_MALE", "H_FEMALE")
            c["WHITE"] += n("NHWA_MALE", "NHWA_FEMALE")
            c["BLACK"] += n("NHBA_MALE", "NHBA_FEMALE")
            c["AMERICAN_INDIAN_ALASKAN_NATIVE"] += n("NHIA_MALE", "NHIA_FEMALE")
            c["ASIAN"] += n("NHAA_MALE", "NHAA_FEMALE")
            c["OTHER"] += n("NHNA_MALE", "NHNA_FEMALE", "NHTOM_MALE", "NHTOM_FEMALE")
    for c in census.values():
        for g in list(c):
            c[g] = round(c[g])
    bad = [k for k, c in census.items() if abs(sum(c[g] for g in GROUPS) - c["TOTAL"]) > len(GROUPS)]
    log(f"Census: {len(census)} counties, age {MIN_AGE}+ population {sum(c['TOTAL'] for c in census.values()):,}"
        f"; groups sum to total (within rounding) in every county: {'yes' if not bad else bad}")

    # ----------------------------------------------------------------- arrests
    latest = {}  # person -> (date, county, group or None)
    no_id_rows = collections.defaultdict(lambda: [0, 0])  # county -> [rows without person id, rows]
    issues = collections.Counter()
    z = zipfile.ZipFile(os.path.join(raw, "arrests", "CountyDetentionArrest.zip"))
    for name in sorted(z.namelist()):
        with z.open(name) as f:
            reader = csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))
            h = next(reader)
            iP, iBD, iAD, iAge, iR, iE, iC = (
                h.index("MDM_PERSON_ID"), h.index("BOOKING_DATE"), h.index("ARREST_DATE"),
                h.index("AGE"), h.index("RACE"), h.index("ETHNICITY"), h.index("COUNTY_DESCRIPTION_FULL"))
            for row in reader:
                d = row[iBD][:10] or row[iAD][:10]
                if not d.startswith(ARREST_YEAR):
                    continue
                try:
                    age = int(float(row[iAge]))
                except ValueError:
                    age = None  # several counties never report age; records are adults by definition
                    issues["charge rows with no age (kept: the dataset is adults only)"] += 1
                if age is not None and age < MIN_AGE:
                    issues["charge rows with age under 18 (excluded)"] += 1
                    continue
                if row[iE] == "Hispanic or Latino":
                    group = "HISPANIC"
                elif row[iE] == "Not Hispanic or Latino":
                    group = ARREST_RACE.get(row[iR])
                else:
                    group = None
                no_id_rows[county_key(row[iC])][1] += 1
                p = row[iP].strip()
                if not p:
                    no_id_rows[county_key(row[iC])][0] += 1
                    continue
                if p not in latest or d >= latest[p][0]:
                    latest[p] = (d, county_key(row[iC]), group)
    for k, v in sorted(issues.items()):
        log(f"  {k}: {v:,}")
    arrests = collections.defaultdict(collections.Counter)  # county -> group/UNKNOWN -> people
    for d, k, g in latest.values():
        arrests[k][g or "UNKNOWN"] += 1
        arrests[k]["TOTAL"] += 1
    log(f"Arrests {ARREST_YEAR}, age {MIN_AGE}+: {len(latest):,} people (each counted once, in the county"
        f" of their latest {ARREST_YEAR} booking)")

    # ------------------------------------------------- which counties are complete
    rates = {k: arrests[k]["TOTAL"] / census[k]["TOTAL"] for k in census}
    log("People arrested per 1,000 adults, and share with unknown race/ethnicity, by county:")
    for k in sorted(census, key=lambda k: -rates[k]):
        a = arrests.get(k, collections.Counter())
        log(f"  {county_label[k]:<22} {rates[k] * 1000:6.1f}   unknown {a['UNKNOWN'] / a['TOTAL'] if a['TOTAL'] else 1:6.1%}")
    complete, excluded = [], []
    for k in sorted(census, key=lambda k: county_label[k]):
        a = arrests.get(k, collections.Counter())
        unknown = a["UNKNOWN"] / a["TOTAL"] if a["TOTAL"] else 1.0
        reasons = []
        no_id, rows_k = no_id_rows.get(k, [0, 0])
        if rows_k and no_id / rows_k > MAX_NO_ID_SHARE:
            reasons.append(f"no person identifier on {no_id / rows_k:.0%} of records")
        elif rates[k] * 1000 < MIN_ARRESTS_PER_1000:
            reasons.append(f"incomplete reporting ({rates[k] * 1000:.1f} people per 1,000 adults)")
        if unknown > MAX_UNKNOWN_SHARE:
            reasons.append(f"race/ethnicity unknown for {unknown:.0%}")
        (excluded if reasons else complete).append((k, reasons))
    log(f"Complete counties: {len(complete)} of {len(census)} (rules: person identifier on at least"
        f" {1 - MAX_NO_ID_SHARE:.0%} of records, at least {MIN_ARRESTS_PER_1000:g} people arrested per 1,000"
        f" adults, and race/ethnicity unknown for at most {MAX_UNKNOWN_SHARE:.0%} of people)")
    for k, reasons in excluded:
        log(f"  excluded {county_label[k]}: {'; '.join(reasons)}")
    keep = {k for k, _ in complete}
    share_pop = sum(census[k]["TOTAL"] for k in keep) / sum(c["TOTAL"] for c in census.values())
    log(f"Complete counties hold {share_pop:.1%} of Florida's age {MIN_AGE}+ population")

    # ------------------------------------------------------------- FDC control
    snapshot = None
    people = {}  # DCNumber -> (group, born)
    for r in read_rows(os.path.join(raw, "inmate_active", "INMATE_ACTIVE_ROOT.txt")):
        people[r["DCNumber"]] = (RACE_MAP.get(r["Race"]), parse_date(r["BirthDate"]))
        d = parse_date(r.get("ReceiptDate", ""))
        snapshot = max(snapshot or d, d) if d else snapshot
    for r in read_rows(os.path.join(raw, "offender", "OFFENDER_ROOT.txt")):
        if SUPERVISION_TYPE.get(r["supvtype_description"]) is None:
            continue
        if r["supvstatus_description"] in SUPERVISION_STATUS_EXCLUDED:
            continue
        people.setdefault(r["DCNumber"], (RACE_MAP.get(r["Race"]), parse_date(r["BirthDate"])))
    conviction = {}  # DCNumber -> (date adjudicated, county) of most recent offense
    for path in (("inmate_active", "INMATE_ACTIVE_OFFENSES_CPS.txt"), ("offender", "OFFENDER_OFFENSES_CCS.txt")):
        for r in read_rows(os.path.join(raw, *path)):
            dc = r["DCNumber"]
            if dc not in people or not r["County_of_Conviction"]:
                continue
            d = parse_date(r["DateAdjudicated"]) or dt.date(1900, 1, 1)
            if dc not in conviction or d >= conviction[dc][0]:
                conviction[dc] = (d, county_key(r["County_of_Conviction"]))
    fdc = collections.Counter()
    fdc_example = collections.Counter()
    fdc_issues = collections.Counter()
    for dc, (group, born) in people.items():
        age = age_on(born, snapshot)
        if age is None or age < MIN_AGE:
            fdc_issues["age missing or under 18 (excluded)"] += 1
            continue
        county = conviction.get(dc, (None, None))[1]
        if county is None:
            fdc_issues["no county of conviction (excluded)"] += 1
            continue
        if county == EXAMPLE_COUNTY:
            fdc_example[group or "UNKNOWN"] += 1
            fdc_example["TOTAL"] += 1
        if county not in keep:
            continue
        fdc[group or "UNKNOWN"] += 1
        fdc["TOTAL"] += 1
    log(f"FDC control on {snapshot}, age {MIN_AGE}+, convicted in a complete county: {fdc['TOTAL']:,} people"
        f" (county = county of conviction for their most recent offense)")
    for k, v in sorted(fdc_issues.items()):
        log(f"  {k}: {v:,}")

    # ------------------------------------------------- court outcomes (example county)
    # people whose case closed in the example county in ARREST_YEAR with a finding of guilt
    # (adjudicated or withheld), each counted once at their latest such disposition. These are not
    # the same people as the bookings: cases closed in a year include arrests from earlier years.
    court_latest = {}  # person -> (date, group or None)
    court_issues = collections.Counter()
    z = zipfile.ZipFile(os.path.join(raw, "clerk_case", "CjdtClerkCase.zip"))
    for name in sorted(z.namelist()):
        with z.open(name) as f:
            reader = csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))
            h = next(reader)
            iP, iC, iD, iDD, iR, iE, iAge = (
                h.index("MDM_PERSON_ID"), h.index("COUNTY_DESCRIPTION"), h.index("Disposition"),
                h.index("DISPOSITION_DATE"), h.index("Race"), h.index("Ethnicity"), h.index("AGE"))
            for row in reader:
                if county_key(row[iC]) != EXAMPLE_COUNTY or not row[iDD].startswith(ARREST_YEAR):
                    continue
                if row[iD] not in COURT_GUILTY:
                    court_issues["charges closed without a finding of guilt (excluded)"] += 1
                    continue
                try:
                    age = int(float(row[iAge]))
                except ValueError:
                    age = None
                    court_issues["charges with no age (kept)"] += 1
                if age is not None and age < MIN_AGE:
                    court_issues["charges with age under 18 (excluded)"] += 1
                    continue
                p = row[iP].strip()
                if not p:
                    court_issues["charges with no person identifier (excluded)"] += 1
                    continue
                if row[iE] == "Hispanic or Latino":
                    group = "HISPANIC"
                elif row[iE] == "Not Hispanic or Latino":
                    group = COURT_RACE.get(row[iR])
                else:
                    group = None
                d = row[iDD][:10]
                if p not in court_latest or d >= court_latest[p][0]:
                    court_latest[p] = (d, group)
    court_example = collections.Counter()
    for d, g in court_latest.values():
        court_example[g or "UNKNOWN"] += 1
        court_example["TOTAL"] += 1
    log(f"Court, {county_label[EXAMPLE_COUNTY]}, cases closed in {ARREST_YEAR} with a finding of guilt"
        f" (adjudicated or withheld), age {MIN_AGE}+: {court_example['TOTAL']:,} people")
    for k, v in sorted(court_issues.items()):
        log(f"  {k}: {v:,}")

    # ----------------------------------------------------------------- output
    pop = collections.Counter()
    arr = collections.Counter()
    for k in keep:
        pop.update(census[k])
        arr.update(arrests[k])
    result = {
        "arrest_year": ARREST_YEAR,
        "min_age": MIN_AGE,
        "census_estimate": "2024-07-01",
        "fdc_snapshot": snapshot.isoformat(),
        "counties": [county_label[k] for k in sorted(keep, key=lambda k: county_label[k])],
        "excluded_counties": {county_label[k]: reasons for k, reasons in excluded},
        "share_of_state_population": share_pop,
        "population": {g: pop[g] for g in GROUPS + ["TOTAL"]},
        "arrested": {g: arr[g] for g in GROUPS + ["UNKNOWN", "TOTAL"]},
        "under_fdc_control": {g: fdc[g] for g in GROUPS + ["UNKNOWN", "TOTAL"]},
        "example_county": {
            "name": county_label[EXAMPLE_COUNTY],
            "population": {g: census[EXAMPLE_COUNTY][g] for g in GROUPS + ["TOTAL"]},
            "arrested": {g: arrests[EXAMPLE_COUNTY][g] for g in GROUPS + ["UNKNOWN", "TOTAL"]},
            "found_guilty": {g: court_example[g] for g in GROUPS + ["UNKNOWN", "TOTAL"]},
            "under_fdc_control": {g: fdc_example[g] for g in GROUPS + ["UNKNOWN", "TOTAL"]},
        },
    }
    assert EXAMPLE_COUNTY in keep, "example county must pass the completeness rules"
    with open(os.path.join(out, "arrest_comparison.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    log("Shares in complete counties (population | arrested, known race/ethnicity | FDC control):")
    arr_known = arr["TOTAL"] - arr["UNKNOWN"]
    fdc_known = fdc["TOTAL"] - fdc["UNKNOWN"]
    for g in GROUPS:
        log(f"  {g:<32} {pop[g] / pop['TOTAL']:6.1%} | {arr[g] / arr_known:6.1%} | {fdc[g] / fdc_known:6.1%}")
    log(f"  arrested with unknown race/ethnicity (left out of shares): {arr['UNKNOWN']:,}")
    ex = result["example_county"]
    ea, ec, ef, ep = ex["arrested"], ex["found_guilty"], ex["under_fdc_control"], ex["population"]
    log(f"Example county {ex['name']} (population | arrested {ARREST_YEAR} | guilty/withheld {ARREST_YEAR}"
        f" | FDC control), adults {MIN_AGE}+: {ep['TOTAL']:,} | {ea['TOTAL']:,} | {ec['TOTAL']:,} | {ef['TOTAL']:,}")
    for g in GROUPS:
        log(f"  {g:<32} {ep[g] / ep['TOTAL']:6.1%} | {ea[g] / (ea['TOTAL'] - ea['UNKNOWN']):6.1%} |"
            f" {ec[g] / (ec['TOTAL'] - ec['UNKNOWN']):6.1%} | {ef[g] / (ef['TOTAL'] - ef['UNKNOWN']):6.1%}")
    log(f"  unknown race/ethnicity left out: arrested {ea['UNKNOWN']:,}, court {ec['UNKNOWN']:,},"
        f" FDC {ef['UNKNOWN']:,}")
    with open(os.path.join(out, "arrest_comparison_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print("\n".join(report))


if __name__ == "__main__":
    main(sys.argv[1])
