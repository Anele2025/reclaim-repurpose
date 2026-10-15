# RECLAIM & REPURPOSE

**Circular Solutions. Lasting Impact.**  
*Turning Waste into Value.*

RECLAIM & REPURPOSE is being developed as a Southern African circular-economy initiative focused on helping communities and organizations recover useful materials, reduce avoidable waste, and measure environmental and economic outcomes.

> **Current stage:** Project foundation and pilot design. This repository does not yet represent a deployed or operational service.

## Purpose

Build practical, measurable, and financially realistic ways to keep recoverable materials in use for longer. Start with a small, verifiable pilot, learn from actual operating data, and expand only when the service and partnerships are reliable.

## Programme areas

- **Circular Services** — waste assessments, collection coordination, recycling programmes, and reporting for participating organizations.
- **Community Impact** — community participation, environmental education, and responsible opportunities for youth involvement.
- **Materials Recovery** — sorting, reuse, and recycling partnerships for accepted materials.
- **Impact & Innovation** — simple digital tools for recording material flows, operational performance, and environmental outcomes.

These are intended programme areas, not claims that every service is already available.

## Initial operating principles

1. **Start small:** validate one site, one service, and one reliable recovery partner before scaling.
2. **Verify destinations:** record where collected materials go and retain evidence where practical.
3. **Measure honestly:** distinguish measured quantities from estimates; document assumptions and gaps.
4. **Protect people and data:** collect only necessary personal information and restrict access to operational records.
5. **Handle materials safely:** do not accept hazardous, clinical, chemical, or other specialist waste without qualified partners, suitable safeguards, and required approvals.
6. **Check local requirements:** confirm applicable registration, environmental, municipal, tax, transport, and waste-handling rules before operations begin.
7. **Validate the economics:** record labour, transport, supplies, contamination, disposal, and material-sale income. Do not assume recyclable sales alone will fund the service.

## Initial pilot objectives

- Identify a specific customer or host site and document its needs.
- Confirm what materials are accepted by a recovery partner and agree on handover evidence.
- Define collection responsibilities, service boundaries, and safety procedures.
- Track quantities collected, rejected or contaminated material, costs, destinations, and issues.
- Produce a simple pilot report with results, limitations, and recommendations.

No pilot results should be reported until they have actually been collected and checked.

## Digital project direction

This repository will hold the project's documentation, operating templates, and—when the requirements are validated—digital tools to support operations and impact reporting. The software should serve the real service model, not substitute for validating it.

### Operational record templates

The Stage 1 spreadsheet-ready CSV templates and field definitions are available:

- [Operational records guide](docs/operations/RECORDS_GUIDE.md) — field definitions, controlled values, relationships, validation, monthly reconciliation, and country-specific launch cautions.
- [Customers and collection sites](templates/operations/customers_sites.csv)
- [Recovery partners and destination verification](templates/operations/recovery_partners.csv)
- [Collection visits](templates/operations/collections.csv)
- [Material lifecycle events and handovers](templates/operations/material_events.csv)
- [Operating costs and revenue](templates/operations/finance_ledger.csv)
- [Monthly impact reporting](templates/operations/monthly_impact.csv)

All included rows are fictional test data. These are repository CSV files, not a Google Sheets workbook or an operational database. The templates do not themselves enforce access control, foreign keys, or audit logging.

## Roadmap

- [ ] Confirm the initial country, target site, and first service.
- [ ] Interview prospective customers and recovery partners.
- [ ] Verify material acceptance criteria, local requirements, and operating costs.
- [ ] Prepare the pilot plan, responsibilities, and safety checklist.
- [x] Draft spreadsheet-ready operational record templates and a field/validation guide (Stage 1; test data only).
- [ ] Run and evaluate a small pilot before building unnecessary automation.
- [ ] Specify and implement digital tools based on evidence from the pilot.

## Geographic approach

The long-term ambition is regional, with Botswana and Eswatini as potential starting markets. Each launch must be assessed against local partners, logistics, customer demand, and applicable requirements. Regional expansion is a goal, not a claim of current operations.

## Project status and integrity

This project is in development. No customer contracts, collection volumes, recycling outcomes, environmental savings, permits, or partnerships should be implied unless independently documented. Any future impact figures should state their measurement method, reporting period, and limitations.

## Contributing

The immediate priority is to establish a credible operating model and a small, measurable pilot. Suggestions should be practical, safety-conscious, and supported by evidence wherever possible.


### Stage 2 — Pilot economics and decision tools

Stage 2 adds a configurable, spreadsheet-compatible planning model. All included numbers are fictional `TEST_DATA`, not market facts, quotations, contracts or results.

- [Pilot economics guide](docs/finance/PILOT_ECONOMICS_GUIDE.md)
- [Pilot assumptions register](templates/finance/pilot_assumptions.csv)
- [Pilot costs tracker](templates/finance/pilot_costs.csv)
- [Pilot revenue tracker](templates/finance/pilot_revenue.csv)
- [Scenario model: pessimistic/base/optimistic for BW and SZ separately](templates/finance/scenario_model.csv)
- [Pilot proceed/redesign/pause checklist](docs/finance/PILOT_DECISION_CHECKLIST.md)

The scenario CSV contains spreadsheet formulas; confirm recalculation after importing into Excel or Google Sheets. The model separates expected revenue from actual cash, keeps BWP and SZL separate, and does not infer recycling from collection or partner acceptance. It is a planning tool, not proof of pilot viability.

---

**RECLAIM & REPURPOSE**  
*Circular Solutions. Lasting Impact.*

### Stage 3 — Pilot workflow, safety and traceability

Stage 3 adds draft procedures and checklists for a future controlled pilot. The examples are fictional test data; no operation, destination, permit or recycling outcome is claimed.

- [Master pilot operating procedures](docs/operations/PILOT_OPERATING_PROCEDURES.md)
- [Collection and weighing SOP](docs/operations/COLLECTION_AND_WEIGHING_SOP.md)
- [Sorting, storage and handover SOP](docs/operations/SORTING_STORAGE_AND_HANDOVER_SOP.md)
- [Exceptions, incidents and corrective actions](docs/operations/EXCEPTIONS_INCIDENTS_AND_CORRECTIVE_ACTIONS.md)
- [Safety and compliance checklist (separate BW/SZ verification)](docs/operations/SAFETY_AND_COMPLIANCE_CHECKLIST.md)
- [Daily and monthly reconciliation](docs/operations/DAILY_AND_MONTHLY_RECONCILIATION.md)
- [Handover checklist CSV](templates/operations/handover_checklist.csv)
- [Exception log CSV](templates/operations/exception_log.csv)
- [Compliance verification CSV](templates/operations/compliance_verification.csv)

Stage 3 documents the process; it does not authorize a pilot. Site permission, country-specific compliance, safe handling, a verified destination, actual customer evidence and working capital remain external readiness gates.
