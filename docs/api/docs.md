# SCF API Reference

Static JSON API for the [Secure Controls Framework](https://securecontrolsframework.com) (SCF) v2026.1.

- **1468** controls across **33** families
- **249** framework crosswalks
- **41** threats, **39** risks
- **5776** assessment objectives, **303** evidence requests
- **1305** compensating controls, **258** privacy principles
- All static JSON, no auth, CC BY-ND.

## Endpoints

### Controls

`GET api/controls.json` — All 1468 controls with full metadata and crosswalks.

`GET api/controls/{ID}.json` — Single control (e.g., GOV-01, CRY-05.3).

Example response (truncated):

```json
{
  "control_id": "GOV-01",
  "title": "Security, Compliance & Resilience Program (SCRP)",
  "family": "GOV",
  "family_name": "Cybersecurity & Data Protection Governance",
  "description": "Mechanisms exist to facilitate the implementation of security, compliance and resilience governance controls.",
  "scf_question": "Does the organization facilitate the implementation of security, compliance and resilience governance controls?",
  "relative_weight": 10,
  "conformity_cadence": "Annual",
  "pptdf": "Process",
  "nist_csf_function": "Govern",
  "scrm_focus": {
    "strategic": true,
    "operational": true,
    "tactical": true
  },
  "risks": [
    "R-AC-1",
    "R-AC-2",
    "R-AC-3"
  ],
  "threats": [
    "NT-7",
    "MT-1",
    "MT-2"
  ],
  "profiles": [
    "SCRMS",
    "CORE AI Model Deployment",
    "CORE ESP Level 1 Foundational",
    "CORE ESP Level 2 Critical Infrastructure",
    "CORE ESP Level 3 Advanced Threats",
    "CORE Mergers, Acquisitions & Divestitures (MA&D)"
  ],
  "crosswalks": {
    "general-aicpa-pmf-2020": [
      "M1.2-POF6"
    ],
    "general-aicpa-tsc-2017": [
      "CC1.1",
      "CC1.1-POF1",
      "CC1.2",
      "CC2.3-POF5"
    ]
  }
}
```

Each control includes: ID, title, family, description, assessment question, weight (0-10), conformity cadence, PPTDF applicability, NIST CSF function, SCRM focus tiers, SCR-CMM maturity levels (0-5), SCF profiles, possible solutions by org size, risk IDs, threat IDs, evidence request refs, and crosswalk mappings to all 249 frameworks.

### Families

`GET api/families.json` — All 33 families with control counts.

`GET api/families/{CODE}.json` — Family detail with all controls. Codes: `AAT`, `AST`, `BCD`, `CAP`, `CFG`, `CHG`, `CLD`, `CPL`, `CRY`, `DCH`, `EMB`, `END`, `GOV`, `HRS`, `IAC`, `IAO`, `IRO`, `MDM`, `MNT`, `MON`, `NET`, `OPS`, `PES`, `PRI`, `PRM`, `RSK`, `SAT`, `SEA`, `TDA`, `THR`, `TPM`, `VPM`, `WEB`

### Crosswalks

`GET api/crosswalks.json` — Index of all 249 frameworks with coverage stats.

`GET api/crosswalks/{FRAMEWORK_ID}.json` — Bidirectional crosswalk (truncated):

```json
{
  "framework_id": "general-nist-800-53-r5-2",
  "display_name": "NIST SP 800-53 R5",
  "scf_to_framework": {
    "total_mappings": 777,
    "mappings": {
      "GOV-01": [
        "PM-01"
      ],
      "GOV-02": [
        "AC-01",
        "AT-01",
        "AU-01",
        "CA-01",
        "CM-01",
        "CP-01",
        "IA-01",
        "IR-01",
        "MA-01",
        "MP-01",
        "PE-01",
        "PL-01",
        "PM-01",
        "PS-01",
        "PT-01",
        "RA-01",
        "SA-01",
        "SC-01",
        "SI-01",
        "SR-01"
      ]
    }
  },
  "framework_to_scf": {
    "total_mappings": 810,
    "mappings": {
      "PM-01": [
        "GOV-01",
        "GOV-02",
        "GOV-03"
      ],
      "AC-01": [
        "GOV-02",
        "GOV-03",
        "IAC-01"
      ]
    }
  }
}
```

### Threats

`GET api/threats.json` — All 41 threats (natural + man-made).

`GET api/threats/{ID}.json` — Single threat (e.g., NT-1, MT-1). Fields: threat_id, grouping, name, description.

### Risks

`GET api/risks.json` — All 39 risks with NIST CSF function mapping.

`GET api/risks/{ID}.json` — Single risk (e.g., R-AC-1). Fields: risk_id, grouping, name, description, nist_csf_function.

### Assessment Objectives

`GET api/assessment-objectives.json` — All 5776 assessment objectives.

`GET api/assessment-objectives/{SCF_ID}.json` — AOs for a specific control. Fields: ao_id, objective, pptdf, origin, assessment_rigor, scf/org defined parameters.

### Evidence Requests

`GET api/evidence-requests.json` — All 303 evidence request items.

`GET api/evidence-requests/{ERL_ID}.json` — Single item (e.g., E-GOV-01). Fields: erl_id, area, artifact_name, artifact_description, scf_controls, cmmc_mapping.

### Compensating Controls

`GET api/compensating-controls.json` — All 1305 compensating control entries.

`GET api/compensating-controls/{SCF_ID}.json` — Compensating controls for a specific control. Includes risk if not implemented and up to 2 compensating controls with justification.

### Privacy Principles

`GET api/privacy-principles.json` — All 258 SCF data privacy management principles with crosswalks to 32 privacy frameworks.

### Summary

`GET api/summary.json` — Version, counts for all resource types, weight distribution.

## Workflows

### Full assessment picture for a control

```
GET api/controls/GOV-01.json → control metadata, risks, threats, crosswalks
GET api/assessment-objectives/GOV-01.json → assessment objectives
GET api/compensating-controls/GOV-01.json → compensating controls if primary fails
```

### Map a framework control back to SCF

```
GET api/crosswalks/general-nist-800-53-r5-2.json → .framework_to_scf.mappings["PM-01"]
```

### Understand a risk and which controls address it

```
GET api/risks/R-AC-1.json → risk details
GET api/controls.json → filter controls where .risks includes "R-AC-1"
```

### Evidence collection for an audit

```
GET api/controls/GOV-01.json → .evidence_requests → ["E-GOV-01", "E-GOV-02"]
GET api/evidence-requests/E-GOV-01.json → artifact details
```

### Compare coverage across frameworks

```
GET api/crosswalks.json → compare scf_controls_mapped across frameworks
```

## Caveats

- **Versioning:** SCF v2026.1. Check `api/summary.json`.
- **Licensing:** CC BY-ND. Share and use freely, but no derivative works of the framework itself.
- **Missing mappings:** No crosswalk entry = no established mapping, not irrelevance.
- **Framework IDs:** Source-derived from the SCF workbook. Use exact IDs from `api/crosswalks.json`.
- **Static data:** No server-side filtering. Download and filter client-side.
- **404s:** Invalid IDs return GitHub Pages' default 404.
