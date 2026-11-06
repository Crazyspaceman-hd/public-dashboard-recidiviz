"""Build the Spotlight metrics that Florida's public OBIS data can support for real.

Inputs (fl-data/raw, never committed):
  inmate_active/INMATE_ACTIVE_ROOT.txt, INMATE_ACTIVE_INCARHIST.txt
  inmate_release/INMATE_RELEASE_ROOT.txt, INMATE_RELEASE_INCARHIST.txt
  offender/OFFENDER_ROOT.txt                     (people on community supervision now)

Outputs (fl-data/clean, Spotlight JSON Lines, counts only, no identifiers):
  incarceration_population_by_month_by_demographics.json   prison population, 1st of month, 20 years
  incarceration_lengths_by_demographics.json               length of stay, releases in last 36 months
  recidivism_rates_by_cohort_by_year.json                  return to FDC prison, release cohorts 2015-2024
  supervision_population_by_district_by_demographics.json  probation / post-prison supervision now, by office
  supervision_localities.json                              office dropdown entries
  real_inputs_racial_disparities.json                      real per-race counts used by the disparities page
  real_metrics_report.txt                                  every rule, exclusion and check, with counts

Usage:  python -I build_real_metrics.py <fl-data dir>
"""
import collections
import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # sibling helpers (our own code)
from build_prison_population import (  # noqa: E402
    AGE_BUCKETS, MAX_AGE, MIN_AGE, RACE_MAP, SEX_MAP, STATE_CODE, parse_date, read_rows)

MONTHS = 240              # Spotlight's historical charts expect 20 years of months
COHORTS = range(2015, 2025)
MAX_FOLLOWUP = 10
MERGE_GAP_DAYS = 1        # a new stay starting within a day of release is the same stay
WINDOW_YEARS = 3          # "last 36 months" metrics

# Census Bureau Vintage 2024 population estimates (sc-est2024-alldata6.csv, STATE=12,
# SEX=0, POPESTIMATE2024). Hispanic is any race; other groups are non-Hispanic, to match
# FDC's single race/ethnicity code. OTHER = Native Hawaiian/Pacific Islander + two or more.
FL_POPULATION_2024 = {
    "WHITE": 11_823_687,
    "BLACK": 3_567_665,
    "HISPANIC": 6_707_753,
    "ASIAN": 757_144,
    "AMERICAN_INDIAN_ALASKAN_NATIVE": 58_490,
    "OTHER": 16_391 + 441_085,
}

# OBIS supervision types -> Spotlight supervision type. FDC's "post-prison release"
# group is shown on Spotlight's Parole page (Florida abolished parole for most crimes
# committed after 1983; conditional release replaced it).
SUPERVISION_TYPE = {
    "PROBATION FELONY": "PROBATION",
    "DRUG OFFENDER PROBATION": "PROBATION",
    "COMMUNITY CONTROL - PROB.": "PROBATION",
    "SEX OFFENDER PROBATION": "PROBATION",
    "PROBATION MISDEMEANOR": "PROBATION",
    "ADMINISTRATIVE PROBATION": "PROBATION",
    "SEX OFFENDER COMM. CONTRL": "PROBATION",
    "CONDITIONAL REL.SUPERVISN": "PAROLE",
    "PAROLE STATE": "PAROLE",
    "CONTROL RELEASE SUPERVISN": "PAROLE",
    "CONDITIONAL MEDICAL REL.": "PAROLE",
    "COMMUNITY CONTROL - PAROL": "PAROLE",
    "ADMIN. CONTROL RELEASE": "PAROLE",
}
# Still on FDC's rolls but not supervised in Florida
SUPERVISION_STATUS_EXCLUDED = {"DEPORTED", "MOVED TO OTHER STATE"}
NOT_AN_OFFICE = {"", "INTERSTATE COMPACT"}

STAY_BUCKETS = [(0, 1, "years_0_1"), (1, 2, "years_1_2"), (2, 3, "years_2_3"),
                (3, 5, "years_3_5"), (5, 10, "years_5_10"), (10, 20, "years_10_20"),
                (20, 1000, "years_20_plus")]


def add_years(d, n):
    try:
        return d.replace(year=d.year + n)
    except ValueError:  # Feb 29
        return d.replace(year=d.year + n, day=28)


def month_index(d, first):
    return (d.year - first.year) * 12 + d.month - first.month


def first_of_next_month(d):
    return dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def bucket_of(age):
    for lo, hi, label in AGE_BUCKETS:
        if lo <= age < hi:
            return label
    return None


def age_on(born, d):
    if born is None:
        return None
    a = d.year - born.year - ((d.month, d.day) < (born.month, born.day))
    return a if MIN_AGE <= a <= MAX_AGE else None


def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def demo_row(extra_first, dim=None, val=None, extra_last=None):
    row = {"state_code": STATE_CODE, "gender": "ALL", "age_bucket": "ALL",
           "race_or_ethnicity": "ALL"}
    row.update(extra_first or {})
    if dim:
        row[dim] = val
    row.update(extra_last or {})
    return row


def office_id(name):
    return re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")


def office_label(name):
    label = name.title().replace("Ft. ", "Fort ")
    return label


def main(base):
    raw = os.path.join(base, "raw")
    out = os.path.join(base, "clean")
    os.makedirs(out, exist_ok=True)
    report = []
    log = report.append

    # ---------------------------------------------------------------- people
    people = {}  # DCNumber -> (race, sex, born, deceased_flag)
    issues = collections.Counter()
    for kind in ("active", "release"):
        for r in read_rows(os.path.join(raw, f"inmate_{kind}", f"INMATE_{kind.upper()}_ROOT.txt")):
            born = parse_date(r["BirthDate"])
            people[r["DCNumber"]] = (RACE_MAP.get(r["Race"]), SEX_MAP.get(r["Sex"]), born,
                                     kind == "release" and r.get("releasedateflag_descr") == "deceased",
                                     kind == "active")
    active_ids = {k for k, v in people.items() if v[4]}
    log(f"People in prison roots: {len(people):,} ({len(active_ids):,} in custody now)")

    # ----------------------------------------------------------------- stays
    stays = collections.defaultdict(list)
    as_of = None
    for kind in ("active", "release"):
        for r in read_rows(os.path.join(raw, f"inmate_{kind}", f"INMATE_{kind.upper()}_INCARHIST.txt")):
            start, end = parse_date(r["ReceiptDate"]), parse_date(r["ReleaseDate"])
            if start is None or start.year < 1920:
                issues["stay: admission date missing or placeholder (excluded)"] += 1
                continue
            if kind == "release" and end is None:
                issues["stay: released person with open stay (excluded)"] += 1
                continue
            if end is not None and end < start:
                issues["stay: released before admitted (excluded)"] += 1
                continue
            if r["DCNumber"] not in people:
                issues["stay: person not in root file (excluded)"] += 1
                continue
            stays[r["DCNumber"]].append([start, end])
            if kind == "active":
                as_of = max(as_of or start, start)
    log(f"Snapshot date (latest admission recorded): {as_of}")

    merged = 0
    for dc, lst in stays.items():
        lst.sort(key=lambda s: s[0])
        out_l = [lst[0]]
        for s in lst[1:]:
            cur = out_l[-1]
            if cur[1] is None or s[0] <= cur[1] + dt.timedelta(days=MERGE_GAP_DAYS):
                if cur[1] is not None and (s[1] is None or s[1] > cur[1]):
                    cur[1] = s[1]
                merged += 1
            else:
                out_l.append(s)
        stays[dc] = out_l
    log(f"Stays kept: {sum(len(v) for v in stays.values()):,} after merging {merged:,} "
        f"back-to-back or overlapping stay rows (gap <= {MERGE_GAP_DAYS} day)")
    for k, v in sorted(issues.items()):
        log(f"  {k}: {v:,}")

    # ------------------------------------------- 1. population on 1st of month
    last_month = dt.date(as_of.year, as_of.month, 1)
    if as_of.day > 1:
        last_month = first_of_next_month(as_of)  # data runs into this month (e.g. Nov 1)
    first_month = dt.date(last_month.year - MONTHS // 12, last_month.month, 1)
    first_month = first_of_next_month(first_month)
    months = []
    m = first_month
    while m <= last_month:
        months.append(m)
        m = first_of_next_month(m)
    assert len(months) == MONTHS, len(months)
    diff = collections.defaultdict(lambda: [0] * (MONTHS + 1))

    def add_span(key, start, end):  # in custody on the 1st of months in [start, end)
        i = max(0, month_index(first_of_next_month(start - dt.timedelta(days=1)), first_month))
        j = MONTHS if end is None else min(MONTHS, month_index(first_of_next_month(end - dt.timedelta(days=1)), first_month))
        if i < j:
            diff[key][i] += 1
            diff[key][j] -= 1

    for dc, lst in stays.items():
        race, sex, born, _, _ = people[dc]
        for start, end in lst:
            add_span(("total", "ALL"), start, end)
            if race:
                add_span(("race_or_ethnicity", race), start, end)
            if sex:
                add_span(("gender", sex), start, end)
            if born:  # split the stay at each birthday that changes the age bucket
                seg_start = start
                for lo, _, _ in AGE_BUCKETS[1:]:
                    edge = add_years(born, lo)
                    if seg_start < edge and (end is None or edge < end):
                        b = bucket_of(age_on(born, seg_start) or -1)
                        if b:
                            add_span(("age_bucket", b), seg_start, edge)
                        seg_start = edge
                b = bucket_of(age_on(born, seg_start) or -1)
                if b:
                    add_span(("age_bucket", b), seg_start, end)
    pop_rows = []
    series = {}
    for key, d in diff.items():
        run, vals = 0, []
        for i in range(MONTHS):
            run += d[i]
            vals.append(run)
        series[key] = vals
    for i, mdate in enumerate(months):
        for (dim, val) in sorted(series):
            n = series[(dim, val)][i]
            pop_rows.append(demo_row({}, None if dim == "total" else dim, val,
                                     {"population_date": mdate.isoformat(), "population_count": str(n)}))
    write_jsonl(os.path.join(out, "incarceration_population_by_month_by_demographics.json"), pop_rows)
    tot = series[("total", "ALL")]
    log(f"Monthly population: {months[0]} to {months[-1]} ({MONTHS} months), "
        f"{len(pop_rows):,} rows")
    for i in (0, 36, 60, 120, 180, MONTHS - 13, MONTHS - 1):
        log(f"  {months[i]}: {tot[i]:,}")
    log(f"  check: last month {tot[-1]:,} vs people in custody now {len(active_ids):,}")
    for dim in ("race_or_ethnicity", "gender", "age_bucket"):
        worst = max(tot[i] - sum(v[i] for (d_, _), v in series.items() if d_ == dim)
                    for i in range(MONTHS))
        log(f"  {dim}: most people unassigned in any month {worst:,}")

    # ------------------------------ releases (exclude a deceased person's final stay)
    releases = []  # (dc, release_date, length_days, next_admission or None)
    deaths = 0
    for dc, lst in stays.items():
        deceased = people[dc][3]
        for k, (start, end) in enumerate(lst):
            if end is None:
                continue
            if deceased and k == len(lst) - 1:
                deaths += 1
                continue
            nxt = lst[k + 1][0] if k + 1 < len(lst) else None
            releases.append((dc, end, (end - start).days, nxt))
    log(f"Releases: {len(releases):,} (excluded {deaths:,} final stays ending in death)")

    def dims_for(dc, on):
        race, sex, born, _, _ = people[dc]
        b = bucket_of(age_on(born, on) or -1)
        out_d = [(None, None)]
        if race:
            out_d.append(("race_or_ethnicity", race))
        if sex:
            out_d.append(("gender", sex))
        if b:
            out_d.append(("age_bucket", b))
        return out_d

    # ---------------------------------------------------- 2. length of stay
    window_start = add_years(as_of, -WINDOW_YEARS)
    stay_counts = collections.defaultdict(collections.Counter)
    for dc, end, days, _ in releases:
        if window_start < end <= as_of:
            years = days / 365.25
            label = next(lbl for lo, hi, lbl in STAY_BUCKETS if lo <= years < hi)
            for key in dims_for(dc, end):
                stay_counts[key][label] += 1
                stay_counts[key]["total_release_count"] += 1
    stay_rows = []
    for key in sorted(stay_counts, key=lambda k: (k[0] or "", k[1] or "")):
        c = stay_counts[key]
        vals = {"total_release_count": str(c["total_release_count"])}
        vals.update({lbl: str(c[lbl]) for _, _, lbl in STAY_BUCKETS})
        stay_rows.append(demo_row({}, key[0], key[1], vals))
    write_jsonl(os.path.join(out, "incarceration_lengths_by_demographics.json"), stay_rows)
    allc = stay_counts[(None, None)]
    log(f"Length of stay: releases {window_start} to {as_of}: {allc['total_release_count']:,}")
    log("  " + ", ".join(f"{lbl} {allc[lbl] / allc['total_release_count']:.1%}" for _, _, lbl in STAY_BUCKETS))

    # ------------------------------------------------------- 3. recidivism
    rec = collections.defaultdict(lambda: [0, 0])  # (cohort, followup, dim, val) -> [releases, returned]
    for dc, end, _, nxt in releases:
        y = end.year
        if y not in COHORTS:
            continue
        for n in range(1, MAX_FOLLOWUP + 1):
            if add_years(dt.date(y, 12, 31), n) > as_of:
                break  # the whole cohort has not had n years to return yet
            returned = nxt is not None and nxt < add_years(end, n)
            for dim, val in dims_for(dc, end):
                cell = rec[(y, n, dim, val)]
                cell[0] += 1
                cell[1] += returned
    rec_rows = []
    for (y, n, dim, val), (rel, ret) in sorted(rec.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2] or "", kv[0][3] or "")):
        rec_rows.append(demo_row({}, dim, val, {
            "releases": str(rel), "release_cohort": str(y), "followup_years": str(n),
            "recidivism_rate": str(ret / rel if rel else 0), "recidivated_releases": str(ret)}))
    write_jsonl(os.path.join(out, "recidivism_rates_by_cohort_by_year.json"), rec_rows)
    log(f"Recidivism (return to FDC prison), cohorts {COHORTS.start}-{COHORTS.stop - 1}: {len(rec_rows):,} rows")
    for y in COHORTS:
        cells = [(n, rec[(y, n, None, None)]) for n in (1, 3, 5) if (y, n, None, None) in rec]
        log(f"  {y}: releases {rec[(y, 1, None, None)][0]:,}; " +
            ", ".join(f"{n}-yr {c[1] / c[0]:.1%}" for n, c in cells))

    # --------------------------------------- 4. supervision snapshot by office
    sup = list(read_rows(os.path.join(raw, "offender", "OFFENDER_ROOT.txt")))
    sup_dates = [d for d in (parse_date(r["ReceiptDate"]) for r in sup) if d and d <= as_of + dt.timedelta(days=31)]
    sup_as_of = max(sup_dates)
    log(f"Supervision records: {len(sup):,}; snapshot date (latest start recorded): {sup_as_of}")
    sup_issues = collections.Counter()
    sup_counts = collections.defaultdict(collections.Counter)  # (type, office) -> Counter
    offices = {}
    supervised_by_race = collections.Counter()
    supervised_ids = set()
    type_counts = collections.Counter()
    for r in sup:
        stype = SUPERVISION_TYPE.get(r["supvtype_description"])
        if stype is None:
            sup_issues[f"type not probation/post-prison: {r['supvtype_description'] or '(blank)'} (excluded)"] += 1
            continue
        if r["supvstatus_description"] in SUPERVISION_STATUS_EXCLUDED:
            sup_issues[f"status {r['supvstatus_description']} (excluded)"] += 1
            continue
        race, sex = RACE_MAP.get(r["Race"]), SEX_MAP.get(r["Sex"])
        b = bucket_of(age_on(parse_date(r["BirthDate"]), sup_as_of) or -1)
        if not b:
            sup_issues["age missing or out of range (left out of age breakdown)"] += 1
        office = r["facility_description"].upper()
        keys = [(stype, "ALL")]
        if office not in NOT_AN_OFFICE:
            oid = office_id(office)
            offices[oid] = office_label(office)
            keys.append((stype, oid))
        else:
            sup_issues["no Florida office (statewide total only)"] += 1
        for key in keys:
            c = sup_counts[key]
            c[("total", "ALL")] += 1
            if race:
                c[("race_or_ethnicity", race)] += 1
            if sex:
                c[("gender", sex)] += 1
            if b:
                c[("age_bucket", b)] += 1
        type_counts[r["supvtype_description"]] += 1
        supervised_ids.add(r["DCNumber"])
        if race:
            supervised_by_race[r["DCNumber"]] = race
    for k, v in sorted(sup_issues.items()):
        log(f"  {k}: {v:,}")
    sup_rows = []
    for (stype, oid) in sorted(sup_counts, key=lambda k: (k[0], k[1] != "ALL", k[1])):
        for (dim, val), n in sorted(sup_counts[(stype, oid)].items()):
            sup_rows.append(demo_row({}, None if dim == "total" else dim, val, {
                "district": oid, "supervision_type": stype, "total_supervision_count": str(n)}))
    write_jsonl(os.path.join(out, "supervision_population_by_district_by_demographics.json"), sup_rows)
    for stype in ("PROBATION", "PAROLE"):
        c = sup_counts[(stype, "ALL")]
        office_sum = sum(sup_counts[(stype, o)][("total", "ALL")] for o in offices)
        log(f"  {stype}: {c[('total', 'ALL')]:,} people; offices sum to {office_sum:,}")
    with open(os.path.join(out, "supervision_type_counts.json"), "w", encoding="utf-8") as f:
        json.dump(dict(type_counts.most_common()), f, indent=2)
    entries = [{"id": "ALL", "label": "All Offices"}] + [
        {"id": oid, "label": offices[oid]} for oid in sorted(offices, key=offices.get)]
    with open(os.path.join(out, "supervision_localities.json"), "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2)

    # ------------------------------------- 5. real inputs for racial disparities
    in_prison = {dc: people[dc][0] for dc in active_ids}
    under_control = dict(in_prison)
    for dc, race in supervised_by_race.items():
        under_control.setdefault(dc, race)
    dual = active_ids & supervised_ids
    inc36 = collections.Counter()
    for dc, lst in stays.items():
        if any(s < as_of and (e is None or e > window_start) for s, e in lst) and people[dc][0]:
            inc36[people[dc][0]] += 1
    real = {}
    for race in FL_POPULATION_2024:
        real[race] = {
            "total_state_population": FL_POPULATION_2024[race],
            "current_total_sentenced_count": sum(1 for r in under_control.values() if r == race),
            "current_incarceration_sentence_count": sum(1 for dc, r in in_prison.items() if r == race and dc not in dual),
            "current_probation_sentence_count": sum(1 for dc, r in supervised_by_race.items() if r == race and dc not in dual),
            "current_dual_sentence_count": sum(1 for dc in dual if people[dc][0] == race),
            "current_supervision_population": sum(1 for r in supervised_by_race.values() if r == race),
            "total_incarcerated_population_36_mo": inc36[race],
        }
    real["ALL"] = {k: sum(v[k] for v in real.values()) for k in next(iter(real.values()))}
    with open(os.path.join(out, "real_inputs_racial_disparities.json"), "w", encoding="utf-8") as f:
        json.dump(real, f, indent=2)
    log(f"Under FDC control now (prison or supervision, unique people): {real['ALL']['current_total_sentenced_count']:,}"
        f"; in both: {len(dual):,}")
    for race, v in real.items():
        log(f"  {race:<32} state {v['total_state_population'] / real['ALL']['total_state_population']:6.1%}"
            f"  FDC {v['current_total_sentenced_count'] / real['ALL']['current_total_sentenced_count']:6.1%}")

    with open(os.path.join(out, "real_metrics_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print("\n".join(report))


if __name__ == "__main__":
    main(sys.argv[1])
