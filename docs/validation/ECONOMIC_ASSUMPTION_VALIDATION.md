# Economic Assumption Validation — Link to Stage 2

Use the [Stage 2 assumptions register](../../templates/finance/pilot_assumptions.csv), [cost tracker](../../templates/finance/pilot_costs.csv), [revenue tracker](../../templates/finance/pilot_revenue.csv) and [scenario model](../../templates/finance/scenario_model.csv). Do not treat illustrative TEST_DATA as market evidence. Preserve existing model formulas unless a documented defect is found. Keep Botswana/BWP and Eswatini/SZL separate.

| Assumption | Evidence required | Validation method | Stage 2 field(s) to review | Status until evidenced |
|---|---|---|---|---|
| Quantity per collection | Weigh ticket or dated, attributable estimate with method and period | Ask generator; weigh only after authorization and with a documented method | average_mixed_material_kg_per_collection; material kg/collection fields | Assumption |
| Collection frequency | Site schedule, existing records or observed visits | Confirm access windows and actual operational constraints | collections_per_site_per_month; CollectionsPerSitePerMonth | Assumption |
| Sort yield/contamination | Sample composition record and weighing method | Only conduct sample handling after approval; record rejected/unknown material | Material sort-yield and contamination fields | Assumption |
| Receiver acceptance | Current written specification and confirmation for exact material/grade/batch | Qualify receiver and reconfirm before transfer | PartnerAcceptanceRate; material buyer-share fields | Unverified |
| Selling price | Dated quote with currency, grade, unit, deductions and expiry | Request written quotation; verify whether buyer pays or charges | material price fields; revenue tracker UnitPrice | Unverified |
| Transport/fuel | Current route-specific quote or actual documented cost | Record distance, vehicle, load, fuel and rejected-load implications | transport_cost_per_collection; TransportCostPerCollection | Assumption |
| Labour/volunteer time | Actual task/time estimate and lawful cost assumptions | Record time by task and distinguish paid labour from volunteer availability | labour_cost_per_hour; LabourHoursPerCollection | Assumption |
| Packaging/consumables/PPE | Current dated supplier quote or receipt | Obtain quotes and check material/safety suitability | ConsumablesCostPerCollection; cost tracker | Assumption |
| Storage/weighing/handling | Written site terms and equipment quote or documented access | Confirm who provides space, scale, cleaning and security | MonthlyFixedCostPerSite; MonthlySharedFixedCost | Unverified |
| Site access cost | Written site terms, rent/fee or confirmed zero-cost basis | Ask responsible authority; document conditions | Cost tracker and fixed-cost fields | Unverified |
| Service fee/subscription | Specific customer offer, procurement process, written commitment or actual payment | Separate interest, stated willingness, conditional offer, agreement and payment | monthly_service_fee_per_site; MonthlyServiceFeePerSite; ServiceFeeCollectionRate | Hypothesis |
| Sponsorship | Written offer/agreement and conditions; actual receipt separately | Distinguish proposed from confirmed and paid sponsorship | Confirmed/proposed sponsorship fields | Unverified |
| Payment terms/cash timing | Written terms and observed payment records | Confirm invoice, credit, rejection and settlement procedures | ServicePaymentDelayDays; BuyerPaymentDelayDays | Assumption |
| Rejection/disposal cost | Receiver's rejection rules and documented lawful alternative | Ask who bears cost and verify fallback route | Costs, contingency and accepted/rejected quantities | Unverified |
| Actual revenue/cash | Invoice/receipt and payment evidence, stored securely | Reconcile invoiced, agreed and paid values separately | Revenue tracker; ActualCashReceivedInput | No claim until observed |

## Updating rules
1. Record evidence ID, source, date, country, currency, unit, confidence and status for every changed assumption.
2. Do not use a quote after its validity period without reconfirmation.
3. Do not substitute a national average or online price for a site-specific quote without explaining limitations.
4. Do not count proposed sponsorship or unaccepted material as confirmed revenue.
5. Do not set unknown inputs to zero. Zero must be evidenced or explicitly used as a conservative scenario assumption.
6. Recalculate in Excel or Google Sheets and record software/date and any formula errors. Repository CSV presence alone does not prove formulas recalculate correctly.
7. Run downside cases with no unconfirmed sponsorship and no unverified material-sale revenue.
8. If the model cannot cover costs under reasonable, evidence-backed scenarios, revise or stop rather than inflate prices or quantities.
