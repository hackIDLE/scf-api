import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";

const OUT = "docs";
const DATA = "data";

// ── Load source data ──

function resolveScfDataFile() {
  const candidates = readdirSync(DATA)
    .filter((n) => /^scf-\d/.test(n) && n.endsWith(".json"))
    .sort();
  if (candidates.length === 0) {
    console.error(`No versioned SCF data files found in ${DATA}/`);
    process.exit(1);
  }
  if (existsSync(".scf-version")) {
    const v = readFileSync(".scf-version", "utf-8").trim();
    const f = `scf-${v.replace(/\./g, "-")}.json`;
    if (candidates.includes(f)) return f;
    console.warn(`Warning: .scf-version points to ${v}, but ${f} not found.`);
  }
  if (candidates.length === 1) return candidates[0];
  console.error(`Could not resolve SCF data file: ${candidates.join(", ")}`);
  process.exit(1);
}

const scfData = JSON.parse(readFileSync(join(DATA, resolveScfDataFile()), "utf-8"));
const mainCrosswalks = JSON.parse(readFileSync(join(DATA, "scf-crosswalks.json"), "utf-8"));
const DISPLAY_NAMES = mainCrosswalks.metadata?.framework_display_names ?? {};

// Load additional data files
function loadData(filename) {
  const path = join(DATA, filename);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

const threatsData = loadData("scf-threats.json");
const risksData = loadData("scf-risks.json");
const aoData = loadData("scf-assessment-objectives.json");
const erlData = loadData("scf-evidence-requests.json");
const ccData = loadData("scf-compensating-controls.json");
const privacyData = loadData("scf-privacy-principles.json");

// ── Build crosswalk registry ──

const crosswalkRegistry = new Map();
for (const fwId of Object.keys(mainCrosswalks.scf_to_framework)) {
  crosswalkRegistry.set(fwId, {
    framework_id: fwId,
    display_name: DISPLAY_NAMES[fwId] ?? fwId,
    scf_to_framework: mainCrosswalks.scf_to_framework[fwId],
    framework_to_scf: mainCrosswalks.framework_to_scf[fwId] ?? {},
  });
}

// Per-control crosswalk index
const controlCrosswalks = new Map();
for (const [fwId, cw] of crosswalkRegistry) {
  for (const [controlId, mappedIds] of Object.entries(cw.scf_to_framework)) {
    const existing = controlCrosswalks.get(controlId) ?? {};
    existing[fwId] = mappedIds;
    controlCrosswalks.set(controlId, existing);
  }
}

// ── Build indexes ──

function enrichControl(c) {
  return { ...c, family_name: scfData.families[c.family] ?? c.family, crosswalks: controlCrosswalks.get(c.control_id) ?? {} };
}

const controlsByFamily = new Map();
for (const c of scfData.controls) {
  const arr = controlsByFamily.get(c.family) ?? [];
  arr.push(c);
  controlsByFamily.set(c.family, arr);
}

// Assessment objectives indexed by control
const aoByControl = new Map();
if (aoData) {
  for (const ao of aoData.assessment_objectives) {
    const arr = aoByControl.get(ao.scf_control_id) ?? [];
    arr.push(ao);
    aoByControl.set(ao.scf_control_id, arr);
  }
}

// Compensating controls indexed by control
const ccByControl = new Map();
if (ccData) {
  for (const cc of ccData.compensating_controls) {
    ccByControl.set(cc.control_id, cc);
  }
}

// Evidence requests indexed by ERL ID
const erlById = new Map();
if (erlData) {
  for (const erl of erlData.evidence_requests) {
    erlById.set(erl.erl_id, erl);
  }
}

// ── Output helpers ──

function writeJSON(path, data) {
  const full = join(OUT, path);
  mkdirSync(full.substring(0, full.lastIndexOf("/")), { recursive: true });
  writeFileSync(full, JSON.stringify(data, null, 2));
}
function writeText(path, content) {
  const full = join(OUT, path);
  mkdirSync(full.substring(0, full.lastIndexOf("/")), { recursive: true });
  writeFileSync(full, content);
}

// ── Clean + build ──

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ── Controls ──

const allControls = scfData.controls.map(enrichControl);
writeJSON("api/controls.json", { total: allControls.length, controls: allControls });
console.log(`  controls.json: ${allControls.length} controls`);

mkdirSync(join(OUT, "api/controls"), { recursive: true });
for (const control of allControls) {
  writeJSON(`api/controls/${control.control_id}.json`, control);
}
console.log(`  controls/: ${allControls.length} individual files`);

// ── Families ──

const familiesList = Object.entries(scfData.families)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([code, name]) => ({
    family_code: code,
    family_name: name,
    control_count: controlsByFamily.get(code)?.length ?? 0,
  }));

writeJSON("api/families.json", {
  total_families: familiesList.length,
  total_controls: scfData.controls.length,
  families: familiesList,
});

mkdirSync(join(OUT, "api/families"), { recursive: true });
for (const fam of familiesList) {
  const controls = (controlsByFamily.get(fam.family_code) ?? []).map(enrichControl);
  writeJSON(`api/families/${fam.family_code}.json`, {
    family_code: fam.family_code,
    family_name: fam.family_name,
    control_count: controls.length,
    controls,
  });
}
console.log(`  families/: ${familiesList.length} families`);

// ── Crosswalks ──

const frameworksList = Array.from(crosswalkRegistry.values())
  .sort((a, b) => a.framework_id.localeCompare(b.framework_id))
  .map((cw) => ({
    framework_id: cw.framework_id,
    display_name: cw.display_name,
    scf_controls_mapped: Object.keys(cw.scf_to_framework).length,
    framework_controls_mapped: Object.keys(cw.framework_to_scf).length,
  }));

writeJSON("api/crosswalks.json", { total_frameworks: frameworksList.length, frameworks: frameworksList });

mkdirSync(join(OUT, "api/crosswalks"), { recursive: true });
for (const [fwId, cw] of crosswalkRegistry) {
  writeJSON(`api/crosswalks/${fwId}.json`, {
    framework_id: cw.framework_id,
    display_name: cw.display_name,
    scf_to_framework: { total_mappings: Object.keys(cw.scf_to_framework).length, mappings: cw.scf_to_framework },
    framework_to_scf: { total_mappings: Object.keys(cw.framework_to_scf).length, mappings: cw.framework_to_scf },
  });
}
console.log(`  crosswalks/: ${frameworksList.length} frameworks`);

// ── Threats ──

if (threatsData) {
  writeJSON("api/threats.json", threatsData);
  mkdirSync(join(OUT, "api/threats"), { recursive: true });
  for (const t of threatsData.threats) {
    writeJSON(`api/threats/${t.threat_id}.json`, t);
  }
  console.log(`  threats/: ${threatsData.total} threats`);
}

// ── Risks ──

if (risksData) {
  writeJSON("api/risks.json", risksData);
  mkdirSync(join(OUT, "api/risks"), { recursive: true });
  for (const r of risksData.risks) {
    writeJSON(`api/risks/${r.risk_id}.json`, r);
  }
  console.log(`  risks/: ${risksData.total} risks`);
}

// ── Assessment Objectives ──

if (aoData) {
  writeJSON("api/assessment-objectives.json", aoData);
  // Per-control AO files
  mkdirSync(join(OUT, "api/assessment-objectives"), { recursive: true });
  for (const [controlId, aos] of aoByControl) {
    writeJSON(`api/assessment-objectives/${controlId}.json`, {
      scf_control_id: controlId,
      total: aos.length,
      assessment_objectives: aos,
    });
  }
  console.log(`  assessment-objectives/: ${aoByControl.size} control files (${aoData.total} total AOs)`);
}

// ── Evidence Requests ──

if (erlData) {
  writeJSON("api/evidence-requests.json", erlData);
  mkdirSync(join(OUT, "api/evidence-requests"), { recursive: true });
  for (const erl of erlData.evidence_requests) {
    writeJSON(`api/evidence-requests/${erl.erl_id}.json`, erl);
  }
  console.log(`  evidence-requests/: ${erlData.total} items`);
}

// ── Compensating Controls ──

if (ccData) {
  writeJSON("api/compensating-controls.json", ccData);
  mkdirSync(join(OUT, "api/compensating-controls"), { recursive: true });
  for (const cc of ccData.compensating_controls) {
    writeJSON(`api/compensating-controls/${cc.control_id}.json`, cc);
  }
  console.log(`  compensating-controls/: ${ccData.total} items`);
}

// ── Privacy Principles ──

if (privacyData) {
  writeJSON("api/privacy-principles.json", privacyData);
  console.log(`  privacy-principles.json: ${privacyData.total} principles`);
}

// ── Summary ──

const weightDistribution = {};
for (let i = 0; i <= 10; i++) weightDistribution[i] = 0;
for (const c of scfData.controls) {
  weightDistribution[c.relative_weight] = (weightDistribution[c.relative_weight] ?? 0) + 1;
}

writeJSON("api/summary.json", {
  scf_version: scfData.framework.version,
  total_controls: scfData.controls.length,
  total_families: familiesList.length,
  families: familiesList,
  crosswalk_frameworks: frameworksList,
  total_threats: threatsData?.total ?? 0,
  total_risks: risksData?.total ?? 0,
  total_assessment_objectives: aoData?.total ?? 0,
  total_evidence_requests: erlData?.total ?? 0,
  total_compensating_controls: ccData?.total ?? 0,
  total_privacy_principles: privacyData?.total ?? 0,
  weight_distribution: weightDistribution,
});
console.log(`  summary.json`);

// ── Sample data for docs ──

const sampleControl = allControls.find((c) => c.control_id === "GOV-01") ?? allControls[0];
const PREFERRED_SAMPLES = ["general-nist-800-53-r5-2", "general-iso-27001-2022", "general-nist-csf-2-0"];
const sampleCrosswalkId =
  PREFERRED_SAMPLES.find((id) => crosswalkRegistry.get(id)?.scf_to_framework[sampleControl?.control_id ?? ""]) ??
  frameworksList[0]?.framework_id ?? "example";
const sampleCrosswalkEntry = crosswalkRegistry.get(sampleCrosswalkId);

const sampleControlJson = JSON.stringify({
  control_id: sampleControl.control_id,
  title: sampleControl.title,
  family: sampleControl.family,
  family_name: sampleControl.family_name,
  description: sampleControl.description,
  scf_question: sampleControl.scf_question,
  relative_weight: sampleControl.relative_weight,
  conformity_cadence: sampleControl.conformity_cadence,
  pptdf: sampleControl.pptdf,
  nist_csf_function: sampleControl.nist_csf_function,
  scrm_focus: sampleControl.scrm_focus,
  risks: sampleControl.risks?.slice(0, 3),
  threats: sampleControl.threats?.slice(0, 3),
  profiles: sampleControl.profiles,
  crosswalks: Object.fromEntries(Object.entries(sampleControl.crosswalks).slice(0, 2)),
}, null, 2);

const sampleCrosswalkJson = JSON.stringify({
  framework_id: sampleCrosswalkId,
  display_name: sampleCrosswalkEntry?.display_name ?? "",
  scf_to_framework: {
    total_mappings: Object.keys(sampleCrosswalkEntry?.scf_to_framework ?? {}).length,
    mappings: Object.fromEntries(Object.entries(sampleCrosswalkEntry?.scf_to_framework ?? {}).slice(0, 2)),
  },
  framework_to_scf: {
    total_mappings: Object.keys(sampleCrosswalkEntry?.framework_to_scf ?? {}).length,
    mappings: Object.fromEntries(Object.entries(sampleCrosswalkEntry?.framework_to_scf ?? {}).slice(0, 2)),
  },
}, null, 2);

// ── Shared API reference body ──

const apiRefBody = `## Endpoints

### Controls

\`GET api/controls.json\` — All ${allControls.length} controls with full metadata and crosswalks.

\`GET api/controls/{ID}.json\` — Single control (e.g., GOV-01, CRY-05.3).

Example response (truncated):

\`\`\`json
${sampleControlJson}
\`\`\`

Each control includes: ID, title, family, description, assessment question, weight (0-10), conformity cadence, PPTDF applicability, NIST CSF function, SCRM focus tiers, SCR-CMM maturity levels (0-5), SCF profiles, possible solutions by org size, risk IDs, threat IDs, evidence request refs, and crosswalk mappings to all ${frameworksList.length} frameworks.

### Families

\`GET api/families.json\` — All ${familiesList.length} families with control counts.

\`GET api/families/{CODE}.json\` — Family detail with all controls. Codes: ${familiesList.map((f) => `\`${f.family_code}\``).join(", ")}

### Crosswalks

\`GET api/crosswalks.json\` — Index of all ${frameworksList.length} frameworks with coverage stats.

\`GET api/crosswalks/{FRAMEWORK_ID}.json\` — Bidirectional crosswalk (truncated):

\`\`\`json
${sampleCrosswalkJson}
\`\`\`

### Threats

\`GET api/threats.json\` — All ${threatsData?.total ?? 0} threats (natural + man-made).

\`GET api/threats/{ID}.json\` — Single threat (e.g., NT-1, MT-1). Fields: threat_id, grouping, name, description.

### Risks

\`GET api/risks.json\` — All ${risksData?.total ?? 0} risks with NIST CSF function mapping.

\`GET api/risks/{ID}.json\` — Single risk (e.g., R-AC-1). Fields: risk_id, grouping, name, description, nist_csf_function.

### Assessment Objectives

\`GET api/assessment-objectives.json\` — All ${aoData?.total ?? 0} assessment objectives.

\`GET api/assessment-objectives/{SCF_ID}.json\` — AOs for a specific control. Fields: ao_id, objective, pptdf, origin, assessment_rigor, scf/org defined parameters.

### Evidence Requests

\`GET api/evidence-requests.json\` — All ${erlData?.total ?? 0} evidence request items.

\`GET api/evidence-requests/{ERL_ID}.json\` — Single item (e.g., E-GOV-01). Fields: erl_id, area, artifact_name, artifact_description, scf_controls, cmmc_mapping.

### Compensating Controls

\`GET api/compensating-controls.json\` — All ${ccData?.total ?? 0} compensating control entries.

\`GET api/compensating-controls/{SCF_ID}.json\` — Compensating controls for a specific control. Includes risk if not implemented and up to 2 compensating controls with justification.

### Privacy Principles

\`GET api/privacy-principles.json\` — All ${privacyData?.total ?? 0} SCF data privacy management principles with crosswalks to 32 privacy frameworks.

### Summary

\`GET api/summary.json\` — Version, counts for all resource types, weight distribution.

## Workflows

### Full assessment picture for a control

\`\`\`
GET api/controls/GOV-01.json → control metadata, risks, threats, crosswalks
GET api/assessment-objectives/GOV-01.json → assessment objectives
GET api/compensating-controls/GOV-01.json → compensating controls if primary fails
\`\`\`

### Map a framework control back to SCF

\`\`\`
GET api/crosswalks/${sampleCrosswalkId}.json → .framework_to_scf.mappings["PM-01"]
\`\`\`

### Understand a risk and which controls address it

\`\`\`
GET api/risks/R-AC-1.json → risk details
GET api/controls.json → filter controls where .risks includes "R-AC-1"
\`\`\`

### Evidence collection for an audit

\`\`\`
GET api/controls/GOV-01.json → .evidence_requests → ["E-GOV-01", "E-GOV-02"]
GET api/evidence-requests/E-GOV-01.json → artifact details
\`\`\`

### Compare coverage across frameworks

\`\`\`
GET api/crosswalks.json → compare scf_controls_mapped across frameworks
\`\`\`

## Caveats

- **Versioning:** SCF v${scfData.framework.version}. Check \`api/summary.json\`.
- **Licensing:** CC BY-ND. Share and use freely, but no derivative works of the framework itself.
- **Missing mappings:** No crosswalk entry = no established mapping, not irrelevance.
- **Framework IDs:** Source-derived from the SCF workbook. Use exact IDs from \`api/crosswalks.json\`.
- **Static data:** No server-side filtering. Download and filter client-side.
- **404s:** Invalid IDs return GitHub Pages' default 404.`;

// ── llms.txt ──

const llmsTxt = `# SCF API

> Source-faithful static JSON API for the Secure Controls Framework (SCF) v${scfData.framework.version}. ${scfData.controls.length} controls, ${familiesList.length} families, ${frameworksList.length} framework crosswalks, ${threatsData?.total ?? 0} threats, ${risksData?.total ?? 0} risks, ${aoData?.total ?? 0} assessment objectives, and ${erlData?.total ?? 0} evidence requests. All static JSON, no auth required.

All data is static JSON. Append paths to the base URL.

- \`api/controls/{ID}.json\` — single control (e.g., GOV-01)
- \`api/families/{CODE}.json\` — family detail (e.g., GOV)
- \`api/crosswalks/{FW_ID}.json\` — bidirectional crosswalk
- \`api/threats/{ID}.json\` — single threat (e.g., NT-1)
- \`api/risks/{ID}.json\` — single risk (e.g., R-AC-1)
- \`api/assessment-objectives/{SCF_ID}.json\` — AOs for a control
- \`api/evidence-requests/{ERL_ID}.json\` — evidence request (e.g., E-GOV-01)
- \`api/compensating-controls/{SCF_ID}.json\` — compensating controls

## Endpoints

- [Summary](api/summary.json): Version, all counts, weight distribution.
- [Controls](api/controls.json): All controls with full metadata and crosswalks.
- [Families](api/families.json): Family index.
- [Crosswalks](api/crosswalks.json): Framework index with ${frameworksList.length} frameworks.
- [Threats](api/threats.json): Threat catalog.
- [Risks](api/risks.json): Risk catalog.
- [Assessment Objectives](api/assessment-objectives.json): All assessment objectives.
- [Evidence Requests](api/evidence-requests.json): Evidence request list.
- [Compensating Controls](api/compensating-controls.json): Compensating control guidance.
- [Privacy Principles](api/privacy-principles.json): Data privacy management principles.

## Documentation

- [API Reference](api/docs.md): Endpoint reference with schemas and examples.
- [Complete Documentation](llms-full.txt): Everything in one file.

## Optional

- [Framework Index](api/crosswalks.json): Discover all ${frameworksList.length} framework IDs.
`;

writeText("llms.txt", llmsTxt);
console.log(`  llms.txt`);

// ── llms-full.txt ──

const frameworkLines = frameworksList
  .map((fw) => `- [${fw.display_name}](api/crosswalks/${fw.framework_id}.json): ${fw.scf_controls_mapped} SCF controls mapped, ${fw.framework_controls_mapped} framework controls.`)
  .join("\n");

const llmsFullTxt = `# SCF API

> Source-faithful static JSON API for the Secure Controls Framework (SCF) v${scfData.framework.version}. ${scfData.controls.length} controls, ${familiesList.length} families, ${frameworksList.length} framework crosswalks, ${threatsData?.total ?? 0} threats, ${risksData?.total ?? 0} risks, ${aoData?.total ?? 0} assessment objectives, and ${erlData?.total ?? 0} evidence requests. All static JSON, no auth required.

${apiRefBody}

## Frameworks (${frameworksList.length})

${frameworkLines}
`;

writeText("llms-full.txt", llmsFullTxt);
console.log(`  llms-full.txt`);

// ── api/docs.md ──

const docsMd = `# SCF API Reference

Static JSON API for the [Secure Controls Framework](https://securecontrolsframework.com) (SCF) v${scfData.framework.version}.

- **${scfData.controls.length}** controls across **${familiesList.length}** families
- **${frameworksList.length}** framework crosswalks
- **${threatsData?.total ?? 0}** threats, **${risksData?.total ?? 0}** risks
- **${aoData?.total ?? 0}** assessment objectives, **${erlData?.total ?? 0}** evidence requests
- **${ccData?.total ?? 0}** compensating controls, **${privacyData?.total ?? 0}** privacy principles
- All static JSON, no auth, CC BY-ND.

${apiRefBody}
`;

writeText("api/docs.md", docsMd);
console.log(`  api/docs.md`);

// ── index.html ──

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SCF API</title>
  <meta name="description" content="Static JSON API for the Secure Controls Framework. ${scfData.controls.length} controls, ${familiesList.length} families, ${frameworksList.length} framework crosswalks." />
  <style>
    body { font-family: system-ui, sans-serif; background: #1e1e2e; color: #cdd6f4; max-width: 600px; margin: 0 auto; padding: 2rem 1rem; line-height: 1.6; }
    h1 { color: #cdd6f4; font-size: 1.3rem; margin-bottom: 0.5rem; }
    h2 { color: #a6adc8; font-size: 0.9rem; margin-top: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #a6adc8; margin-bottom: 0.75rem; font-size: 0.9rem; }
    a { color: #89b4fa; }
    a:hover { color: #b4befe; }
    code { color: #a6e3a1; font-size: 0.85em; }
    ul { padding-left: 1.2rem; margin: 0; }
    li { margin-bottom: 0.25rem; font-size: 0.9rem; }
    .sub { color: #6c7086; font-size: 0.8rem; margin-top: 2rem; }
    .sub a { color: #6c7086; }
    .sub a:hover { color: #89b4fa; }
  </style>
</head>
<body>
  <h1>SCF API</h1>
  <p>${scfData.controls.length} controls, ${familiesList.length} families, ${frameworksList.length} crosswalks, ${threatsData?.total ?? 0} threats, ${risksData?.total ?? 0} risks, ${aoData?.total ?? 0} assessment objectives. Static JSON from the <a href="https://securecontrolsframework.com">Secure Controls Framework</a>.</p>

  <h2>Agents</h2>
  <ul>
    <li><a href="llms.txt">llms.txt</a></li>
    <li><a href="llms-full.txt">llms-full.txt</a></li>
    <li><a href="api/docs.md">api/docs.md</a></li>
  </ul>

  <h2>Endpoints</h2>
  <ul>
    <li><a href="api/summary.json"><code>summary</code></a></li>
    <li><a href="api/controls.json"><code>controls</code></a> &middot; <a href="api/controls/GOV-01.json"><code>controls/{ID}</code></a></li>
    <li><a href="api/families.json"><code>families</code></a> &middot; <a href="api/families/GOV.json"><code>families/{CODE}</code></a></li>
    <li><a href="api/crosswalks.json"><code>crosswalks</code></a> &middot; <a href="api/crosswalks/${sampleCrosswalkId}.json"><code>crosswalks/{FW}</code></a></li>
    <li><a href="api/threats.json"><code>threats</code></a> &middot; <a href="api/threats/NT-1.json"><code>threats/{ID}</code></a></li>
    <li><a href="api/risks.json"><code>risks</code></a> &middot; <a href="api/risks/R-AC-1.json"><code>risks/{ID}</code></a></li>
    <li><a href="api/assessment-objectives.json"><code>assessment-objectives</code></a> &middot; <a href="api/assessment-objectives/GOV-01.json"><code>assessment-objectives/{SCF_ID}</code></a></li>
    <li><a href="api/evidence-requests.json"><code>evidence-requests</code></a> &middot; <a href="api/evidence-requests/E-GOV-01.json"><code>evidence-requests/{ERL_ID}</code></a></li>
    <li><a href="api/compensating-controls.json"><code>compensating-controls</code></a> &middot; <a href="api/compensating-controls/GOV-01.1.json"><code>compensating-controls/{SCF_ID}</code></a></li>
    <li><a href="api/privacy-principles.json"><code>privacy-principles</code></a></li>
  </ul>

  <p class="sub">SCF v${scfData.framework.version} &middot; CC BY-ND &middot; <a href="https://github.com/hackIDLE/scf-api">hackIDLE</a></p>
</body>
</html>`;

writeText("index.html", html);
console.log(`  index.html`);

writeText(".nojekyll", "");
console.log(`\nBuild complete. Output in ${OUT}/`);
