# How this document is produced

```
quarterly trigger (scheduled script, no AI)
  1. AI agent session   -> re-verifies and updates content/*.md   (research, drafting, judgement)
  2. node build.js      -> renders one self-contained HTML page, stamps the dates
  3. node publish.js    -> git commit and push          (the ONLY publisher; the AI never pushes)
  4. node archive.js    -> new Zenodo version + web archive snapshot
  5. liveness stamp     -> so a silently-dead pipeline is detectable
```

The split is deliberate: **judgement is done by an AI agent, publication is done by a deterministic
script.** The agent can propose text; it cannot publish. That boundary is what makes the review model in
§0 meaningful rather than decorative.

**The numeric spine is re-pulled from source APIs each cycle rather than recalled.** This is not
fastidiousness — see the two documented cases below where a recalled or copied number was wrong.

# Primary sources

| Source | Role | Freshness |
|---|---|---|
| **WHO Country Cooperation Strategy for Timor-Leste 2026–2030** — [record](https://iris.who.int/handle/10665/385106), ISBN 9789290222316, xii+69pp | The best single current description of the system | Published 2026-03-26; CCS cycles ~5 years, next ~2031 |
| **National Health Sector Strategic Plan II (2020–2030)** — full text at `apps.ms.gov.tl/hris/mdoc/` | The operative national plan | Current ⚠️ WHO's own planning database still lists the superseded 2011–2030 plan |
| **General State Budget 2026** — Ministry of Finance, [mof.gov.tl](https://www.mof.gov.tl) | Budget lines and entity allocations | Annual + mid-year rectification |
| **WHO National Survey on NCDs and NCD Risk Factors / facility readiness, Timor-Leste 2023** — [record](https://iris.who.int/handle/10665/386866), 406pp | The closest thing to a national facility-readiness assessment | Published 2026-08-04; fieldwork Oct–Dec 2023 |
| **TLDHS 2025–26 Key Indicators Report** | Household-survey headline indicators | Launched 2026-06-11; full report due later in 2026 |
| **UNFPA 4th Country Programme Evaluation (2021–2025), annexes** — [PDF, 253pp](https://www.unfpa.org/sites/default/files/2025-03/Annexes-UNFPA%20Timor-Leste%204th%20Country%20Programme%20Evaluation%20(2021-2025).pdf) | Best published roster of active Timorese health and GBV civil society | March 2025 |

# Machine-readable sources, tested live

All were tested with live calls on **2026-08-24** and all work **without an API key**.

| Source | Endpoint | Notes |
|---|---|---|
| **World Bank WDI / HNP** | `api.worldbank.org/v2/country/TLS/indicator/<CODE>?format=json` | ~1,500 indicators; data through 2024; refreshes ~quarterly. **The primary numeric spine.** |
| **WHO Global Health Observatory** | `ghoapi.azureedge.net/api/<INDICATOR>?$filter=SpatialDim eq 'TLS'` | 3,093 indicators; full OData filtering |
| **UNICEF Data Warehouse** | `sdmx.data.unicef.org/.../TLS.<IND>.?format=sdmx-json` | Child mortality, nutrition, WASH, immunisation |
| **DHS Program** | `api.dhsprogram.com/rest/dhs/surveys?countryIds=TL` | ⚠️ see trap 3 |
| **Humanitarian Data Exchange** | CKAN API | 114 Timor-Leste datasets; aggregates WHO, DHS and World Bank into uniform CSV; includes an OSM-derived health-facility layer as GeoJSON |
| **d-portal.org** | unauthenticated | 968 Timor-Leste health activities. ⚠️ Use instead of ReliefWeb (now requires a registered `appname`) and the official IATI Datastore (requires a key) |
| **World Directory of Medical Schools** | `search.wdoms.org` — country code **771** | ⚠️ No documented public API; the query used is an undocumented form endpoint. Supervised refresh only |
| **Ministry of Health Facebook** | [facebook.com/MinisteriodaSaudeTL](https://www.facebook.com/MinisteriodaSaudeTL) | ⚠️ The most current source in the country, and **attended refresh only** — see below |

# ⚠️ Five traps, documented because each one produced a wrong answer

**1. Link rot here is a reputational hazard, not a cosmetic one.** USAID's country health pages are gone
following the agency's restructuring. Worse: **`healthpolicyplus.com`, a former USAID-funded project
domain, has been re-registered and now serves a Bitcoin-casino affiliate site.** A refresh job that
copies citations forward and only checks status codes would cheerfully republish that link under a
USAID label.

**So this document's pipeline fetches and fingerprints cited pages rather than pinging them.** The same
pattern appears in-country — see the two misleading domains in §8.

**2. A model recalling a number gets it wrong, and there is a concrete instance.** WHO's own Timor-Leste
profile publishes health expenditure at 11.4% of GDP (2021); WHO's own API returns 4.92%. The API figure
reproduces from primitives; the profile figure implies a non-oil-GDP denominator. **Pull from the API,
cite the endpoint, and state the denominator.** §5.

**3. The DHS API silently serves ten-year-old data.** A new TLDHS 2025–26 exists, but the API returns
only the 2009 and 2016 surveys. **Anything automated against it will publish decade-old figures with
full confidence.** Current figures are hard-coded from the Key Indicators Report and the API is re-tested
each cycle.

**4. Global Health Observatory freshness is per-indicator and varies by about 18 months** — life
expectancy last refreshed August 2024, workforce data January 2026. **A stale indicator looks identical
to a fresh one in the payload.** The per-observation refresh stamp is logged.

**5. `nslookup` gives false NXDOMAIN results for `.tl` domains.** Use `curl`. `redcross.tl` reports
NXDOMAIN on two public resolvers and returns HTTP 200 via curl. More generally: **check content, not
status codes** — §8 documents a domain that returns 200 and is not the organisation it appears to be,
and another that looks dead over HTTPS and is alive over HTTP.

# ⚠️ Social media is a primary source here, and that is not a compromise

**In Timor-Leste, the most current published health-policy source is a Facebook page.** The Ministry's
website returns 502; its Facebook page has **139,000 followers and posts near-daily** (§4). The same
pattern holds for INSP-TL, and for a significant share of the civil-society organisations in §8, where
a dead domain sits beside a live Facebook feed.

Treating social media as a source has costs this document accepts deliberately:

- **It is not archival.** Posts can be edited or deleted with no record, and there is no stable
  citation. Where a Facebook post is the only source for a claim, the claim is dated and attributed to
  the channel, and treated as more perishable than a document.
- **It cannot be read by machine.** Facebook blocks unauthenticated HTTP requests outright, requires a
  login for a browser, **renders only a few posts into the page at a time**, and **deliberately
  interleaves decoy characters into post text to defeat scraping**. Bold headings are additionally
  encoded as mathematical-alphanumeric characters rather than plain letters.
- ⚠️ **So this source cannot be refreshed unattended.** The quarterly pipeline cannot log in and should
  not try to. **When the refresh hits a login wall or an anti-bot block, it stops and emails the editor
  to run that part of the update attended** rather than silently skipping the most current source in
  the country and leaving the page looking complete.

That last rule matters more than it sounds. A refresh that quietly fails on the freshest source, and
succeeds everywhere else, produces a page that is confidently out of date — the exact failure this
document is built to avoid.

# On negative findings

Where this document says something does not exist, that claim was tested against a **positive control**
wherever possible — a query known to return results, run against the same source. The finding that
**there is no 3W dataset for Timor-Leste** is stated only because the sibling query on the same platform
returned 114 Timor-Leste datasets.

⚠️ **One negative is weaker than the others and is flagged where it appears:** in §8, automated web
search was substantially blocked during compilation, so "no website found" means "not found by domain
probing and site search", **not "proven absent"**.

# Document repository

Source documents referenced here — national plans, guidelines, survey reports — are collected in a
shared document library where redistribution is permitted. The link is in the footer once the library's
owner has confirmed it may be published.

⚠️ **Where redistribution is doubtful, this document links out rather than rehosting.** Rehosting a PDF
is republication, and licences vary: WHO material is generally CC BY-NC-SA 3.0 IGO, while government and
NGO documents differ and some are all-rights-reserved.

# On AI generation and this document's own status

The text is **drafted and updated by an AI agent** and **reviewed by a named human editor**, who takes
editorial responsibility for reviewed editions. The banner at the top of the page states which of those
is true of the edition you are reading, and **flags in words when the text has changed since the last
human review** — which, by design, is a normal state for this document rather than an exceptional one.

This is stated for two reasons. The first is that it is the honest thing to do, and the genre's real
convention is not a chapter list but that a document tells you how much to trust it. The second is that
the **EU AI Act's Article 50(4) transparency obligation became applicable on 2 August 2026**, covering
AI-generated text that informs the public on matters of public interest, with an exemption route via
human review and editorial responsibility. Whether it binds this document is not settled — it is written
from Singapore about Timor-Leste — but EU-funded programmes and European organisations are a real part of
the audience, and it is the most concrete published standard that exists.

⚠️ **The disclosure is generated automatically from the document's own metadata, not written by hand.**
A sentence a human has to remember to update is a sentence that will eventually be false, and on this
document a false disclosure would discredit everything else.
