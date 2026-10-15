# Stage 2 — Pilot economics guide

**Status:** Spreadsheet-compatible model and fictional test inputs for planning only. This is not a market study, quotation, customer commitment, funding offer, or evidence that a pilot is viable.

## Files
- [Assumptions register](../../templates/finance/pilot_assumptions.csv) — long-form inputs with units, evidence, confidence, status, country, and currency.
- [Cost tracker](../../templates/finance/pilot_costs.csv) — planned/actual expense lines. TotalCost is a spreadsheet formula.
- [Revenue tracker](../../templates/finance/pilot_revenue.csv) — distinct proposed, expected, contracted, and actual revenue streams. GrossAmount is a spreadsheet formula.
- [Scenario model](../../templates/finance/scenario_model.csv) — six configurable test scenarios: pessimistic, base, and optimistic separately for Botswana and Eswatini. Formula cells are included for spreadsheet calculation.

Every row currently marked `TEST_DATA` is fictional. Delete or retain it explicitly as test data; never present it as operational evidence.

## How to use the model
1. Import each CSV into a separate sheet in Google Sheets or Excel. Keep the headers and formulas intact. The scenario model contains formulas in the same row as its inputs; formulas use common Excel/Google Sheets functions (`IF`, `OR`, `AND`, `COUNT`, `SUM`, `SUMPRODUCT`, `MAX`, and `ROUNDUP`). Confirm formulas recalculate correctly in your chosen spreadsheet after import.
2. Replace the illustrative values with evidence-backed inputs. Keep a source reference, date, confidence and status for every material assumption. Do not replace unknown values with zero unless zero has been observed or confirmed.
3. Use `BWP` only for `BW` rows and `SZL` only for `SZ` rows. Run and review each country independently. Do not add or compare raw currency totals across countries.
4. Edit each scenario row's input values to represent the downside, central estimate, and upside cases supported by your own evidence. The labels are scenario names, not claims about either market.
5. Record actual expenses and income in the cost/revenue trackers, then reconcile them to invoices, receipts, bank/mobile-money records or other controlled evidence. Do not count the same transaction twice across this model and Stage 1's `finance_ledger.csv`.

## Evidence statuses
- `UNSOURCED_ASSUMPTION`: illustrative or unverified input; not a market fact.
- `QUOTED`: supported by a dated supplier/buyer quotation; verify validity and scope.
- `OBSERVED`: measured during a documented test or pilot.
- `CONTRACTED`: supported by an executed agreement with terms and conditions.
- `ACTUAL`: recorded transaction/observation, not necessarily independently verified.
- `VERIFIED`: evidence reviewed and sufficient for the specific claim being made.

Status applies to the particular input/claim; a buyer quotation is not a sale, an unsigned proposal is not contracted income, an invoice is not cash, and a weigh ticket showing receipt is not proof of recycling.

## Cost and revenue definitions
- Variable costs: collection-linked labour, transport, consumables, and other costs that change with activity.
- Fixed operating costs: monthly site costs and shared overhead. Avoid entering the same cost in more than one category.
- Setup costs: one-time startup costs; not recurring monthly expenses.
- Contingency: a configurable percentage applied to fixed, variable and setup costs. It is a planning allowance, not a supplier invoice.
- Expected service-fee revenue = fee per site per month × sites × months × fee collection rate.
- Confirmed sponsorship is modelled separately from proposed sponsorship. Proposed income is included only in the “including proposals” projection; the result excluding proposals is the more conservative view.
- Expected material-sale revenue = expected buyer-purchased quantity by material × that material's unit price. In the scenario model, quantity is estimated from collected quantity × sort yield × partner acceptance rate × buyer purchase share. This remains a scenario estimate until supported by real buyer terms and accepted quantities.
- Actual cash received is populated only from the explicit `ActualCashReceivedInput`; it is not inferred from projected revenue. Blank actual cash returns `INSUFFICIENT_DATA`.

## Material flow: do not double-count
The scenario model calculates collected, contamination-adjusted sorted, accepted, expected-sale, and evidence-backed recycling quantities as separate stages. It does not sum those stages together. “RejectedOrUnresolvedKg” is a conservative residual (total collected less accepted) and may include sorting losses/contamination as well as material not accepted; it is not a confirmed partner rejection figure. Reconcile with Stage 1 material-event records for actual reporting. Confirmed recycling output remains `INSUFFICIENT_EVIDENCE` unless the evidence status is `VERIFIED` and an actual recycled quantity is entered. A scenario forecast cannot itself prove reuse or recycling.

## Main formulas and interpretation
- Total collections = months × sites × collections per site per month.
- Total collected by material = total collections × kg per collection for that material.
- Sorted quantity by material = collected quantity × (1 − contamination rate) × that material's sort yield. The yield is applied to the remaining material after the assumed contaminated share is removed.
- Accepted quantity = total sorted quantity × partner acceptance rate.
- Variable costs = total collections × (labour hours per collection × labour cost per hour + transport cost per collection + consumables per collection).
- Fixed costs = sites × months × monthly fixed cost per site + months × monthly shared fixed cost.
- Setup costs = sites × one-time setup cost per site.
- Contingency = (variable + fixed + setup) × contingency rate.
- Total costs = variable + fixed + setup + contingency.
- Cost per collection/kg collected/kg accepted = total costs divided by the corresponding non-zero quantity; otherwise the result is `INSUFFICIENT_DATA`.
- Net operating result excluding proposals = expected service fees + confirmed sponsorship + expected material sales − total costs. Material sales are uncertain until a buyer and sale are evidenced; review a no-material-sales downside too.
- Break-even monthly service fee per site = (total costs − confirmed sponsorship) ÷ (sites × months × service-fee collection rate). This is deliberately conservative about unconfirmed sponsorship and excludes proposed sponsorship. It is not a recommended market price.
- Break-even paying sites compares per-site service fee and confirmed sponsorship contribution with per-site operating/setup costs, including contingency, and divides shared overhead by positive contribution. If contribution is zero or negative, it returns `NOT_ACHIEVABLE`; missing inputs return `INSUFFICIENT_DATA`.
- Gross working capital before receipts = setup costs + average monthly fixed/variable costs × (1 + maximum service/buyer payment delay days ÷ 30). This deliberately assumes no receipts arrive before the delay period clears; use a dated cash-flow forecast before committing funds. It is not a bank balance forecast.

## Important limitations and decision use
- The model is a planning template, not an automated financial system. CSV does not enforce data types, valid ranges, unique IDs, currency compatibility, or audit history. Validate inputs manually and protect operational records.
- Scenario formulas use a configurable contamination rate and assumed aggregate partner acceptance. For actual reporting, acceptance and rejection must be tied to documented handovers, by material and event. The scenario model is not a substitute for the Stage 1 lifecycle register.
- The model does not calculate tax, depreciation, financing, inflation, foreign exchange, complex payment schedules, or legal compliance. Add only with country-specific evidence and competent advice.
- If any critical cost, permission, safe destination, buyer acceptance condition, or funding source is unknown, treat the decision as unresolved rather than assuming the missing value is zero.
- Optimistic results are not proof of viability. Test lower volumes, higher transport/labour, greater rejection, lower buyer prices, delayed/non-payment and zero material-sale revenue before proceeding.

## Country and currency separation
Botswana uses `BW` / `BWP`; Eswatini uses `SZ` / `SZL`. Keep wages, transport, material prices, taxes and compliance assumptions country-specific. Do not combine currency amounts. If an exchange-rate comparison is later needed, document the rate, source, date, conversion direction and formula in a separate comparison layer.
