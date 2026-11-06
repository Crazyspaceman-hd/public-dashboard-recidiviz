"""Generate SYNTHETIC stand-ins for the Spotlight metrics Florida does not publish.

Every value written here is invented. They exist so the Florida dashboard can show
every chart Spotlight offers; the UI labels each one "Illustrative data". They are
anchored to real totals where a real total exists, so the invented part is only what
FDC does not release:

  incarceration_population_by_admission_reason.json      real totals; invented admission reasons
  supervision_population_by_month_by_demographics.json   ends at the real current count; invented history
  supervision_terminations_by_month.json                 invented (sized from real office caseloads)
  supervision_terminations_by_period_by_demographics.json  invented, consistent with the monthly file
  supervision_revocations_by_period_by_type_by_demographics.json  invented, equal to the unsuccessful
                                                         terminations above
  racial_disparities.json                                real population and FDC counts + invented
                                                         36-month supervision and revocation counts

Run after build_prison_population.py and build_real_metrics.py:
  python -I build_synthetic_metrics.py <fl-data dir>
Seeded, so the output is identical on every run.
"""
import collections
import datetime as dt
import json
import math
import os
import random
import sys

SEED = 20261106
STATE_CODE = "US_FL"
DIMS = ("race_or_ethnicity", "gender", "age_bucket")
SUP_TYPES = ("PROBATION", "PAROLE")
# Invented parameters (stated in the methodology so nobody mistakes them for findings)
MONTHLY_TERMINATION_RATE = {"PROBATION": 0.035, "PAROLE": 0.06}
SUCCESS_RATE = {"PROBATION": 0.62, "PAROLE": 0.74}
REVOCATION_MIX = {  # technical, new crime, absconsion, unknown
    "PROBATION": (0.46, 0.33, 0.16, 0.05),
    "PAROLE": (0.52, 0.28, 0.15, 0.05),
}
ADMISSION_MIX = {"new_admission_count": 0.60, "probation_revocation_count": 0.24,
                 "parole_revocation_count": 0.04, "other_count": 0.12}
POPULATION_36MO_FACTOR = 1.45  # people ever supervised in 3 years vs. on any one day


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def split(total, weights):
    """Largest-remainder rounding: integer parts that always sum to total."""
    s = sum(weights.values())
    raw = {k: total * w / s for k, w in weights.items()}
    out = {k: math.floor(v) for k, v in raw.items()}
    for k in sorted(raw, key=lambda k: raw[k] - out[k], reverse=True)[: total - sum(out.values())]:
        out[k] += 1
    return out


def jitter(rng, weights, spread):
    return {k: w * math.exp(rng.gauss(0, spread)) for k, w in weights.items()}


def breakdowns(rows, count_field, **match):
    """{(dim or None, value or None): count} for rows matching **match."""
    out = {}
    for r in rows:
        if any(r.get(k) != v for k, v in match.items()):
            continue
        dim = next((d for d in DIMS if r[d] != "ALL"), None)
        out[(dim, r[dim] if dim else None)] = int(r[count_field])
    return out


def demo_row(dim, val, extra_first=None, extra_last=None):
    row = {"state_code": STATE_CODE, "gender": "ALL", "age_bucket": "ALL", "race_or_ethnicity": "ALL"}
    row.update(extra_first or {})
    if dim:
        row[dim] = val
    row.update(extra_last or {})
    return row


def per_dim(bd):
    """{dim: {value: count}} from a breakdown dict."""
    out = collections.defaultdict(dict)
    for (dim, val), n in bd.items():
        if dim:
            out[dim][val] = n
    return out


def first_of_next_month(d):
    return dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def main(base):
    rng = random.Random(SEED)
    clean = os.path.join(base, "clean")
    report = ["SYNTHETIC DATA: every count below is generated, not observed."]
    log = report.append

    prison = read_jsonl(os.path.join(clean, "incarceration_population_by_facility_by_demographics.json"))
    prison_date = prison[0]["date_of_stay"]
    prison_bd = breakdowns(prison, "total_population", facility="ALL")
    sup = read_jsonl(os.path.join(clean, "supervision_population_by_district_by_demographics.json"))
    offices = sorted({r["district"] for r in sup if r["district"] != "ALL"})
    pop_month = read_jsonl(os.path.join(clean, "incarceration_population_by_month_by_demographics.json"))
    months = sorted({dt.date.fromisoformat(r["population_date"]) for r in pop_month})

    # ------------------------------------------------ A. admission reasons
    rows = []
    for (dim, val), total in sorted(prison_bd.items(), key=lambda kv: (kv[0][0] or "", kv[0][1] or "")):
        parts = split(total, jitter(rng, ADMISSION_MIX, 0.12 if dim else 0))
        rows.append(demo_row(dim, val, {"date_of_stay": prison_date},
                             {**{k: str(v) for k, v in parts.items()}, "total_population": str(total)}))
    write_jsonl(os.path.join(clean, "incarceration_population_by_admission_reason.json"), rows)
    log(f"Admission reasons: {len(rows)} rows on the real {prison_date} population ({prison_bd[(None, None)]:,})")

    # ------------------------------------- B. supervision population history
    rows = []
    for stype in SUP_TYPES:
        final = breakdowns(sup, "total_supervision_count", district="ALL", supervision_type=stype)
        final_dims = per_dim(final)
        n = len(months)
        level, path = 0.0, []
        for _ in range(n):  # mean-reverting log walk with a gentle invented decline toward today
            level = 0.92 * level + rng.gauss(0, 0.025)
            path.append(level)
        trend = [math.exp(path[i] - path[-1] + 0.18 * (n - 1 - i) / (n - 1)) for i in range(n)]
        drift = {d: {v: 0.0 for v in vals} for d, vals in final_dims.items()}
        hist = [None] * n
        for i in range(n - 1, -1, -1):
            total = final[(None, None)] if i == n - 1 else round(final[(None, None)] * trend[i])
            cell = {(None, None): total}
            for d, vals in final_dims.items():
                if i < n - 1:
                    for v in vals:
                        drift[d][v] += rng.gauss(0, 0.006)
                weights = {v: c * math.exp(drift[d][v]) for v, c in vals.items()}
                assigned = sum(vals.values()) if i == n - 1 else round(total * sum(vals.values()) / final[(None, None)])
                parts = vals if i == n - 1 else split(assigned, weights)
                cell.update({(d, v): c for v, c in parts.items()})
            hist[i] = cell
        for i, m in enumerate(months):
            for (dim, val), c in sorted(hist[i].items(), key=lambda kv: (kv[0][0] or "", kv[0][1] or "")):
                rows.append(demo_row(dim, val, {}, {"population_date": m.isoformat(),
                                                    "supervision_type": stype, "population_count": str(c)}))
        log(f"{stype} history: {hist[0][(None, None)]:,} in {months[0]} -> {hist[-1][(None, None)]:,} "
            f"in {months[-1]} (last month is the real count)")
    write_jsonl(os.path.join(clean, "supervision_population_by_month_by_demographics.json"), rows)

    # --------------------------------------------- C. monthly terminations
    # 36 months ending with the snapshot month (data runs through Oct 30 -> Oct is the last month)
    end = first_of_next_month(dt.date(int(prison_date[:4]), int(prison_date[5:7]), 1))
    term_months = []
    m = end
    for _ in range(36):
        m = dt.date(m.year - (m.month == 1), (m.month - 2) % 12 + 1, 1)
        term_months.append(m)
    term_months.sort()
    monthly, totals36 = [], collections.defaultdict(lambda: [0, 0])  # (type, office) -> [n, success]
    office_rate = {}
    for stype in SUP_TYPES:
        for office in offices:
            caseload = breakdowns(sup, "total_supervision_count", district=office, supervision_type=stype).get((None, None), 0)
            office_rate[(stype, office)] = min(0.95, max(0.3, SUCCESS_RATE[stype] + rng.gauss(0, 0.05)))
            for m in term_months:
                expected = caseload * MONTHLY_TERMINATION_RATE[stype]
                count = max(0, round(rng.gauss(expected, math.sqrt(expected) + 0.5)))
                rate = min(1, max(0, office_rate[(stype, office)] + rng.gauss(0, 0.03)))
                ok = round(count * rate)
                monthly.append((stype, office, m, count, ok))
                for key in ((stype, office), (stype, "ALL")):
                    totals36[key][0] += count
                    totals36[key][1] += ok
    by_all = collections.defaultdict(lambda: [0, 0])
    for stype, office, m, count, ok in monthly:
        by_all[(stype, m)][0] += count
        by_all[(stype, m)][1] += ok
    rows = []
    for stype, office, m, count, ok in monthly + [(s, "ALL", m, c, o) for (s, m), (c, o) in sorted(by_all.items())]:
        if count == 0:
            continue
        rows.append({"state_code": STATE_CODE, "year": str(m.year), "month": str(m.month), "district": office,
                     "supervision_type": stype, "successful_termination_count": str(ok),
                     "termination_count": str(count), "success_rate": ok / count})
    write_jsonl(os.path.join(clean, "supervision_terminations_by_month.json"), rows)
    log(f"Monthly terminations: {term_months[0]} to {term_months[-1]}, {len(rows):,} rows")

    # ------------------------- D. terminations by demographics (36 months)
    rows = []
    unsuccessful = {}
    for stype in SUP_TYPES:
        for office in ["ALL"] + offices:
            n, ok = totals36[(stype, office)]
            if n == 0:
                continue
            caseload_dims = per_dim(breakdowns(sup, "total_supervision_count", district=office, supervision_type=stype))
            cells = {(None, None): (n, ok)}
            for d, vals in caseload_dims.items():
                counts = split(n, vals)
                effects = {v: rng.gauss(0, 0.04) for v in counts}
                oks = split(ok, {v: c * math.exp(effects[v]) for v, c in counts.items()})
                cells.update({(d, v): (counts[v], min(oks[v], counts[v])) for v in counts})
            for (dim, val), (c, o) in sorted(cells.items(), key=lambda kv: (kv[0][0] or "", kv[0][1] or "")):
                if c == 0:
                    continue
                rows.append(demo_row(dim, val, {"district": office}, {
                    "termination_count": str(c), "supervision_type": stype, "metric_period_months": "36",
                    "success_rate": str(o / c), "successful_termination_count": str(o)}))
            if office == "ALL":
                unsuccessful[stype] = {k: c - o for k, (c, o) in cells.items()}
        log(f"{stype} 36-month terminations: {totals36[(stype, 'ALL')][0]:,}, "
            f"success {totals36[(stype, 'ALL')][1] / totals36[(stype, 'ALL')][0]:.1%}")
    write_jsonl(os.path.join(clean, "supervision_terminations_by_period_by_demographics.json"), rows)

    # ----------------- E. revocations by reason (= unsuccessful terminations)
    rows = []
    rev_by_race = collections.defaultdict(dict)
    keys = ("technical_count", "new_crime_count", "absconsion_count", "unknown_count")
    for stype in SUP_TYPES:
        for (dim, val), total in sorted(unsuccessful[stype].items(), key=lambda kv: (kv[0][0] or "", kv[0][1] or "")):
            parts = split(total, jitter(rng, dict(zip(keys, REVOCATION_MIX[stype])), 0.15 if dim else 0))
            rows.append(demo_row(dim, val, {"metric_period_months": "36", "supervision_type": stype}, {
                **{k: str(parts[k]) for k in ("absconsion_count", "new_crime_count")},
                "revocation_count": str(total),
                **{k: str(parts[k]) for k in ("technical_count", "unknown_count")}}))
            if dim == "race_or_ethnicity" or dim is None:
                rev_by_race[stype][val or "ALL"] = parts
        log(f"{stype} 36-month revocations: {unsuccessful[stype][(None, None)]:,}")
    write_jsonl(os.path.join(clean, "supervision_revocations_by_period_by_type_by_demographics.json"), rows)

    # ------------------------------------------------- F. racial disparities
    with open(os.path.join(clean, "real_inputs_racial_disparities.json"), encoding="utf-8") as f:
        real = json.load(f)
    rows = []
    for race, v in real.items():
        row = {"race_or_ethnicity": race}
        row.update({k: str(n) for k, n in v.items()})
        sup_total = 0
        for stype, prefix in (("PROBATION", "probation"), ("PAROLE", "parole")):
            cur = breakdowns(sup, "total_supervision_count", district="ALL", supervision_type=stype)
            current = cur.get(("race_or_ethnicity", race), 0) if race != "ALL" else cur[(None, None)]
            pop36 = round(current * POPULATION_36MO_FACTOR)
            sup_total += pop36
            row[f"total_{prefix}_population_36_mo"] = str(pop36)
            parts = rev_by_race[stype].get(race, dict.fromkeys(keys, 0))
            for k in keys:
                row[f"{prefix}_{k.replace('_count', '')}_count_36_mo"] = str(parts[k])
        row["total_supervision_population_36_mo"] = str(sup_total)
        for k in keys:
            short = k.replace("_count", "")
            row[f"supervision_{short}_count_36_mo"] = str(
                int(row[f"probation_{short}_count_36_mo"]) + int(row[f"parole_{short}_count_36_mo"]))
        row["parole_release_count_36_mo"] = "0"     # section not used for Florida
        row["current_ftr_participation_count"] = "0"  # North Dakota program; not used
        rows.append(row)
    write_jsonl(os.path.join(clean, "racial_disparities.json"), rows)
    log(f"Racial disparities: {len(rows)} rows (population and FDC counts real; 36-month supervision invented)")

    with open(os.path.join(clean, "synthetic_metrics_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print("\n".join(report))


if __name__ == "__main__":
    main(sys.argv[1])
