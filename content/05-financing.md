# ⚠️ Read this before quoting any financing figure

**Do not benchmark Timor-Leste on health spending as a share of GDP.** It is the standard move and it
will lead you to the wrong conclusion here.

| Year | CHE as % of GDP | Total health spend (US$) |
|---|---|---|
| 2021 | 4.92% | ~178 million |
| 2022 | 7.46% | ~240 million |
| 2023 | **9.60%** | ~200 million |

The ratio nearly doubled while spending *fell* between 2022 and 2023. It moved almost entirely because
**petroleum GDP fell by 43% in two years**. The denominator moved, not the numerator.

**Use instead:**

- **Current health expenditure per capita: US$144.21 (2023).**
- **Domestic government health spending as a share of general government expenditure: 9.16% (2023)**,
  up from 6.97% in 2021.

These describe effort and priority. The GDP ratio, in a petroleum economy with a collapsing
denominator, mostly describes the oil price.

# ⚠️ Two documented inconsistencies in the source data

**1. A widely-circulated WHO figure cannot be reproduced.** WHO's own Timor-Leste profile and its 2024
SEARO SDG profile both publish health expenditure at **11.4% of GDP (2021)**. WHO's own Global Health
Observatory API returns **4.92%**, matching the World Bank exactly.

The 4.92% figure reproduces from primitives — current health expenditure per capita × population ÷ GDP
= 4.9192%. The 11.44% figure implies a GDP denominator of about **US$1.56 billion** against an actual
**US$3.63 billion** — consistent with someone having used **non-oil GDP**, a known trap in Timorese
statistics. **Prefer the API figure; state your denominator explicitly whenever you quote a ratio.**

**2. Two WHO products disagree by roughly 60%.** The Country Cooperation Strategy 2026–2030 states that
*"health expenditure has declined from a pandemic-time peak of 10% of GDP in 2020 to 6% by 2023"*,
against the Global Health Expenditure Database's **9.60%** for 2023. The CCS also gives the UHC service
coverage index as **52** where the Observatory gives **48**.

**Prefer GHED/GHO** — it is the maintained database, and the CCS cites it as its own source. But note
the inconsistency rather than picking silently.

# The distinctive feature: this is a free system

| Indicator | 2021 | 2022 | 2023 |
|---|---|---|---|
| Out-of-pocket as % of CHE | 5.89% | 5.48% | **6.99%** |
| External (donor) as % of CHE | 30.67% | 22.74% | **15.30%** |
| Government health spend as % of govt expenditure | 6.97% | 8.90% | **9.16%** |
| CHE per capita (US$) | 132.08 | 174.92 | **144.21** |
| UHC service coverage index | 47 | 48 | **48** |

**Out-of-pocket spending of around 7% is among the lowest in the world.** It is the single most
distinctive feature of this health system, and it follows directly from the fact that
**Timor-Leste has no social health insurance and public care is free at the point of delivery**,
funded from taxation and petroleum revenue.

That is evidenced rather than asserted: no insurance entity appears anywhere in the 2026 State Budget
health envelope, and no social health insurance body appears among the Ministry's autonomous
institutions.

⚠️ **If your intervention design assumes user fees, co-payments, cost-recovery or insurance
reimbursement, it does not fit this country.**

**Donor dependence is high but falling fast** — from 30.7% of health spending in 2021 to 15.3% in 2023.

# The 2026 national health budget

*Source: General State Budget 2026, Book 1, IX Constitutional Government, approved version — Ministry of
Finance. Portal: [mof.gov.tl](https://www.mof.gov.tl) · [budgettransparency.gov.tl](https://budgettransparency.gov.tl)*

- **Total State Budget 2026: US$2.291 billion** (+5.2% on 2025).
- **Total health allocation: US$138.3 million** — **6.04% of the state budget**.

| Entity | US$ |
|---|---|
| Ministry of Health | 76.8 m |
| HNGV (national hospital) | 20.9 m |
| **INFPM** (medicines and medical products) | 17.1 m |
| Infrastructure Fund | 6.7 m |
| SNAEM (ambulance and emergency) | 3.4 m |
| INSP-TL, RAEOA, municipal health services | remainder |

**By programme:** secondary and tertiary care **US$58.5m**; primary health care **US$55.9m**. Within
primary care, the Comprehensive Primary Health Services Package is **US$27m, of which US$24m is
salaries and wages**; nutrition is US$2.4m.

# ⚠️ Two structural facts that should shape any proposal

**1. The budget is dominated by personnel costs** — *"over 50% of expenditures"* (CCS). Capital
investment is residual: WHO's own assessment is that *"investment in new facilities and infrastructure
upgrades has been minimal."*

**2. The second-largest single line in secondary and tertiary care is money leaving the country.**
**US$19.3 million** is budgeted for **overseas medical treatment and repayment of debts for specialised
services** — **14% of the entire health budget**, spent treating Timorese patients abroad.

That figure is the financial expression of the workforce finding in §6: there is no domestic specialist
training pipeline of scale, so specialist care is bought overseas. Anyone proposing to build domestic
specialist capacity should know that this is the counterfactual cost, and that it is already visible in
the national accounts.

# Pro-health taxation

WHO's health-financing work in Timor-Leste has focused on taxation rather than premiums. Tobacco tax
rose from **US$19/kg to US$50/kg**, and alcohol from **US$4.45/litre to US$8.9/litre** (CCS §2.3.1).

# Sources and refreshability

| Source | What it gives | Refreshable? |
|---|---|---|
| **WHO Global Health Expenditure Database / GHO** — [database](https://apps.who.int/nha/database) · [country view](https://data.who.int/countries/626) | The full financing series above | ✅ Annual release, ~2-year lag |
| **World Bank WDI** `api.worldbank.org/v2/country/TLS/indicator/SH.XPD.*` | Independent corroboration; matched GHO exactly | ✅ ~quarterly refresh |
| **General State Budget 2026** (Ministry of Finance) | Budget lines, entity allocations, programme splits | ✅ Annual, plus mid-year rectification budgets |
| World Bank, *Leveling Up: How ASEAN Membership Can Support Timor-Leste's Economic Transformation* | Petroleum Fund and macro-fiscal context | One-off |

*Financing series queried live 2026-08-24.*
