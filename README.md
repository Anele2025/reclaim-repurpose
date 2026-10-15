# RECLAIM & REPURPOSE

**Circular Solutions. Lasting Impact.**  
*Turning Waste into Value.*

RECLAIM & REPURPOSE is being developed as a Southern African circular-economy initiative focused on helping communities and organizations recover useful materials, reduce avoidable waste, and measure environmental and economic outcomes. Initial target countries are **Botswana and Eswatini**.

> **Current status (Stage 5.1):** Google-first digital-tracker specification and implementation preparation. Repository documentation and validation source are not a deployed application. Google Sheets, Apps Script, AppSheet, WhatsApp provider integration, and production APIs are not claimed to be configured or live.

## Purpose

Build practical, measurable, and financially realistic ways to keep recoverable materials in use for longer. Develop the software while customer, recovery-partner, economic, site, and compliance validation proceeds in parallel. Software functionality is not proof of demand or permission to operate.

## Programme areas

- **Circular Services** — waste assessments, collection coordination, recycling programmes, and reporting for participating organizations.
- **Community Impact** — community participation, environmental education, and responsible opportunities for youth involvement.
- **Materials Recovery** — sorting, reuse, and recycling partnerships for accepted materials.
- **Impact & Innovation** — simple digital tools for recording material flows, operational performance, and environmental outcomes.

These are intended programme areas, not claims that every service is already available.

## Initial operating principles

1. **Start small:** validate a service and receiving partner before physical operations.
2. **Verify destinations:** record where collected materials go and retain evidence where practical.
3. **Measure honestly:** distinguish measured quantities from estimates; document assumptions and gaps.
4. **Protect people and data:** collect only necessary personal information and restrict access to operational records.
5. **Handle materials safely:** do not accept hazardous, clinical, chemical, or other specialist waste without qualified partners, suitable safeguards, and required approvals.
6. **Check local requirements:** verify applicable registration, environmental, municipal, tax, transport, privacy, and waste-handling rules separately in Botswana and Eswatini.
7. **Validate the economics:** record labour, transport, supplies, contamination, disposal, and material-sale income. Do not assume recyclable sales alone will fund the service.

## Initial pilot objectives

- Identify a specific customer or host site and document its needs.
- Confirm accepted materials and receiving-partner handover evidence.
- Define collection responsibilities, service boundaries, and safety procedures.
- Track quantities collected, rejected or contaminated material, costs, destinations, and issues.
- Produce a pilot report with results, limitations, and recommendations.

No pilot results should be reported until they have actually been collected and checked.

## Operational record templates

Stage 1 spreadsheet-ready CSV templates and field definitions are available:

- [Operational records guide](docs/operations/RECORDS_GUIDE.md)
- [Customers and collection sites](templates/operations/customers_sites.csv)
- [Recovery partners and destination verification](templates/operations/recovery_partners.csv)
- [Collection visits](templates/operations/collections.csv)
- [Material lifecycle events and handovers](templates/operations/material_events.csv)
- [Operating costs and revenue](templates/operations/finance_ledger.csv)
- [Monthly impact reporting](templates/operations/monthly_impact.csv)

All included sample rows are fictional test data. CSV templates do not enforce access control, relational constraints, or audit logging.

## Roadmap and actual status

- [x] **Stage 1 — Operational-record schemas and guide:** repository templates exist; not a live operational system.
- [x] **Stage 2 — Pilot economics and decision tools:** planning templates exist; spreadsheet formulas still require recalculation in a spreadsheet application before use.
- [x] **Stage 3 — Pilot workflow, safety and traceability:** draft procedures/checklists exist; they do not authorize operations.
- [x] **Stage 4 — Customer, partner, site-permission and evidence validation:** research plans and registers exist; they are not evidence that validation is complete.
- [x] **Stage 5 specification — Google-first digital tracker:** specification exists on the Stage 5 branch; no live Google resources or provider integration are implied.
- [ ] **Stage 5.1 — Architecture baseline and implementation preparation:** correct status/documentation, add independently testable validation logic and reproducible local tests; review in PR before merge.
- [ ] **Next — Authenticated Apps Script execution and server-side membership lookup:** configure an authorized Google project, implement server-side identity/membership checks and protected Sheets access, and verify with synthetic negative tests.
- [ ] **Following — AppSheet dashboards:** configure the administrator dashboard and separately restricted organization-owner dashboards after server/data-source security is verified.
- [ ] **Following — WhatsApp integration:** select and verify a provider, then implement signed webhook validation, replay protection, retries and failure monitoring.
- [ ] **Physical pilot gate:** begin only after applicable legal, site, safety, customer, and receiving-partner requirements are evidenced as satisfied.

## Google-first digital architecture

The agreed architecture is:

1. **WhatsApp** — participant-facing entry and communication.
2. **Google Sheets** — initial operational records and reporting.
3. **Google Apps Script and controlled APIs** — server-side validation, business rules, scheduled jobs, automation, and controlled data access.
4. **Google AppSheet** — administrator dashboard and separately restricted company-owner dashboards.
5. **Developer monitoring** — failed jobs, retry queues, stale tasks, access denials, audit events, data-quality issues, and backup/quota failures where measurable.

**Do not build a standalone custom browser application** (including Python/SQLite, React, Node.js, or PHP interfaces) for this project. No blockchain, smart contracts, or cryptocurrency functionality is in scope. AppSheet view filters alone are not a security boundary; authorization must be enforced server-side and by a verified secured data-source configuration. Developer access follows least privilege and must not silently bypass organization boundaries.

See the [Stage 5 digital tracker specification](docs/digital/STAGE_5_DIGITAL_TRACKER_SPEC.md) and [Google setup and deployment guide](docs/digital/GOOGLE_SETUP_AND_DEPLOYMENT.md).

## Geographic and currency approach

Botswana and Eswatini are the initial target countries. Applicable monetary amounts in Botswana use **BWP**; applicable monetary amounts in Eswatini use **SZL**. Do not silently convert currencies or combine them in a single total. Country-specific legal and operating requirements must be verified separately. Regional expansion remains an ambition, not a claim of current operations.

## Project status and integrity

No customer contracts, collection volumes, recycling outcomes, environmental savings, permits, or partnerships should be implied unless independently documented. Collection, sorting, or handover alone does not prove recycling. Impact figures must state their method, reporting period, evidence and limitations. Stage 5 software work does not authorize physical operations.

## Contributing

Keep changes reviewable in a branch and pull request. Use synthetic test records; never commit real credentials, access tokens, participant secrets, or unnecessary personal data.
