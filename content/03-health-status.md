# How to read this section

Health status figures for Timor-Leste come from three systems that do not agree with each other: the
routine **health information system (TLHIS/HMIS)**, periodic **household surveys** (the Demographic
and Health Survey, and national nutrition and NCD surveys), and **international modelled estimates**
(WHO, World Bank, UN IGME).

Where they disagree, this document gives all of them. Picking one silently would be the easier and
less honest option, and in at least one case below the disagreement is more informative than any
single number.

⚠️ **A note on freshness.** WHO's Global Health Observatory refreshes **per indicator**, and the spread
is wide — life expectancy was last refreshed in August 2024 while workforce data was refreshed in
January 2026. A stale indicator looks identical to a fresh one in the data. Where the source's own
refresh stamp is known, it is given.

# ⚠️ The skilled birth attendance contradiction

**This is the single most useful data finding in this document.**

| Source | Figure | Direction |
|---|---|---|
| **HMIS** (routine reporting) | **92% (2020) → 56.7% (2024)** | Falling steeply |
| **DHS** (household survey) | **60% (2016) → 78% (2025–26)** | Rising steeply |

These do not merely differ in level. **They move in opposite directions over an overlapping period.**

Both are cited by WHO. One of them is wrong, or both are measuring something different from what their
labels suggest — a plausible explanation is a change in what the routine system counts or how
completely facilities report, but **this document does not know, and says so.**

**Do not use a single skilled-birth-attendance figure for Timor-Leste** in a proposal, a needs
assessment or a baseline. If a funder requires one, cite both and state the discrepancy. For a partner
deciding where to put effort, **the fact that the country's two headline maternal-health data systems
contradict each other is worth more than either number** — it is itself a finding about where
investment might go.

*Sources: WHO CCS 2026–2030 §2.4.1; TLDHS 2025–26 Key Indicators Report.*

# Maternal, newborn, child and adolescent health

- **Maternal mortality ratio: 192 per 100,000 live births** (UN IGME, 2023) — described by WHO as
  *"remains highest in the South-East Asia Region"*. A later UN IGME figure of **171.5 (2025)** is also
  in circulation.
- **Total fertility rate: 4.2 (2016) → 3.4 (TLDHS 2025–26).** A substantial fall.
- **Antenatal care: 46%. Postnatal care: 66%.** (CCS §2.4.1.)
- Skilled birth attendance — see the contradiction above.

⚠️ **The DHS API will serve you ten-year-old data.** A **new TLDHS 2025–26 exists** and its Key
Indicators Report was launched **11 June 2026**, but the DHS Program API still returns **exactly two**
Timor-Leste surveys, 2009 and 2016, and the newest fertility figure it will give you is 4.2 from 2016.
Anything automated against that API will confidently publish decade-old numbers. The full TLDHS 2025–26
report was due "later in 2026". *Verified live 2026-08-24.*

# Nutrition

**Malnutrition, and stunting in particular, remains a major public health challenge** (WHO CCS
§2.4.3). The most recent comprehensive national picture is the **Food and Nutrition Survey 2020**, only
the second such survey in a decade:

| Indicator | 2013 | 2020 |
|---|---|---|
| Stunting | 50.2% | **47.1%** |
| Wasting | 11% | **8.6%** |
| Underweight | 37.3% | **32.4%** |

Improvement is real but slow, and roughly **half of Timorese children are still stunted**. TLDHS
2025–26 also flags persistent malnutrition and maternal anaemia.

# Communicable disease

**Tuberculosis is the dominant communicable disease burden.**

- **Incidence 496 per 100,000 (2024)** — approximately **6,900 cases** — **among the highest in the
  world**.
- A **first national TB prevalence survey was completed in December 2023** (target 20,068 people, 50
  clusters, all municipalities, using Xpert Ultra and liquid culture).
- ⚠️ **UNVERIFIED: whether the results of that survey have been published.** If they have, they are
  the most consequential epidemiological release available for this country, and this document should
  be updated. If you know, please tell us.

**Malaria: Timor-Leste was certified malaria-free by WHO on 24 July 2025**, with the certificate
formally received at the Seventy-ninth World Health Assembly on 19 May 2026. This is a genuine and
recent achievement. The current Global Fund malaria grant is titled *"Prevention of Re-establishment
of Malaria in Timor-Leste"* — the programme focus has shifted from elimination to preventing return.

**HIV** is addressed through a combined Global Fund grant covering HIV/AIDS and TB, with the Ministry
of Health as Principal Recipient. Both current Global Fund grants run to **31 December 2026** — a date
worth noting if you are planning anything that assumes their continuation.

# Immunisation

- **Child vaccination coverage under 1 year: 83%** (National coverage evaluation survey, 2023),
  against a CCS target of ≥90%.
- A national supplementary immunisation activity raised coverage from **86% to 95%**, tracked in DHIS2.
- **HPV vaccination rolled out from 22 July 2024**, targeting **61,374 girls aged 11–14**.
- A **digital immunisation e-tracker launched 4 June 2026**.

Immunisation is one of the better-instrumented parts of the system and one of the clearer recent
success stories.

# Non-communicable disease

NCDs are a stated national priority. The most substantial recent evidence base is the **National Survey
on NCDs and NCD Risk Factors Among Adults, and Availability and Readiness of NCD Services in Health
Facilities, Timor-Leste 2023** (WHO, published 2026-08-04, 406pp, ISBN 9789290222613 —
[record](https://iris.who.int/handle/10665/386866)). Field work ran 17 October – 10 December 2023 using
a tool adapted from the WHO Harmonized Health Facility Assessment.

**This is also the closest thing Timor-Leste has to a national facility-readiness assessment**, and is
therefore worth reading even if NCDs are not your area.

On the policy side, WHO's financing work has been on **pro-health taxation**: tobacco tax raised from
US$19/kg to **US$50/kg**, and alcohol from US$4.45/litre to **US$8.9/litre** (CCS §2.3.1).

# Overall

- **Life expectancy: 67.9 years** (World Bank, data through 2024). ⚠️ Note WHO's GHO life-expectancy
  indicator was last refreshed 2024-08-02 and is the older of the two.
- **UHC Service Coverage Index (SDG 3.8.1): 48** (2023, WHO GHED/GHO). ⚠️ WHO's own CCS gives **52**
  for the same measure — a second internal WHO inconsistency, alongside the financing one in §5.

# Where the numbers come from, and how to re-pull them

| Source | Endpoint | Status |
|---|---|---|
| **World Bank WDI/HNP** — primary numeric spine | `api.worldbank.org/v2/country/TLS/indicator/<CODE>?format=json` | ✅ tested live; ~1,500 indicators; data through 2024; no key |
| **WHO Global Health Observatory** | `ghoapi.azureedge.net/api/<INDICATOR>?$filter=SpatialDim eq 'TLS'` | ✅ tested live; 3,093 indicators; OData filtering; no key; ⚠️ per-indicator freshness |
| **UNICEF Data Warehouse** (child mortality, nutrition, WASH, immunisation) | `sdmx.data.unicef.org/.../TLS.<IND>.?format=sdmx-json` | ✅ tested live; SDMX-JSON; no key |
| **DHS Program** | `api.dhsprogram.com/rest/dhs/surveys?countryIds=TL` | ✅ responds, ⚠️ **serves only 2009 and 2016** |
| **Humanitarian Data Exchange** | CKAN API | ✅ 114 Timor-Leste datasets, uniform CSV |

*All endpoints tested live 2026-08-24. See §10 for the full method and the traps.*
