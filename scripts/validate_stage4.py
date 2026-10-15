#!/usr/bin/env python3
"""Validate Stage 4 structure only; this cannot verify real-world claims."""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {
    "docs/validation/STAGE_4_VALIDATION_PLAN.md",
    "docs/validation/CUSTOMER_INTERVIEW_GUIDE.md",
    "docs/validation/RECOVERY_PARTNER_QUALIFICATION_GUIDE.md",
    "docs/validation/SITE_ACCESS_AND_PERMISSION_GUIDE.md",
    "docs/validation/BOTSWANA_ESWATINI_REQUIREMENTS_RESEARCH.md",
    "docs/validation/EVIDENCE_STANDARDS_AND_DECISION_RULES.md",
    "docs/validation/STAGE_4_FINDINGS_REPORT_TEMPLATE.md",
    "docs/validation/ECONOMIC_ASSUMPTION_VALIDATION.md",
    "templates/validation/customer_site_prospects.csv",
    "templates/validation/customer_interviews.csv",
    "templates/validation/recovery_partner_register.csv",
    "templates/validation/site_permissions.csv",
    "templates/validation/country_requirements_register.csv",
    "templates/validation/evidence_register.csv",
    "templates/validation/validation_decisions.csv",
}
SCHEMAS = {
    "templates/validation/customer_site_prospects.csv": ["ProspectID", "Country", "ProspectCategory", "OrganizationOrSiteName", "DateIdentified", "ValidationStatus"],
    "templates/validation/customer_interviews.csv": ["InterviewID", "ProspectID", "Country", "InterviewDate", "ConsentToRecordNotes", "ValidationOutcome"],
    "templates/validation/recovery_partner_register.csv": ["PartnerID", "Country", "OrganizationName", "MaterialCategoriesAccepted", "CurrencyCode", "CommercialStatus"],
    "templates/validation/site_permissions.csv": ["PermissionRecordID", "Country", "SiteID", "Status", "VerificationDate"],
    "templates/validation/country_requirements_register.csv": ["RequirementID", "Country", "QuestionToVerify", "OfficialSourceURL", "DateChecked", "Status"],
    "templates/validation/evidence_register.csv": ["EvidenceID", "Country", "EvidenceType", "DateObtained", "EvidenceQuality", "ReviewStatus"],
    "templates/validation/validation_decisions.csv": ["DecisionID", "Date", "Country", "Decision", "Rationale"],
}
ID_COLUMNS = {
    "templates/validation/customer_site_prospects.csv": "ProspectID",
    "templates/validation/customer_interviews.csv": "InterviewID",
    "templates/validation/recovery_partner_register.csv": "PartnerID",
    "templates/validation/site_permissions.csv": "PermissionRecordID",
    "templates/validation/country_requirements_register.csv": "RequirementID",
    "templates/validation/evidence_register.csv": "EvidenceID",
    "templates/validation/validation_decisions.csv": "DecisionID",
}
COUNTRIES = {"Botswana", "Eswatini"}
STATUS_ALLOWED = {
    ("templates/validation/site_permissions.csv", "Status"): {"NOT_ASSESSED", "REQUIRED", "REQUESTED", "APPROVED", "REFUSED", "NOT_APPLICABLE"},
    ("templates/validation/country_requirements_register.csv", "Status"): {"CONFIRMED", "POTENTIALLY_APPLICABLE", "NOT_APPLICABLE_JUSTIFIED", "UNRESOLVED"},
    ("templates/validation/evidence_register.csv", "EvidenceQuality"): {"UNTESTED_ASSUMPTION", "UNVERIFIED_LEAD", "SELF_REPORTED", "DOCUMENTED_THIRD_PARTY", "CORROBORATED", "OBSERVED_TRANSACTION_OR_RESULT"},
    ("templates/validation/validation_decisions.csv", "Decision"): {"PROCEED", "REVISE", "PAUSE", "STOP"},
}
DATE_COLUMNS = {"DateIdentified", "InterviewDate", "QuoteDate", "QuoteValidUntil", "LastVerificationDate", "RequestDate", "ApprovalExpiry", "VerificationDate", "DateChecked", "PublicationOrUpdateDate", "DateObtained", "LastFollowUpDate", "NextActionDueDate", "Date", "ReviewDate"}

def main() -> int:
    errors: list[str] = []
    for relative in sorted(REQUIRED):
        if not (ROOT / relative).is_file():
            errors.append(f"Missing required file: {relative}")

    for relative, required_headers in SCHEMAS.items():
        path = ROOT / relative
        if not path.is_file():
            continue
        try:
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle)
                headers = reader.fieldnames or []
                if len(headers) != len(set(headers)):
                    errors.append(f"{relative}: duplicate CSV headers")
                missing = [name for name in required_headers if name not in headers]
                if missing:
                    errors.append(f"{relative}: missing required headers: {', '.join(missing)}")
                for line_no, row in enumerate(reader, start=2):
                    if None in row:
                        errors.append(f"{relative}:{line_no}: extra fields beyond header")
                    if any(value is None for value in row.values()):
                        errors.append(f"{relative}:{line_no}: missing field(s)")
                    record_status = (row.get("RecordStatus") or "").strip()
                    identifier = (row.get(ID_COLUMNS[relative]) or "").strip()
                    if record_status.upper() != "TEST_DATA" and not identifier:
                        errors.append(f"{relative}:{line_no}: blank stable ID in non-test record")
                    country = (row.get("Country") or "").strip()
                    if country and country not in COUNTRIES:
                        errors.append(f"{relative}:{line_no}: invalid Country value {country!r}")
                    for (schema_path, column), allowed in STATUS_ALLOWED.items():
                        if schema_path == relative:
                            value = (row.get(column) or "").strip()
                            if value and value not in allowed:
                                errors.append(f"{relative}:{line_no}: invalid {column} value {value!r}")
                    for column in headers:
                        value = (row.get(column) or "").strip()
                        if value and column in DATE_COLUMNS and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                            errors.append(f"{relative}:{line_no}: {column} must use YYYY-MM-DD")
                    joined = " ".join((value or "") for value in row.values())
                    if "TEST_DATA" in joined and record_status.upper() != "TEST_DATA":
                        errors.append(f"{relative}:{line_no}: example data must be explicitly labelled TEST_DATA")
        except (OSError, csv.Error) as exc:
            errors.append(f"{relative}: unable to read CSV: {exc}")

    # Check relative Markdown links in Stage 4 documents and README.
    markdown_files = [ROOT / p for p in REQUIRED if p.endswith(".md")]
    readme = ROOT / "README.md"
    if readme.is_file():
        markdown_files.append(readme)
    link_pattern = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
    for md_path in markdown_files:
        text = md_path.read_text(encoding="utf-8")
        for target in link_pattern.findall(text):
            target = target.strip()
            if not target or target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            target_path = (md_path.parent / target.split("#", 1)[0]).resolve()
            try:
                target_path.relative_to(ROOT.resolve())
            except ValueError:
                errors.append(f"{md_path.relative_to(ROOT)}: link escapes repository: {target}")
                continue
            if not target_path.exists():
                errors.append(f"{md_path.relative_to(ROOT)}: broken relative link: {target}")

    if errors:
        print("Stage 4 structure validation: FAIL")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Stage 4 structure validation: PASS")
    print("Checked required files, CSV headers/rows, populated IDs, country/status/date formats and relative Markdown links.")
    print("This does not verify external URLs, legal interpretations, evidence authenticity, partner acceptance, permissions or market viability.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
