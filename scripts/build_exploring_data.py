from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from statistics import mean

from openpyxl import load_workbook


WORKBOOK = Path(
    "/Users/petersargent/Library/CloudStorage/GoogleDrive-peter@imetpetersargent.com/"
    "My Drive/National Exploring Spreadsheet Capture 2026-10-26.xlsx"
)
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"


def as_date(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        text = value.strip()
        for fmt in ("%Y-%m-%d %H:%M:%S", "%m/%d/%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(text, fmt).date().isoformat()
            except ValueError:
                pass
        return text
    return None


def clean(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def number(value, default=0):
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def integer(value, default=0):
    return int(round(number(value, default)))


def rows(ws, header_row=1):
    headers = [str(c.value).strip() if c.value is not None else "" for c in ws[header_row]]
    for row in ws.iter_rows(min_row=header_row + 1, values_only=True):
        if not any(cell is not None and cell != "" for cell in row):
            continue
        yield {headers[i]: clean(row[i]) if i < len(row) else None for i in range(len(headers))}


def pct(numer, denom):
    return numer / denom if denom else 0


def main():
    global WORKBOOK
    parser = argparse.ArgumentParser()
    parser.add_argument("--workbook", type=Path, default=WORKBOOK)
    WORKBOOK = parser.parse_args().workbook
    wb = load_workbook(WORKBOOK, read_only=True, data_only=True)
    DATA_DIR.mkdir(exist_ok=True)

    post_rows = list(rows(wb["Posts"]))
    council_rows = list(rows(wb["Council View"]))
    cst_metric_rows = list(rows(wb["Unit Metric by CST"]))
    renew_rows = list(rows(wb["Renewal"]))
    unit_metric_rows = list(rows(wb["UnitMetric"]))
    unit_metrics = {}
    for row in unit_metric_rows:
        unit_id = row.get("UnitID")
        if unit_id in (None, ""):
            continue
        unit_metrics[unit_id] = {
            "unitMetric": number(row.get("UnitMetric")),
            "trained": str(row.get("Trained") or "").strip().lower() == "yes",
            "sizeHealthy": str(row.get("Size") or "").strip().lower() == "yes",
            "growthHealthy": str(row.get("Growth") or "").strip().lower() == "yes",
            "youthLeadershipHealthy": str(row.get("Youth Leadership") or "").strip().lower() == "yes",
            "outdoorHealthy": str(row.get("Outdoor") or "").strip().lower() == "yes",
            "ulTrained": str(row.get("UL Trained") or "").strip().lower() == "yes",
            "ccTrained": str(row.get("CC Trained") or "").strip().lower() == "yes",
            "officersTrained": str(row.get("Officers Trained") or "").strip().lower() == "yes",
            "retention": number(row.get("Retention"), None),
            "lawFire": integer(row.get("Law_Fire")),
            "metricYouth": integer(row.get("Total Youth")),
            "metricYouthPriorYear": integer(row.get("Youth Prior Yr")),
            "metricYouthYoy": integer(row.get("Youth YOY")),
        }
    dashboard_totals = {}
    for row in wb["Dashboard"].iter_rows(values_only=True):
        if row and row[0] == "Total":
            dashboard_totals = {
                "posts": integer(row[1]),
                "totalYouth": integer(row[2]),
                "primaryYouth": integer(row[3]),
                "primaryLastYear": integer(row[4]),
                "primaryYoy": integer(row[5]),
                "yearEndYouth": integer(row[6]),
                "yearEndYoy": integer(row[7]),
            }
            break

    generated = datetime.now().replace(microsecond=0).isoformat()
    source_mtime = datetime.fromtimestamp(WORKBOOK.stat().st_mtime).replace(microsecond=0).isoformat()

    posts = []
    owner_counts = Counter()
    area_counts = Counter()
    focus_counts = Counter()
    renewal_counts = Counter()
    council_totals = defaultdict(lambda: {"posts": 0, "youth": 0, "primaryYouth": 0})
    cst_totals = defaultdict(lambda: {"posts": 0, "youth": 0, "primaryYouth": 0, "metric": []})

    for row in post_rows:
        unit_id = row.get("Unit_ID")
        if unit_id in (None, ""):
            continue
        metric_detail = unit_metrics.get(unit_id, {})
        cst = integer(row.get("CST"))
        council = row.get("Council") or "Unassigned council"
        district = row.get("District") or ""
        unit_type = row.get("Unit") or "Post"
        unit_no = row.get("Unit#") or ""
        total_youth = integer(row.get("Total Youth"))
        primary_youth = integer(row.get("Primary Youth"))
        primary_yoy = integer(row.get("Primary YOY"))
        metric = metric_detail.get("unitMetric", number(row.get("Unit Metric"), None))
        tenure = integer(row.get("Tenure"))
        renewal = as_date(row.get("Renewal"))
        renewal_status = row.get("Renewal Status") or ""
        law_fire = ""
        focus = "General"
        charter_org = row.get("Charter Org") or ""
        lower = f"{charter_org} {row.get('Post Name') or ''}".lower()
        if "fire" in lower:
            focus = "Fire"
            law_fire = "Fire"
        elif "police" in lower or "sheriff" in lower or "law" in lower:
            focus = "Law enforcement"
            law_fire = "Law"
        elif "maritime" in lower or "sea" in lower:
            focus = "Maritime"
        elif "aviation" in lower or "air" in lower or "soaring" in lower:
            focus = "Aviation"
        if metric_detail.get("lawFire") == 1 and focus == "General":
            focus = "Law / Fire"

        health = "Watch"
        if total_youth >= 10 and primary_yoy >= 0 and metric is not None and metric >= 2:
            health = "Strong"
        elif total_youth < 5 or primary_yoy < -5 or metric in (None, 0):
            health = "Needs attention"

        owner = f"CST {cst}" if cst else "Unassigned"
        area = f"CST {cst}" if cst else "Unassigned"
        post = {
            "unitId": unit_id,
            "cst": cst,
            "owner": owner,
            "serviceArea": area,
            "council": council,
            "district": district,
            "unitType": unit_type,
            "unitNumber": unit_no,
            "postName": row.get("Post Name") or f"{unit_type} {unit_no}",
            "totalYouth": total_youth,
            "totalAdults": integer(row.get("Total Adults")),
            "primaryYouth": primary_youth,
            "primaryYoy": primary_yoy,
            "primaryToYearEnd": integer(row.get("Primary to YE")),
            "unitMetric": metric if metric is not None else 0,
            "trained": bool(metric_detail.get("trained")),
            "sizeHealthy": bool(metric_detail.get("sizeHealthy")),
            "growthHealthy": bool(metric_detail.get("growthHealthy")),
            "youthLeadershipHealthy": bool(metric_detail.get("youthLeadershipHealthy")),
            "outdoorHealthy": bool(metric_detail.get("outdoorHealthy")),
            "ulTrained": bool(metric_detail.get("ulTrained")),
            "ccTrained": bool(metric_detail.get("ccTrained")),
            "officersTrained": bool(metric_detail.get("officersTrained")),
            "retention": metric_detail.get("retention"),
            "metricAvailable": bool(metric_detail),
            "metricYouth": metric_detail.get("metricYouth", total_youth),
            "metricYouthPriorYear": metric_detail.get("metricYouthPriorYear", 0),
            "metricYouthYoy": metric_detail.get("metricYouthYoy", primary_yoy),
            "tenureMonths": tenure,
            "renewalDate": renewal,
            "renewalStatus": renewal_status,
            "charterOrg": charter_org,
            "focus": focus,
            "lawFire": law_fire,
            "health": health,
        }
        posts.append(post)
        owner_counts[owner] += 1
        area_counts[area] += 1
        focus_counts[focus] += 1
        renewal_counts[renewal_status or "No status"] += 1
        council_totals[council]["posts"] += 1
        council_totals[council]["youth"] += total_youth
        council_totals[council]["primaryYouth"] += primary_youth
        cst_totals[cst]["posts"] += 1
        cst_totals[cst]["youth"] += total_youth
        cst_totals[cst]["primaryYouth"] += primary_youth
        if metric is not None:
            cst_totals[cst]["metric"].append(metric)

    total_posts = dashboard_totals.get("posts") or len(posts)
    total_youth = dashboard_totals.get("totalYouth") or sum(p["totalYouth"] for p in posts)
    primary_youth = dashboard_totals.get("primaryYouth") or sum(p["primaryYouth"] for p in posts)
    primary_yoy = dashboard_totals.get("primaryYoy") or sum(p["primaryYoy"] for p in posts)
    avg_metric = mean([p["unitMetric"] for p in posts]) if posts else 0
    trained_posts = sum(1 for p in posts if p["unitMetric"] >= 1)
    strong_posts = sum(1 for p in posts if p["health"] == "Strong")
    needs_attention = sum(1 for p in posts if p["health"] == "Needs attention")

    cst_summary = []
    for cst, vals in sorted(cst_totals.items()):
        cst_summary.append({
            "cst": cst,
            "posts": vals["posts"],
            "totalYouth": vals["youth"],
            "primaryYouth": vals["primaryYouth"],
            "averageMetric": mean(vals["metric"]) if vals["metric"] else 0,
        })

    council_summary = []
    for row in council_rows:
        council = row.get("Unique_Councils") or row.get("Council")
        if not council:
            continue
        council_summary.append({
            "cst": integer(row.get("CST")),
            "council": council,
            "posts": integer(row.get("Crews")),
            "primaryYouth": integer(row.get("Primary Youth")),
            "primaryYoy": integer(row.get("Primary YOY")),
            "totalYouth": integer(row.get("Total Youth")),
            "totalAdults": integer(row.get("Total Adults")),
            "averageMetric": number(row.get("Average Unit Metric")),
            "training": number(row.get("Training")),
            "size": number(row.get("Size")),
            "growth": number(row.get("Growth")),
            "leadership": number(row.get("Leadership")),
            "outdoor": number(row.get("Outdoor")),
            "retention": number(row.get("Retention")),
        })

    metric_by_cst = []
    for row in cst_metric_rows:
        if not isinstance(row.get("CST"), (int, float)):
            continue
        metric_by_cst.append({
            "cst": integer(row.get("CST")),
            "posts": integer(row.get("Posts")),
            "averageMetric": number(row.get("Average Metric")),
            "lowMetricPosts": integer(row.get("0-2")),
            "midMetricPosts": integer(row.get(3)),
            "highMetricPosts": integer(row.get("4-5")),
            "trainedRate": number(row.get("UL & CC Trained")),
            "sizeRate": number(row.get("Exceeds Small Unit Threshold")),
            "growthRate": number(row.get("Growth")),
            "officersRate": number(row.get("Officers Elected & Trained")),
            "outdoorRate": number(row.get("Outdoor")),
        })

    renewal_status = Counter()
    for row in renew_rows:
        status = row.get("Renewal_Status") or row.get("Renewal Status") or "No status"
        renewal_status[status] += 1

    dashboard = {
        "program": "National Exploring",
        "sourceWorkbook": WORKBOOK.name,
        "sourceModifiedAt": source_mtime,
        "sourceAsOf": as_date(wb["Dashboard"]["B2"].value),
        "generatedAt": generated,
        "sourceNotes": {
            "primaryYouthDashboard": primary_youth,
            "primaryYouthPostRows": sum(p["primaryYouth"] for p in posts),
            "postsWithoutUnitMetric": sum(not p["metricAvailable"] for p in posts),
            "invalidRetentionValues": sum(p["retention"] is not None and not 0 <= p["retention"] <= 1 for p in posts),
            "focusMethod": "Inferred from charter organization and post name; not an official focus classification.",
            "retentionMethod": "Unweighted mean of matched UnitMetric retention values from 0% to 100%; missing and out-of-range values are excluded.",
        },
        "summary": {
            "posts": total_posts,
            "totalYouth": total_youth,
            "primaryYouth": primary_youth,
            "primaryYoy": primary_yoy,
            "primaryLastYear": dashboard_totals.get("primaryLastYear", 0),
            "yearEndYouth": dashboard_totals.get("yearEndYouth", 0),
            "yearEndYoy": dashboard_totals.get("yearEndYoy", 0),
            "averageMetric": avg_metric,
            "trainedPosts": trained_posts,
            "trainingRate": pct(trained_posts, total_posts),
            "strongPosts": strong_posts,
            "needsAttention": needs_attention,
            "councils": len(council_summary),
        },
        "filters": {
            "owners": sorted(owner_counts),
            "serviceAreas": sorted(area_counts),
            "focuses": sorted(focus_counts),
        },
        "breakdowns": {
            "ownerCounts": dict(sorted(owner_counts.items())),
            "serviceAreaCounts": dict(sorted(area_counts.items())),
            "focusCounts": dict(focus_counts.most_common()),
            "renewalStatusCounts": dict(renewal_status.most_common()),
        },
        "cstSummary": cst_summary,
        "councilSummary": sorted(council_summary, key=lambda x: x["totalYouth"], reverse=True),
        "metricByCst": metric_by_cst,
        "posts": sorted(posts, key=lambda x: (x["cst"], x["council"], x["unitNumber"])),
    }

    (DATA_DIR / "national-exploring-dashboard-data.json").write_text(
        json.dumps(dashboard, indent=2), encoding="utf-8"
    )

    with (DATA_DIR / "national-exploring-posts.csv").open("w", newline="", encoding="utf-8") as f:
        fieldnames = list(posts[0].keys()) if posts else []
        writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(posts)

    with (DATA_DIR / "national-exploring-council-cst-map.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["council", "cst", "posts", "totalYouth", "primaryYouth"], lineterminator="\n")
        writer.writeheader()
        for item in sorted(council_summary, key=lambda x: (x["cst"], x["council"])):
            writer.writerow({
                "council": item["council"],
                "cst": item["cst"],
                "posts": item["posts"],
                "totalYouth": item["totalYouth"],
                "primaryYouth": item["primaryYouth"],
            })

    print(json.dumps({
        "posts": total_posts,
        "totalYouth": total_youth,
        "primaryYouth": primary_youth,
        "generatedAt": generated,
    }, indent=2))


if __name__ == "__main__":
    main()
