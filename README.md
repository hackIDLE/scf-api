# SCF API

Static JSON API for the [Secure Controls Framework](https://securecontrolsframework.com) (SCF).

Parses the official SCF Excel workbook and generates a complete static API — every sheet, every column. Hosted on GitHub Pages, automated with GitHub Actions.

**Live:** https://hackidle.github.io/scf-api/

## What's in it

| Resource | Count | Endpoint |
|---|---|---|
| Controls | 1,468 | `api/controls/{ID}.json` |
| Families | 33 | `api/families/{CODE}.json` |
| Framework crosswalks | 249 | `api/crosswalks/{FW_ID}.json` |
| Assessment objectives | 5,776 | `api/assessment-objectives/{SCF_ID}.json` |
| Compensating controls | 1,305 | `api/compensating-controls/{SCF_ID}.json` |
| Evidence requests | 303 | `api/evidence-requests/{ERL_ID}.json` |
| Privacy principles | 258 | `api/privacy-principles.json` |
| Threats | 41 | `api/threats/{ID}.json` |
| Risks | 39 | `api/risks/{ID}.json` |

Each control includes full metadata: description, assessment question, weight, conformity cadence, PPTDF applicability, NIST CSF function, SCRM focus tiers, SCR-CMM maturity levels (0-5), SCF profiles, possible solutions by org size, risk IDs, threat IDs, evidence request refs, and crosswalk mappings to all 249 frameworks.

## For agents

- [`llms.txt`](https://hackidle.github.io/scf-api/llms.txt) — index
- [`llms-full.txt`](https://hackidle.github.io/scf-api/llms-full.txt) — complete documentation in one file
- [`api/docs.md`](https://hackidle.github.io/scf-api/api/docs.md) — endpoint reference with examples

Follows the [llms.txt standard](https://llmstxt.org).

## Examples

```bash
# All controls
curl https://hackidle.github.io/scf-api/api/controls.json

# Single control with all metadata and crosswalks
curl https://hackidle.github.io/scf-api/api/controls/GOV-01.json

# Framework index (get valid framework IDs)
curl https://hackidle.github.io/scf-api/api/crosswalks.json

# NIST 800-53 crosswalk
curl https://hackidle.github.io/scf-api/api/crosswalks/general-nist-800-53-r5-2.json

# Assessment objectives for a control
curl https://hackidle.github.io/scf-api/api/assessment-objectives/GOV-01.json

# Evidence request
curl https://hackidle.github.io/scf-api/api/evidence-requests/E-GOV-01.json

# Threat catalog
curl https://hackidle.github.io/scf-api/api/threats.json
```

## Rebuilding

```bash
npm ci
npm run parse -- --tag 2026.1   # or --file path/to/workbook.xlsx
npm run build
```

The parser extracts all 10 sheets from the SCF workbook into `data/`, then `npm run build` generates the static API in `docs/`.

## Automation

Two GitHub Actions workflows:

- **`update-scf.yml`** — weekly check for new SCF releases. Downloads the workbook, parses, builds, opens a PR.
- **`release.yml`** — when `.scf-version` changes on main, tags the commit and creates a GitHub release mirroring the SCF version.

## CORS

GitHub Pages doesn't set CORS headers. Works for CLI tools, agents, and server-side code. Browser JS on another origin needs a proxy.

## License

SCF data is from [securecontrolsframework.com](https://securecontrolsframework.com), licensed under CC BY-ND.
