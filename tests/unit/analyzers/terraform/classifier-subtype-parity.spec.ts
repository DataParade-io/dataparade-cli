import fs from "fs";
import path from "path";
import YAML from "yaml";

import { loadTerraformPatternConfig } from "../../../../src/analyzers/terraform/terraform-detection-config";

const cliRoot = path.join(__dirname, "..", "..", "..", "..");

function readYaml(file: string): unknown {
  const text = fs.readFileSync(file, "utf8");
  return YAML.parse(text);
}

function collectClassifierAssetSubtypes(raw: unknown): Set<string> {
  const out = new Set<string>();
  if (!raw || typeof raw !== "object") return out;
  const doc = raw as Record<string, unknown>;
  const defaults = doc.pattern_defaults;
  if (defaults && typeof defaults === "object") {
    for (const row of Object.values(defaults)) {
      if (!row || typeof row !== "object") continue;
      const st = (row as Record<string, unknown>).subType;
      if (typeof st === "string" && st.trim()) out.add(st.trim());
    }
  }
  const dbMap = doc.database_type_mapping;
  if (dbMap && typeof dbMap === "object") {
    for (const row of Object.values(dbMap)) {
      if (!row || typeof row !== "object") continue;
      const st = (row as Record<string, unknown>).subType;
      if (typeof st === "string" && st.trim()) out.add(st.trim());
    }
  }
  return out;
}

function collectPropertyEnhanceSubtypes(raw: unknown): Set<string> {
  const out = new Set<string>();
  if (!raw || typeof raw !== "object") return out;
  const enhance = (raw as Record<string, unknown>).enhance;
  if (!enhance || typeof enhance !== "object") return out;
  const e = enhance as Record<string, unknown>;

  const pushList = (key: string) => {
    const v = e[key];
    if (!Array.isArray(v)) return;
    for (const item of v) {
      if (typeof item === "string" && item.trim()) out.add(item.trim());
    }
  };

  pushList("main_app_subtypes");
  pushList("cloud_asset_subtypes");
  pushList("on_prem_asset_subtypes");

  const ops = e.supported_operations;
  if (ops && typeof ops === "object") {
    for (const k of Object.keys(ops)) {
      if (k.trim()) out.add(k.trim());
    }
  }

  return out;
}

/** Subtypes that come from code classification but are not modeled as Terraform resource hints. */
const EXCLUDED_FROM_RESOURCE_HINT_PARITY = new Set<string>(["cloud_provider"]);

describe("Terraform resource_type_hints vs classifier/property subTypes", () => {
  it("every TS/Python asset subType used in classifier or enhance config has at least one terraform hint", () => {
    const classifierPath = path.join(
      cliRoot,
      "patterns",
      "classifier",
      "components.classifier.yaml",
    );
    const propertyPath = path.join(cliRoot, "patterns", "property.patterns.yaml");

    const classifierSubs = collectClassifierAssetSubtypes(readYaml(classifierPath));
    const propertySubs = collectPropertyEnhanceSubtypes(readYaml(propertyPath));

    const required = new Set<string>([...classifierSubs, ...propertySubs]);
    for (const ex of EXCLUDED_FROM_RESOURCE_HINT_PARITY) required.delete(ex);

    const tfConfig = loadTerraformPatternConfig();
    const hinted = new Set(
      tfConfig.resourceTypeHints.map((h) => h.componentSubType),
    );

    const missing = [...required].filter((s) => !hinted.has(s)).sort();
    expect(missing).toEqual([]);
  });
});
