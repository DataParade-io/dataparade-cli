import fs from "fs";
import * as path from "path";

import type { RawFinding } from "../../core/types/detection";
import type { TerraformPatternConfig } from "./terraform-detection-config";
import {
  loadTerraformPatternConfig,
  lookupTerraformResourceHints,
} from "./terraform-detection-config";
import { isTerraformOmittedFromServiceGraphResourceType } from "./terraform-utility-resource";

export interface TerraformJsonMergeResult {
  findings: RawFinding[];
  mergedCount: number;
}

interface CollectedResource {
  address: string;
  type: string;
  name: string;
}

function collectFromModule(mod: unknown): CollectedResource[] {
  if (!mod || typeof mod !== "object") return [];
  const m = mod as Record<string, unknown>;
  const out: CollectedResource[] = [];

  const resources = m.resources;
  if (Array.isArray(resources)) {
    for (const r of resources) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      const addr = typeof o.address === "string" ? o.address.trim() : "";
      const t = typeof o.type === "string" ? o.type.trim() : "";
      const n = typeof o.name === "string" ? o.name.trim() : "";
      if (addr && t) {
        out.push({ address: addr, type: t, name: n || addr });
      }
    }
  }

  const children = m.child_modules;
  if (Array.isArray(children)) {
    for (const ch of children) {
      out.push(...collectFromModule(ch));
    }
  }

  return out;
}

function collectFromPlanDoc(doc: Record<string, unknown>): CollectedResource[] {
  const out: CollectedResource[] = [];
  const planned = doc.planned_values;
  if (planned && typeof planned === "object") {
    const root = (planned as Record<string, unknown>).root_module;
    out.push(...collectFromModule(root));
  }
  const values = doc.values;
  if (values && typeof values === "object") {
    const root = (values as Record<string, unknown>).root_module;
    out.push(...collectFromModule(root));
  }

  const changes = doc.resource_changes;
  if (Array.isArray(changes)) {
    for (const ch of changes) {
      if (!ch || typeof ch !== "object") continue;
      const o = ch as Record<string, unknown>;
      const addr = typeof o.address === "string" ? o.address.trim() : "";
      const t = typeof o.type === "string" ? o.type.trim() : "";
      const n = typeof o.name === "string" ? o.name.trim() : "";
      if (addr && t) {
        out.push({ address: addr, type: t, name: n || addr });
      }
    }
  }

  const seen = new Set<string>();
  const deduped: CollectedResource[] = [];
  for (const r of out) {
    if (seen.has(r.address)) continue;
    seen.add(r.address);
    deduped.push(r);
  }
  return deduped.sort((a, b) => a.address.localeCompare(b.address));
}

function rawFindingFromJsonResource(
  r: CollectedResource,
  jsonBasename: string,
  tfConfig: TerraformPatternConfig,
): RawFinding {
  const hints = lookupTerraformResourceHints(r.type, tfConfig);
  return {
    pattern: "terraform_resource",
    name: r.address,
    confidence: 0.78,
    location: {
      filePath: jsonBasename,
      startLine: 1,
      endLine: 1,
    },
    properties: {
      terraform_address: r.address,
      terraform_block_kind: "resource",
      resource_type: r.type,
      block_name: r.name,
      componentSubType: hints.componentSubType,
      cloud_provider: hints.cloud_provider,
      section_id: "global",
      section_label: "terraform-json",
      terraform_references: [],
      terraform_json_source: true,
    },
  };
}

/**
 * Parse a `terraform show -json` object (plan or state) and emit `RawFinding`s
 * for addresses not already present in `existingFindings`.
 */
export function mergeTerraformShowJsonFromDoc(
  existingFindings: RawFinding[],
  doc: Record<string, unknown>,
  syntheticFileLabel: string,
  onWarning?: (message: string) => void,
): TerraformJsonMergeResult {
  const resources = collectFromPlanDoc(doc);
  if (resources.length === 0) {
    onWarning?.(
      "terraform-json: no resources found (expected planned_values/values root_module or resource_changes).",
    );
    return { findings: [], mergedCount: 0 };
  }

  const tfConfig = loadTerraformPatternConfig();

  const existingAddresses = new Set<string>();
  for (const f of existingFindings) {
    if (f.pattern !== "terraform_resource") continue;
    const addr = f.properties?.terraform_address;
    if (typeof addr === "string" && addr.trim()) {
      existingAddresses.add(addr.trim());
    }
  }

  const extra: RawFinding[] = [];
  for (const r of resources) {
    if (existingAddresses.has(r.address)) continue;
    if (isTerraformOmittedFromServiceGraphResourceType(r.type)) continue;
    extra.push(rawFindingFromJsonResource(r, syntheticFileLabel, tfConfig));
    existingAddresses.add(r.address);
  }

  if (extra.length > 0) {
    onWarning?.(
      `terraform-json: merged ${extra.length} resource(s) from '${syntheticFileLabel}' (state/plan may contain secrets — values are not copied into output).`,
    );
  }

  return { findings: extra, mergedCount: extra.length };
}

/**
 * Parse a `terraform show -json` file (plan or state) and emit `RawFinding`s
 * for addresses not already present in `existingFindings` (static `.tf` wins).
 */
export function mergeTerraformShowJsonFindings(
  existingFindings: RawFinding[],
  jsonAbsolutePath: string,
  onWarning?: (message: string) => void,
): TerraformJsonMergeResult {
  let parsed: unknown;
  try {
    const raw = fs.readFileSync(jsonAbsolutePath, "utf8");
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onWarning?.(`terraform-json: failed to read or parse '${jsonAbsolutePath}': ${msg}`);
    return { findings: [], mergedCount: 0 };
  }

  if (!parsed || typeof parsed !== "object") {
    onWarning?.("terraform-json: root JSON value must be an object.");
    return { findings: [], mergedCount: 0 };
  }

  const doc = parsed as Record<string, unknown>;
  return mergeTerraformShowJsonFromDoc(
    existingFindings,
    doc,
    path.basename(jsonAbsolutePath),
    onWarning,
  );
}
