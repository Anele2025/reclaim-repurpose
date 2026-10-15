#!/usr/bin/env python3
"""Lightweight structural checks for RECLAIM & REPURPOSE CSV and Markdown records.

Run from the repository root: python scripts/validate_operations.py
Uses only Python's standard library. It does not establish legal, safety, destination,
financial, or real-world readiness.
"""
import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors = []
checked_csv = 0
checked_rows = 0

def fail(message):
    errors.append(message)

for path in sorted((ROOT / "templates").rglob("*.csv")):
    checked_csv += 1
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle)
            rows = list(reader)
    except Exception as exc:
        fail(f"{path.relative_to(ROOT)}: cannot parse CSV: {exc}")
        continue
    if not rows:
        fail(f"{path.relative_to(ROOT)}: empty file")
        continue
    header = rows[0]
    if not header or any(not name.strip() for name in header):
        fail(f"{path.relative_to(ROOT)}: blank header name")
    if len(set(header)) != len(header):
        fail(f"{path.relative_to(ROOT)}: duplicate header names")
    for line_no, row in enumerate(rows[1:], start=2):
        checked_rows += 1
        if len(row) != len(header):
            fail(f"{path.relative_to(ROOT)}:{line_no}: {len(row)} fields; expected {len(header)}")
            continue
        record = dict(zip(header, row))
        country_key = next((k for k in ("CountryCode", "country_code") if k in record), None)
        if country_key and record[country_key] and record[country_key] not in {"BW", "SZ"}:
            fail(f"{path.relative_to(ROOT)}:{line_no}: invalid country code {record[country_key]!r}")
        classification = record.get("record_classification") or record.get("RecordStatus") or record.get("RecordStatus ")
        if path.name in {"handover_checklist.csv", "exception_log.csv", "compliance_verification.csv"}:
            if classification != "TEST_DATA":
                fail(f"{path.relative_to(ROOT)}:{line_no}: example row must be labelled TEST_DATA")
        if path.name == "handover_checklist.csv":
            try:
                offered = float(record["offered_quantity"])
                accepted = float(record["accepted_quantity"] or 0)
                rejected = float(record["rejected_quantity"] or 0)
                if min(offered, accepted, rejected) < 0:
                    fail(f"{path.relative_to(ROOT)}:{line_no}: negative handover quantity")
                if accepted + rejected > offered + 1e-9:
                    fail(f"{path.relative_to(ROOT)}:{line_no}: accepted + rejected exceeds offered")
                if record["offered_unit"] != record["quantity_unit"]:
                    fail(f"{path.relative_to(ROOT)}:{line_no}: offered and accepted/rejected units differ")
                if record["expected_unit"] != record["quantity_unit"]:
                    fail(f"{path.relative_to(ROOT)}:{line_no}: expected and handover units differ")
            except (KeyError, ValueError) as exc:
                fail(f"{path.relative_to(ROOT)}:{line_no}: invalid handover quantity/unit: {exc}")
        if path.name == "compliance_verification.csv":
            allowed = {"NOT_CHECKED", "IN_PROGRESS", "VERIFIED", "NOT_APPLICABLE_WITH_EVIDENCE", "BLOCKED", "EXPIRED"}
            status = record.get("verification_status", "")
            if status not in allowed:
                fail(f"{path.relative_to(ROOT)}:{line_no}: invalid verification status {status!r}")
            if status == "VERIFIED" and not record.get("evidence_reference", "").strip():
                fail(f"{path.relative_to(ROOT)}:{line_no}: VERIFIED requires evidence_reference")

# Check relative Markdown links. Ignore anchors and external URLs.
link_pattern = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
for md in sorted(ROOT.rglob("*.md")):
    if ".git" in md.parts:
        continue
    try:
        text = md.read_text(encoding="utf-8")
    except Exception as exc:
        fail(f"{md.relative_to(ROOT)}: cannot read Markdown: {exc}")
        continue
    for target in link_pattern.findall(text):
        target = target.strip().split()[0].strip("<>")
        if not target or target.startswith(("http://", "https://", "mailto:", "#", "data:")):
            continue
        target = target.split("#", 1)[0]
        if not target:
            continue
        resolved = (md.parent / target).resolve()
        try:
            resolved.relative_to(ROOT.resolve())
        except ValueError:
            fail(f"{md.relative_to(ROOT)}: link escapes repository: {target}")
            continue
        if not resolved.exists():
            fail(f"{md.relative_to(ROOT)}: broken relative link: {target}")

print(f"CSV files checked: {checked_csv}")
print(f"CSV data rows checked: {checked_rows}")
print(f"Markdown files scanned: {len(list(ROOT.rglob('*.md')))}")
if errors:
    print(f"FAIL: {len(errors)} issue(s)")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)
print("PASS: CSV structure, selected Stage 3 logic, and relative Markdown links")
print("LIMITATION: these checks do not verify external evidence, formulas in spreadsheet software, legal compliance, or pilot readiness.")
