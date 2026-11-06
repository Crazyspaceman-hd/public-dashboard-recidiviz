"""Build Spotlight's current prison population file for Florida from OBIS.

Input : fl-data/raw/inmate_active/INMATE_ACTIVE_ROOT.txt  (+ offenses file, for county names)
Output: fl-data/clean/incarceration_population_by_facility_by_demographics.json  (Spotlight format)
        fl-data/clean/facility_lookup.csv   (facility id, label, type, population)
        fl-data/clean/cleaning_report.txt   (every exclusion and check, with counts)

Usage:  python -I build_prison_population.py <fl-data dir>

Output rows follow the existing Spotlight fixture: one row per facility (or ALL) per single
demographic breakdown, with every other dimension set to "ALL". All values are strings.
No personal identifiers are written anywhere.
"""
import collections
import csv
import datetime as dt
import json
import os
import re
import sys

csv.field_size_limit(10**7)

STATE_CODE = "US_FL"

RACE_MAP = {  # FDC single race/ethnicity code -> Spotlight identifier
    "W": "WHITE",
    "B": "BLACK",
    "H": "HISPANIC",
    "A": "ASIAN",  # FDC label: "ASIAN OR PACIFIC ISLANDER"
    "I": "AMERICAN_INDIAN_ALASKAN_NATIVE",  # FDC label: "AMERICAN INDIAN OR PACIFIC ISL"
    "U": "OTHER",  # FDC label: "ALL OTHERS/UNKNOWN"
}
SEX_MAP = {"M": "MALE", "F": "FEMALE"}
AGE_BUCKETS = [(0, 25, "<25"), (25, 30, "25-29"), (30, 40, "30-39"), (40, 50, "40-49"),
               (50, 60, "50-59"), (60, 70, "60-69"), (70, 200, "70<")]
MIN_AGE, MAX_AGE = 12, 110  # outside this range, birth date is treated as an error

US_STATES = {
    "ALABAMA", "ALASKA", "ARIZONA", "ARKANSAS", "CALIFORNIA", "COLORADO", "CONNECTICUT",
    "DELAWARE", "GEORGIA", "HAWAII", "IDAHO", "ILLINOIS", "INDIANA", "IOWA", "KANSAS",
    "KENTUCKY", "LOUISIANA", "MAINE", "MARYLAND", "MASSACHUSETTS", "MICHIGAN", "MINNESOTA",
    "MISSISSIPPI", "MISSOURI", "MONTANA", "NEBRASKA", "NEVADA", "NEW HAMPSHIRE", "NEW JERSEY",
    "NEW MEXICO", "NEW YORK", "NORTH CAROLINA", "NORTH DAKOTA", "OHIO", "OKLAHOMA", "OREGON",
    "PENNSYLVANIA", "RHODE ISLAND", "SOUTH CAROLINA", "SOUTH DAKOTA", "TENNESSEE", "TEXAS",
    "UTAH", "VERMONT", "VIRGINIA", "WASHINGTON STATE", "WEST VIRGINIA", "WISCONSIN", "WYOMING",
}
OTHER_AGENCY = {"FEDERAL CUSTODY", "I.N.S", "DCF FACILITY", "DEPT OF JUV. JUSTICE",
                "U.S. POSSESSIONS", "CENTRAL OFFICE"}

# Facility type rules, checked in order. Name-based, so reviewed by hand in facility_lookup.csv.
TYPE_RULES = [
    ("WORK_CAMP", re.compile(r"WORK CAMP|WORK CMP|\bW\.C\.?$")),
    ("REENTRY_CENTER", re.compile(r"RE-ENTRY|REENTRY")),
    ("COMMUNITY_RELEASE", re.compile(
        r"C\.R\.C|\bCRC\b|BRIDGE|TTH OF|REALITY HOUSE|SHISA HOUSE|TURNING POINT|\bR\.P\.")),
]


# Satellites (annexes, work camps, extra units) roll up to the institution they are named after.
# Re-entry and community release centers are separate facilities even when they share a town name.
SATELLITE_SUFFIX = re.compile(
    r"[\s\-.]*(ANNEX\.?|WORK CAMP|WORK CMP|W\.C\.?|(EAST|WEST|SOUTH|MAIN) UNIT\.?|-(EAST|MAIN|SOUTH))$")
INSTITUTION_SUFFIX = re.compile(r"[\s\-.]*(C\.I\.?|C\.F\.)[\s\-.]*$")
SATELLITE_TYPES = {"MAJOR_INSTITUTION", "WORK_CAMP"}
# Small location types shown as one entry each rather than dozens of tiny ones.
POOLED_TYPES = {
    "COMMUNITY_RELEASE": ("COMMUNITY_RELEASE_CENTERS", "Community Release Centers (all)"),
    "OUT_OF_STATE": ("OUT_OF_STATE", "Out of State Custody"),
    "COUNTY_CUSTODY": ("COUNTY_CUSTODY", "Florida County Custody"),
    "OTHER_AGENCY": ("OTHER_AGENCY", "Other Agencies (federal, immigration, other)"),
}
# Acronyms in FDC names, expanded for display. Confirm against FDC's facility list.
PARENT_LABELS = {
    "FLORIDA_STATE_PRISON": "Florida State Prison",
    "CFRC": "Central Florida Reception Center",
    "NWFRC": "Northwest Florida Reception Center",
    "R_M_C": "Reception and Medical Center",
    "S_F_R_C": "South Florida Reception Center",
}


# Dropdown sections, in display order: (section heading, aggregate id, aggregate label, types)
GROUPS = [
    ("Major prisons", "GROUP_MAJOR_PRISONS", "All major prisons", {"MAJOR_INSTITUTION"}),
    ("Stand-alone work camps", "GROUP_WORK_CAMPS", "All stand-alone work camps", {"WORK_CAMP"}),
    ("Re-entry centers", "GROUP_REENTRY", "All re-entry centers", {"REENTRY_CENTER"}),
    ("Community release (work release)", "GROUP_COMMUNITY_RELEASE", "All community release centers",
     {"COMMUNITY_RELEASE"}),
    ("Held outside FDC facilities", "GROUP_HELD_ELSEWHERE", "All held outside FDC facilities",
     {"OUT_OF_STATE", "COUNTY_CUSTODY", "OTHER_AGENCY"}),
]


def parent_base(name):
    base = re.sub(r"^FSP\b", "FLORIDA STATE PRISON", name)
    prev = None
    while prev != base:
        prev = base
        base = SATELLITE_SUFFIX.sub("", base)
        base = INSTITUTION_SUFFIX.sub("", base)
        base = base.strip(" -.")
    return base


def parent_key(name):
    return facility_id(parent_base(name))


def classify(name, counties):
    if name in US_STATES:
        return "OUT_OF_STATE"
    if name in OTHER_AGENCY:
        return "OTHER_AGENCY"
    if name in counties:
        return "COUNTY_CUSTODY"
    for kind, pattern in TYPE_RULES:
        if pattern.search(name):
            return kind
    return "MAJOR_INSTITUTION"


def facility_id(name):
    slug = re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")
    return slug or "UNKNOWN"


# FDC names are cut off at 20 characters; restore the ones that are visibly truncated.
TRUNCATED_NAMES = {
    "BAKER RE-ENTRY CENTR": "BAKER RE-ENTRY CENTER",
    "GADSDEN RE-ENTRY CTR": "GADSDEN RE-ENTRY CENTER",
    "SAGO PALM RE-ENTRY C": "SAGO PALM RE-ENTRY CENTER",
    "REENTRY CTR OF OCALA": "REENTRY CENTER OF OCALA",
    "FL.WOMENS RECPN.CTR": "FLORIDA WOMEN'S RECEPTION CENTER",
    "BRIDGES OF JACKSONVI": "BRIDGES OF JACKSONVILLE",
    "TTH OF TARPON SPRING": "TTH OF TARPON SPRINGS",
    "SUWANNEE C.I": "SUWANNEE C.I.",
    "SANTA ROSA WORK CMP": "SANTA ROSA WORK CAMP",
}
SPELLED_OUT = [  # applied to display labels only, after title-casing
    (r"\bC\.i\.?(?=\s|$|-)", "Correctional Institution"),
    (r"\bC\.f\.", "Correctional Facility"),
    (r"\bW\.c\.?$", "Work Camp"),
    (r"\bC\.r\.c\.?|\bCrc\b", "CRC"),
    (r"\bR\.p\.", "R.P."),
    (r"\bTth\b", "TTH"), (r"\bTff\b", "TFF"), (r"\bMtc\b", "MTC"), (r"\bDcf\b", "DCF"),
    (r"\bI\.n\.s\b", "I.N.S."), (r"\bU\.s\.", "U.S."), (r"\bOf\b", "of"),
    (r"\bWomen'S\b", "Women's"), (r"\bDesoto\b", "DeSoto"), (r"\(Fem\)", "(Female)"),
    (r"\bIi\b", "II"), (r"\s*-\s*Annex", " Annex"), (r"(?<=Annex)\.$", ""),
]


def facility_label(name):
    label = TRUNCATED_NAMES.get(name, name).title()
    for pattern, repl in SPELLED_OUT:
        label = re.sub(pattern, repl, label, flags=re.I)
    return re.sub(r"\s+", " ", label).strip()


def read_rows(path):
    with open(path, newline="", encoding="latin-1") as f:
        reader = csv.DictReader(f, delimiter="\t")
        reader.fieldnames = [h.strip() for h in reader.fieldnames]
        for row in reader:
            yield {k: (v or "").strip() for k, v in row.items()}


def parse_date(v):
    try:
        return dt.datetime.strptime(v, "%m/%d/%Y").date()
    except ValueError:
        return None


def age_bucket(age):
    for lo, hi, label in AGE_BUCKETS:
        if lo <= age < hi:
            return label
    return None


def main(base):
    raw = os.path.join(base, "raw", "inmate_active")
    out_dir = os.path.join(base, "clean")
    os.makedirs(out_dir, exist_ok=True)
    report = []
    log = report.append

    counties = {r["County_of_Conviction"] for r in
                read_rows(os.path.join(raw, "INMATE_ACTIVE_OFFENSES_CPS.txt"))
                if r["County_of_Conviction"]}

    people = list(read_rows(os.path.join(raw, "INMATE_ACTIVE_ROOT.txt")))
    receipt_dates = [d for d in (parse_date(p["ReceiptDate"]) for p in people) if d]
    as_of = max(receipt_dates)  # snapshot date = latest admission recorded
    log(f"Snapshot date (latest ReceiptDate): {as_of}")
    log(f"Active inmate records read: {len(people):,}")

    ids = collections.Counter(p["DCNumber"] for p in people)
    dups = sum(1 for v in ids.values() if v > 1)
    log(f"Duplicate DCNumbers: {dups:,}")
    if dups:
        sys.exit("Duplicate people in active root; stopping so totals are not inflated.")

    # Map every location to the parent shown in Spotlight's facility dropdown
    names = {}  # location id -> source name
    for p in people:
        fac_name = p["FACILITY_description"].upper() or "UNKNOWN"
        names[facility_id(fac_name)] = fac_name
    kinds = {fid: classify(n, counties) for fid, n in names.items()}
    parent_of = {}
    for fid, name in names.items():
        if kinds[fid] in POOLED_TYPES:
            parent_of[fid] = POOLED_TYPES[kinds[fid]][0]
        elif kinds[fid] in SATELLITE_TYPES:
            parent_of[fid] = parent_key(name)
        else:
            parent_of[fid] = fid  # re-entry centers stand alone
    members = collections.defaultdict(list)
    for fid, pid in parent_of.items():
        members[pid].append(fid)
    parent_label = {}
    for pid, fids in members.items():
        pooled = [lbl for key, lbl in POOLED_TYPES.values() if key == pid]
        if pooled:
            parent_label[pid] = pooled[0]
        elif pid in PARENT_LABELS:
            parent_label[pid] = PARENT_LABELS[pid]
        else:
            # Prefer the member named exactly like the institution, e.g. "Columbia C.I."
            main_unit = [f for f in fids if parent_key(names[f]) == pid
                         and not SATELLITE_SUFFIX.search(names[f])]
            if main_unit:
                parent_label[pid] = facility_label(names[main_unit[0]])
            elif len(fids) > 1:
                parent_label[pid] = facility_label(parent_base(names[fids[0]])) + " (all units)"
            else:
                parent_label[pid] = facility_label(names[fids[0]])

    # Dropdown sections: every parent belongs to one type group; groups with more than one
    # entry also get an "All ..." entry that totals the whole group.
    parent_kinds = collections.defaultdict(set)
    for fid, pid in parent_of.items():
        parent_kinds[pid].add(kinds[fid])
    group_of = {}
    for pid, ks in parent_kinds.items():
        kind = "MAJOR_INSTITUTION" if "MAJOR_INSTITUTION" in ks else sorted(ks)[0]
        group_of[pid] = next(g for g in GROUPS if kind in g[3])
    group_size = collections.Counter(g[0] for g in group_of.values())
    aggregate_of = {pid: g[1] for pid, g in group_of.items() if group_size[g[0]] > 1}

    issues = collections.Counter()
    # counts[parent_or_ALL][(dimension, value)] -> n ; location totals kept separately
    counts = collections.defaultdict(collections.Counter)
    location_pop = collections.Counter()
    for p in people:
        fid = facility_id(p["FACILITY_description"].upper() or "UNKNOWN")
        location_pop[fid] += 1

        race = RACE_MAP.get(p["Race"])
        if race is None:
            issues[f"race code not mapped: {p['Race']!r}"] += 1
        sex = SEX_MAP.get(p["Sex"])
        if sex is None:
            issues[f"sex not M/F: {p['Sex']!r}"] += 1

        bucket = None
        born = parse_date(p["BirthDate"])
        if born is None:
            issues["birth date missing or unparseable"] += 1
        else:
            age = (as_of - born).days // 365.25
            if not MIN_AGE <= age <= MAX_AGE:
                issues[f"age outside {MIN_AGE}-{MAX_AGE} (birth date treated as error)"] += 1
            else:
                bucket = age_bucket(int(age))
                if age < 18:
                    issues["age under 18 (kept: juveniles can be sentenced as adults)"] += 1

        keys = ["ALL", parent_of[fid]]
        if parent_of[fid] in aggregate_of:
            keys.append(aggregate_of[parent_of[fid]])
        for key in keys:
            c = counts[key]
            c[("total", "ALL")] += 1
            if race:
                c[("race_or_ethnicity", race)] += 1
            if sex:
                c[("gender", sex)] += 1
            if bucket:
                c[("age_bucket", bucket)] += 1

    for k, v in sorted(issues.items()):
        log(f"  {k}: {v:,}")

    # Write Spotlight rows
    rows = []
    for key in ["ALL"] + sorted(k for k in counts if k != "ALL"):
        for (dim, val), n in sorted(counts[key].items()):
            row = {"state_code": STATE_CODE, "gender": "ALL", "age_bucket": "ALL",
                   "race_or_ethnicity": "ALL", "date_of_stay": as_of.isoformat(),
                   "facility": key, "total_population": str(n)}
            if dim != "total":
                row[dim] = val
            rows.append(row)
    out_json = os.path.join(out_dir, "incarceration_population_by_facility_by_demographics.json")
    with open(out_json, "w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    log(f"Spotlight rows written: {len(rows):,} -> {os.path.basename(out_json)}")

    # Consistency checks: every breakdown must add back up to its total
    log("Consistency checks (breakdown sum vs total):")
    failures = 0
    for key, c in counts.items():
        total = c[("total", "ALL")]
        for dim in ("race_or_ethnicity", "gender", "age_bucket"):
            s = sum(n for (d, _), n in c.items() if d == dim)
            if s != total:
                failures += 1
                if key == "ALL":
                    log(f"  ALL {dim}: {s:,} of {total:,} ({total - s:,} unassigned)")
    aggregate_ids = {g[1] for g in GROUPS}
    fac_sum = sum(c[("total", "ALL")] for k, c in counts.items() if k != "ALL" and k not in aggregate_ids)
    agg_sum = sum(c[("total", "ALL")] for k, c in counts.items() if k in aggregate_ids) + sum(
        counts[pid][("total", "ALL")] for pid in group_of if pid not in aggregate_of)
    log(f"  group totals sum to {agg_sum:,} -> {'OK' if agg_sum == counts['ALL'][('total', 'ALL')] else 'MISMATCH'}")
    log(f"  facilities sum to {fac_sum:,}; statewide total {counts['ALL'][('total', 'ALL')]:,}"
        f" -> {'OK' if fac_sum == counts['ALL'][('total', 'ALL')] else 'MISMATCH'}")
    log(f"  breakdowns not summing to their total: {failures}")

    # Location lookup (every source location -> its dropdown parent), for review
    by_type = collections.Counter()
    out_csv = os.path.join(out_dir, "facility_lookup.csv")
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["parent_id", "parent_label", "location_id", "location_label",
                    "location_type", "source_name", "population"])
        for fid in sorted(names, key=lambda k: (parent_label[parent_of[k]], -location_pop[k])):
            pid = parent_of[fid]
            by_type[kinds[fid]] += location_pop[fid]
            w.writerow([pid, parent_label[pid], fid, facility_label(names[fid]),
                        kinds[fid], names[fid], location_pop[fid]])
    log("Population by location type (name-based; review facility_lookup.csv):")
    total = counts["ALL"][("total", "ALL")]
    type_counts = collections.Counter(kinds.values())
    for kind, n in by_type.most_common():
        log(f"  {kind:<18} {n:>7,}  ({n / total:6.2%})  in {type_counts[kind]} locations")

    # Dropdown entries, ready to paste into a Spotlight tenant config (localities.Prison)
    entries = [{"id": "ALL", "label": "All Facilities"}]
    for group_name, agg_id, agg_label, _ in GROUPS:
        members = sorted((p for p, g in group_of.items() if g[0] == group_name), key=lambda p: parent_label[p])
        if not members:
            continue
        if group_size[group_name] > 1:
            entries.append({"id": agg_id, "label": agg_label, "group": group_name})
        entries += [{"id": p, "label": parent_label[p], "group": group_name} for p in members]
        log(f"  {group_name}: {len(members)} entries, "
            f"{sum(counts[p][('total', 'ALL')] for p in members):,} people")
    with open(os.path.join(out_dir, "prison_localities.json"), "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2)
    log(f"Dropdown entries: {len(entries) - 1} (from {len(names)} source locations)"
        f" -> prison_localities.json")

    small = sum(1 for k, c in counts.items() if k != "ALL" and k not in aggregate_ids
                for (d, _), n in c.items() if d != "total" and 0 < n < 10)
    log(f"Breakdown cells with fewer than 10 people: {small:,} (not suppressed; see notes)")

    with open(os.path.join(out_dir, "cleaning_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print("\n".join(report))


if __name__ == "__main__":
    main(sys.argv[1])
