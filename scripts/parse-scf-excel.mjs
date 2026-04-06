#!/usr/bin/env node

import { mkdtempSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import ExcelJS from "exceljs";

const DATA = "data";

// ── CLI args ──

const args = process.argv.slice(2);
let filePath = null;
let tag = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--file" && args[i + 1]) filePath = args[++i];
  if (args[i] === "--tag" && args[i + 1]) tag = args[++i];
}

if (!filePath && !tag) {
  console.error("Usage: parse-scf-excel.mjs --tag <version> | --file <path>");
  process.exit(1);
}

if (tag && !/^[\w.\-]+$/.test(tag)) {
  console.error(`Invalid tag format: ${tag}`);
  process.exit(1);
}

// ── Download ──

if (tag && !filePath) {
  console.log(`Downloading SCF ${tag} Excel from GitHub...`);
  const downloadDir = mkdtempSync(join(tmpdir(), "scf-release-"));
  execSync(
    `gh release download ${tag} --repo securecontrolsframework/securecontrolsframework --pattern "*.xlsx" --dir "${downloadDir}" --clobber`,
    { stdio: "inherit" }
  );

  const downloadedFiles = readdirSync(downloadDir).filter((f) =>
    f.toLowerCase().endsWith(".xlsx")
  );
  if (downloadedFiles.length === 0) {
    console.error(`No .xlsx file found after download in ${downloadDir}`);
    process.exit(1);
  }

  const tagHint = tag.toLowerCase().replace(/\./g, "-");
  const tagMatches = downloadedFiles.filter((f) =>
    f.toLowerCase().includes(tagHint)
  );
  const candidates = tagMatches.length === 1 ? tagMatches : downloadedFiles;

  if (candidates.length !== 1) {
    console.error(`Expected exactly one workbook for tag ${tag}, found: ${downloadedFiles.join(", ")}`);
    process.exit(1);
  }
  filePath = join(downloadDir, candidates[0]);
}

// ── Read workbook ──

console.log(`Reading ${filePath}...`);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(filePath);
console.log(`Sheets: ${workbook.worksheets.map((ws) => ws.name).join(", ")}`);

// ── Helpers ──

function cellStr(cell) {
  if (cell == null) return "";
  const v = cell.value ?? cell;
  if (v == null) return "";
  if (typeof v === "object" && v.richText)
    return v.richText.map((r) => r.text).join("");
  if (typeof v === "object" && v.result != null) return String(v.result);
  return String(v);
}

function splitLines(s) {
  return [...new Set(s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean))];
}

function buildHeaderMap(sheet) {
  const map = {};
  const row = sheet.getRow(1);
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = cellStr(cell).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
    if (h) map[h] = col;
  });
  return map;
}

function findCol(headers, name) {
  if (headers[name] !== undefined) return headers[name];
  const lower = name.toLowerCase();
  const match = Object.keys(headers).find((h) => h.toLowerCase().includes(lower));
  if (match !== undefined) return headers[match];
  console.error(`Column "${name}" not found. Available: ${Object.keys(headers).slice(0, 15).join(", ")}...`);
  process.exit(1);
}

// ── Find main sheet ──

const mainSheet = workbook.worksheets.find(
  (ws) => ws.name.startsWith("SCF ") && /\d/.test(ws.name)
);
if (!mainSheet) { console.error("Main SCF sheet not found"); process.exit(1); }
const version = mainSheet.name.replace("SCF ", "").trim();
console.log(`SCF version: ${version}`);

// ── 1. Families ──

const domainsSheet = workbook.getWorksheet("SCF Domains & Principles");
if (!domainsSheet) { console.error('"SCF Domains & Principles" not found'); process.exit(1); }
const domHeaders = buildHeaderMap(domainsSheet);
const families = {};
domainsSheet.eachRow({ includeEmpty: false }, (row, num) => {
  if (num === 1) return;
  const code = cellStr(row.getCell(domHeaders["SCF Identifier"])).trim();
  const name = cellStr(row.getCell(domHeaders["SCF Domain"])).trim();
  if (code && name) families[code] = name;
});
if (Object.keys(families).length === 0) {
  console.error("No families extracted"); process.exit(1);
}
console.log(`Families: ${Object.keys(families).length}`);

// ── 2. Authoritative Sources → header-to-FDI mapping ──

const authSheet = workbook.getWorksheet("Authoritative Sources");
if (!authSheet) { console.error('"Authoritative Sources" not found'); process.exit(1); }
const authHeaders = buildHeaderMap(authSheet);
const headerToSource = new Map();

authSheet.eachRow({ includeEmpty: false }, (row, num) => {
  if (num === 1) return;
  const headerCell = cellStr(row.getCell(authHeaders["SCF Column Header"]));
  const fdi = cellStr(row.getCell(authHeaders["Focal Document Identifier (FDI)"])).trim();
  const fdn = authHeaders["Focal Document Name (FDN)"]
    ? cellStr(row.getCell(authHeaders["Focal Document Name (FDN)"])).trim() : "";
  const fdt = authHeaders["Focal Document Title (FDT)"]
    ? cellStr(row.getCell(authHeaders["Focal Document Title (FDT)"])).trim() : "";
  const displayName = fdn || fdt || fdi;
  if (!headerCell || !fdi) return;

  const raw = headerCell;
  headerToSource.set(raw, { fdi, displayName });
  const normalized = raw.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  if (!headerToSource.has(normalized))
    headerToSource.set(normalized, { fdi, displayName });
});
console.log(`Authoritative sources: ${headerToSource.size} column headers mapped`);

// ── 3. Main sheet — identify columns ──

const mainHeaders = buildHeaderMap(mainSheet);

// Crosswalk columns
const crosswalkColumns = [];
const usedApiIds = new Set();
const mainHeaderRow = mainSheet.getRow(1);
mainHeaderRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
  const rawHeader = cellStr(cell);
  if (!rawHeader.trim()) return;
  let source = headerToSource.get(rawHeader);
  if (!source) {
    const normalized = rawHeader.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
    source = headerToSource.get(normalized);
  }
  if (!source) return;

  let apiId = source.fdi.toLowerCase();
  if (usedApiIds.has(apiId)) {
    let suffix = 2;
    while (usedApiIds.has(`${apiId}-${suffix}`)) suffix++;
    apiId = `${apiId}-${suffix}`;
  }
  usedApiIds.add(apiId);
  crosswalkColumns.push({ colNumber, apiId, displayName: source.displayName, fdi: source.fdi });
});
console.log(`Crosswalk columns: ${crosswalkColumns.length}`);

// Control metadata columns
const COL_ID = findCol(mainHeaders, "SCF #");
const COL_TITLE = findCol(mainHeaders, "SCF Control");
const COL_DESC = findCol(mainHeaders, "Control Description");
const COL_QUESTION = findCol(mainHeaders, "SCF Control Question");
const COL_WEIGHT = findCol(mainHeaders, "Relative Control Weighting");
const COL_CADENCE = findCol(mainHeaders, "Conformity Validation");
const COL_ERL = findCol(mainHeaders, "Evidence Request List");
const COL_PPTDF = findCol(mainHeaders, "PPTDF");
const COL_CSF_FUNC = findCol(mainHeaders, "NIST CSF");

// Possible solutions columns (5 org sizes)
const solCols = [];
for (let c = 1; c <= mainSheet.columnCount; c++) {
  const h = cellStr(mainHeaderRow.getCell(c)).replace(/\r?\n/g, " ");
  if (h.includes("Possible Solutions")) solCols.push(c);
}

// SCRM tiers
const COL_SCRM1 = findCol(mainHeaders, "TIER 1");
const COL_SCRM2 = findCol(mainHeaders, "TIER 2");
const COL_SCRM3 = findCol(mainHeaders, "TIER 3");

// SCR-CMM maturity levels (6 columns: 0-5)
const cmmCols = [];
for (let c = 1; c <= mainSheet.columnCount; c++) {
  const h = cellStr(mainHeaderRow.getCell(c)).replace(/\r?\n/g, " ");
  if (/SCR-CMM Level \d/.test(h)) cmmCols.push(c);
}

// SCF profiles
const profileCols = [];
for (let c = 1; c <= mainSheet.columnCount; c++) {
  const h = cellStr(mainHeaderRow.getCell(c)).replace(/\r?\n/g, " ");
  if (/^SCF\s/.test(h.trim()) && (h.includes("Community") || h.includes("SCRMS") || h.includes("CORE") || h.includes("Fundamentals")))
    profileCols.push({ col: c, name: h.replace(/^SCF\s+/, "").trim() });
}

// Risk and threat summary columns (formula columns with TEXTJOIN results)
let COL_RISK_SUMMARY = null;
let COL_THREAT_SUMMARY = null;
for (let c = 1; c <= mainSheet.columnCount; c++) {
  const h = cellStr(mainHeaderRow.getCell(c)).replace(/\r?\n/g, " ").trim();
  if (h === "Risk Threat Summary" || (h.includes("Risk") && h.includes("Threat") && h.includes("Summary")))
    COL_RISK_SUMMARY = c;
  if (h === "Control Threat Summary") COL_THREAT_SUMMARY = c;
}
// Fallback: look at formula patterns in row 2
if (!COL_RISK_SUMMARY || !COL_THREAT_SUMMARY) {
  const row2 = mainSheet.getRow(2);
  for (let c = 280; c <= mainSheet.columnCount; c++) {
    const v = row2.getCell(c).value;
    if (typeof v === "object" && v?.formula) {
      if (!COL_RISK_SUMMARY && v.formula.includes("KB")) COL_RISK_SUMMARY = c;
      if (!COL_THREAT_SUMMARY && v.formula.includes("LP")) COL_THREAT_SUMMARY = c;
    }
  }
}

// Errata column
let COL_ERRATA = null;
for (let c = mainSheet.columnCount; c >= 1; c--) {
  const h = cellStr(mainHeaderRow.getCell(c)).replace(/\r?\n/g, " ").trim().toLowerCase();
  if (h.includes("errata")) { COL_ERRATA = c; break; }
}

const SOL_LABELS = ["micro_small", "small", "medium", "large", "enterprise"];

// ── 4. Extract controls + crosswalks in one pass ──

const controls = [];
const scfToFramework = {};
const frameworkToScf = {};
const displayNames = {};

for (const col of crosswalkColumns) {
  scfToFramework[col.apiId] = {};
  frameworkToScf[col.apiId] = {};
  displayNames[col.apiId] = col.displayName;
}

mainSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
  if (rowNumber === 1) return;
  const controlId = cellStr(row.getCell(COL_ID)).trim();
  if (!controlId) return;

  const family = controlId.split("-")[0];

  // Possible solutions
  const possible_solutions = {};
  solCols.forEach((c, i) => {
    const val = cellStr(row.getCell(c)).trim();
    if (val) possible_solutions[SOL_LABELS[i] ?? `size_${i}`] = val;
  });

  // SCRM tiers
  const scrm_focus = {
    strategic: cellStr(row.getCell(COL_SCRM1)).trim().toLowerCase() === "x",
    operational: cellStr(row.getCell(COL_SCRM2)).trim().toLowerCase() === "x",
    tactical: cellStr(row.getCell(COL_SCRM3)).trim().toLowerCase() === "x",
  };

  // Maturity levels
  const maturity = {};
  cmmCols.forEach((c, i) => {
    const val = cellStr(row.getCell(c)).trim();
    if (val) maturity[i] = val;
  });

  // Profiles
  const profiles = [];
  for (const pc of profileCols) {
    const val = cellStr(row.getCell(pc.col)).trim();
    if (val) profiles.push(pc.name);
  }

  // Risk and threat IDs
  const risks = COL_RISK_SUMMARY ? splitLines(cellStr(row.getCell(COL_RISK_SUMMARY))) : [];
  const threats = COL_THREAT_SUMMARY ? splitLines(cellStr(row.getCell(COL_THREAT_SUMMARY))) : [];

  // Errata
  const errata = COL_ERRATA ? cellStr(row.getCell(COL_ERRATA)).trim() : "";

  // ERL refs
  const evidence_requests = splitLines(cellStr(row.getCell(COL_ERL)));

  controls.push({
    control_id: controlId,
    title: cellStr(row.getCell(COL_TITLE)).trim(),
    family,
    description: cellStr(row.getCell(COL_DESC)).trim(),
    scf_question: cellStr(row.getCell(COL_QUESTION)).trim(),
    relative_weight: Number(row.getCell(COL_WEIGHT).value) || 0,
    conformity_cadence: cellStr(row.getCell(COL_CADENCE)).trim(),
    evidence_requests,
    pptdf: cellStr(row.getCell(COL_PPTDF)).trim(),
    nist_csf_function: cellStr(row.getCell(COL_CSF_FUNC)).trim(),
    scrm_focus,
    maturity,
    profiles,
    possible_solutions,
    risks,
    threats,
    ...(errata ? { errata } : {}),
  });

  // Crosswalk mappings
  for (const col of crosswalkColumns) {
    const raw = cellStr(row.getCell(col.colNumber));
    if (!raw.trim()) continue;
    const mappedIds = splitLines(raw);
    if (mappedIds.length === 0) continue;
    scfToFramework[col.apiId][controlId] = mappedIds;
    for (const mid of mappedIds) {
      if (!frameworkToScf[col.apiId][mid]) frameworkToScf[col.apiId][mid] = [];
      if (!frameworkToScf[col.apiId][mid].includes(controlId))
        frameworkToScf[col.apiId][mid].push(controlId);
    }
  }
});

console.log(`Controls: ${controls.length}`);

// Remove empty frameworks
for (const apiId of Object.keys(scfToFramework)) {
  if (Object.keys(scfToFramework[apiId]).length === 0) {
    delete scfToFramework[apiId];
    delete frameworkToScf[apiId];
    delete displayNames[apiId];
  }
}
console.log(`Frameworks with mappings: ${Object.keys(scfToFramework).length}`);

// ── 5. Threat Catalog ──

const threatSheet = workbook.getWorksheet("Threat Catalog");
const threats = [];
if (threatSheet) {
  // Data starts at row 8 (rows 1-7 are headers/definitions)
  threatSheet.eachRow({ includeEmpty: false }, (row, num) => {
    if (num < 8) return;
    const id = cellStr(row.getCell(2)).trim();
    if (!id || !/^[NM]T-\d/.test(id)) return;
    threats.push({
      threat_id: id,
      grouping: cellStr(row.getCell(1)).trim(),
      name: cellStr(row.getCell(3)).trim(),
      description: cellStr(row.getCell(4)).trim(),
    });
  });
}
console.log(`Threats: ${threats.length}`);

// ── 6. Risk Catalog ──

const riskSheet = workbook.getWorksheet("Risk Catalog");
const risks = [];
if (riskSheet) {
  riskSheet.eachRow({ includeEmpty: false }, (row, num) => {
    if (num < 8) return;
    const id = cellStr(row.getCell(2)).trim();
    if (!id || !/^R-/.test(id)) return;
    risks.push({
      risk_id: id,
      grouping: cellStr(row.getCell(1)).trim(),
      name: cellStr(row.getCell(3)).trim(),
      description: cellStr(row.getCell(4)).trim(),
      nist_csf_function: cellStr(row.getCell(5)).trim(),
    });
  });
}
console.log(`Risks: ${risks.length}`);

// ── 7. Assessment Objectives ──

const aoSheet = workbook.getWorksheet("Assessment Objectives " + version);
const assessmentObjectives = [];
if (aoSheet) {
  aoSheet.eachRow({ includeEmpty: false }, (row, num) => {
    if (num === 1) return;
    const scfId = cellStr(row.getCell(1)).trim();
    const aoId = cellStr(row.getCell(2)).trim();
    if (!scfId || !aoId) return;
    assessmentObjectives.push({
      scf_control_id: scfId,
      ao_id: aoId,
      objective: cellStr(row.getCell(3)).trim(),
      pptdf: cellStr(row.getCell(4)).trim(),
      origin: cellStr(row.getCell(5)).trim(),
      assessment_rigor: cellStr(row.getCell(7)).trim(),
      scf_defined_parameters: cellStr(row.getCell(8)).trim(),
      org_defined_parameters: cellStr(row.getCell(9)).trim(),
    });
  });
}
console.log(`Assessment objectives: ${assessmentObjectives.length}`);

// ── 8. Evidence Request List ──

const erlSheet = workbook.getWorksheet("Evidence Request List " + version);
const evidenceRequests = [];
if (erlSheet) {
  erlSheet.eachRow({ includeEmpty: false }, (row, num) => {
    if (num === 1) return;
    const erlId = cellStr(row.getCell(2)).trim();
    if (!erlId) return;
    evidenceRequests.push({
      erl_id: erlId,
      area: cellStr(row.getCell(3)).trim(),
      artifact_name: cellStr(row.getCell(4)).trim(),
      artifact_description: cellStr(row.getCell(5)).trim(),
      scf_controls: splitLines(cellStr(row.getCell(6))),
      cmmc_mapping: cellStr(row.getCell(7)).trim(),
    });
  });
}
console.log(`Evidence requests: ${evidenceRequests.length}`);

// ── 9. Compensating Controls ──

const ccSheet = workbook.getWorksheet("Compensating Controls " + version);
const compensatingControls = [];
if (ccSheet) {
  ccSheet.eachRow({ includeEmpty: false }, (row, num) => {
    if (num === 1) return;
    const id = cellStr(row.getCell(2)).trim();
    if (!id) return;
    const risk = cellStr(row.getCell(5)).trim();
    const cc1Id = cellStr(row.getCell(6)).trim();
    const cc2Id = cellStr(row.getCell(10)).trim();

    const entry = {
      control_id: id,
      risk_if_not_implemented: risk,
    };

    if (cc1Id && cc1Id !== "N/A") {
      entry.compensating_control_1 = {
        control_id: cc1Id,
        name: cellStr(row.getCell(7)).trim(),
        description: cellStr(row.getCell(8)).trim(),
        justification: cellStr(row.getCell(9)).trim(),
      };
    }
    if (cc2Id && cc2Id !== "N/A") {
      entry.compensating_control_2 = {
        control_id: cc2Id,
        name: cellStr(row.getCell(11)).trim(),
        description: cellStr(row.getCell(12)).trim(),
        justification: cellStr(row.getCell(13)).trim(),
      };
    }

    // Only include if there's actual data
    if (entry.compensating_control_1 || entry.compensating_control_2 || (risk && !risk.startsWith("Not Applicable")))
      compensatingControls.push(entry);
  });
}
console.log(`Compensating controls: ${compensatingControls.length}`);

// ── 10. Data Privacy Management Principles ──

const dpSheet = workbook.getWorksheet("Data Privacy Mgmt Principles");
const privacyPrinciples = [];
if (dpSheet) {
  const dpHeaders = buildHeaderMap(dpSheet);
  dpSheet.eachRow({ includeEmpty: false }, (row, num) => {
    if (num === 1) return;
    const name = cellStr(row.getCell(2)).trim();
    const scfId = cellStr(row.getCell(dpHeaders["SCF #"] ?? 5)).trim();
    if (!name || !scfId) return;

    // Privacy framework crosswalks (cols 7+)
    const crosswalks = {};
    for (let c = 7; c <= dpSheet.columnCount; c++) {
      const val = cellStr(row.getCell(c)).trim();
      if (!val) continue;
      const header = cellStr(dpSheet.getRow(1).getCell(c)).replace(/\r?\n/g, " ").trim();
      if (header) crosswalks[header] = splitLines(val);
    }

    privacyPrinciples.push({
      principle_name: name,
      description: cellStr(row.getCell(3)).trim(),
      scf_control: cellStr(row.getCell(4)).trim(),
      scf_control_id: scfId,
      crosswalks,
    });
  });
}
console.log(`Privacy principles: ${privacyPrinciples.length}`);

// ── Write output ──

const versionSlug = version.replace(/\./g, "-");
const frameworkCount = Object.keys(scfToFramework).length;

function writeData(filename, data) {
  const path = join(DATA, filename);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`Wrote ${path}`);
}

// Controls + families
writeData(`scf-${versionSlug}.json`, {
  framework: { id: `scf-${versionSlug}`, name: "SCF", version },
  families,
  controls,
});

// Crosswalks
writeData("scf-crosswalks.json", {
  metadata: {
    source: `Secure Controls Framework (SCF) v${version}`,
    source_url: "https://securecontrolsframework.com",
    license: "CC BY-ND (Attribution, No Derivatives)",
    total_frameworks: frameworkCount,
    framework_display_names: displayNames,
  },
  scf_to_framework: scfToFramework,
  framework_to_scf: frameworkToScf,
});

// Threats
writeData("scf-threats.json", { total: threats.length, threats });

// Risks
writeData("scf-risks.json", { total: risks.length, risks });

// Assessment objectives
writeData("scf-assessment-objectives.json", {
  total: assessmentObjectives.length,
  assessment_objectives: assessmentObjectives,
});

// Evidence requests
writeData("scf-evidence-requests.json", {
  total: evidenceRequests.length,
  evidence_requests: evidenceRequests,
});

// Compensating controls
writeData("scf-compensating-controls.json", {
  total: compensatingControls.length,
  compensating_controls: compensatingControls,
});

// Privacy principles
writeData("scf-privacy-principles.json", {
  total: privacyPrinciples.length,
  privacy_principles: privacyPrinciples,
});

// Version
writeFileSync(".scf-version", version + "\n");
console.log(`Updated .scf-version → ${version}`);
console.log("\nParse complete.");
