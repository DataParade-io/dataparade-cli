import fs from "fs";
import path from "path";
import YAML from "yaml";

export interface TerraformResourceHints {
  componentSubType: string;
  cloud_provider: string;
}

export interface TerraformBlockPatternCompiled {
  kind: "resource" | "data" | "module" | "provider";
  regex: RegExp;
  resourceTypeGroup?: number;
  blockNameGroup: number;
}

export interface TerraformSyntaxCompiled {
  blockLineProbe: RegExp;
  blockPatterns: TerraformBlockPatternCompiled[];
}

export interface TerraformReferencePatternCompiled {
  id: string;
  regex: RegExp;
  template: string;
  skipWhenFirstTokenReserved: boolean;
}

export interface TerraformSatelliteRuleCompiled {
  id: string;
  childResourceTypeRegex: RegExp;
  parentLineRegex: RegExp;
  parentCaptureGroup: number;
}

export interface TerraformResourceTypeHintCompiled {
  id: string;
  regex: RegExp;
  componentSubType: string;
  cloud_provider: string;
}

export interface TerraformProviderServiceNameCompiled {
  regex: RegExp;
  serviceName: string;
}

export interface TerraformPatternConfig {
  syntax: TerraformSyntaxCompiled;
  reservedReferencePrefixes: Set<string>;
  referencePatterns: TerraformReferencePatternCompiled[];
  satelliteRules: TerraformSatelliteRuleCompiled[];
  resourceTypeHints: TerraformResourceTypeHintCompiled[];
  providerServiceNames: TerraformProviderServiceNameCompiled[];
}

function compileRegex(pattern: string, flags?: string): RegExp {
  try {
    return new RegExp(pattern, flags ?? "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid regex '${pattern}': ${msg}`);
  }
}

function getPatternsFilePath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const cliRoot =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "../../..");
  return path.join(cliRoot, "patterns", "terraform.patterns.yaml");
}

function getPatternsDirForGeneratedHints(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const cliRoot =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "../../..");
  return path.join(cliRoot, "patterns");
}

interface GeneratedHintsFile {
  hints?: RawResourceHint[];
}

function mergeGeneratedHintsAtYamlAnchor(
  hints: RawResourceHint[],
  anchorId: string,
  fileName: string,
): RawResourceHint[] {
  const idx = hints.findIndex((h) => h.id === anchorId);
  if (idx < 0) return hints;
  const genPath = path.join(getPatternsDirForGeneratedHints(), fileName);
  let gen: RawResourceHint[] = [];
  try {
    const text = fs.readFileSync(genPath, "utf8");
    const parsed = JSON.parse(text) as GeneratedHintsFile;
    gen = parsed.hints ?? [];
  } catch {
    return hints;
  }
  if (gen.length === 0) return hints;
  return [...hints.slice(0, idx), ...gen, ...hints.slice(idx)];
}

/**
 * Inserts CDKTF-derived `aws_<service>_` / `azurerm_<service>_` hints immediately
 * before each provider's default `^aws_` / `^azurerm_` catch-all rules.
 */
function mergeProviderGeneratedResourceHints(hints: RawResourceHint[]): RawResourceHint[] {
  let merged = mergeGeneratedHintsAtYamlAnchor(hints, "aws_default_family", "aws-terraform-service-hints.generated.json");
  merged = mergeGeneratedHintsAtYamlAnchor(
    merged,
    "azurerm_default_family",
    "azure-terraform-service-hints.generated.json",
  );
  merged = mergeGeneratedHintsAtYamlAnchor(
    merged,
    "kubernetes_default_family",
    "kubernetes-terraform-service-hints.generated.json",
  );
  return merged;
}

interface RawBlockPattern {
  kind: string;
  regex: string;
  resource_type_group?: number;
  block_name_group?: number;
}

interface RawReferencePattern {
  id: string;
  regex: string;
  flags?: string;
  template: string;
  skip_when_first_token_reserved?: boolean;
}

interface RawSatelliteRule {
  id: string;
  child_resource_type_regex: string;
  parent_address_from_body_line: {
    regex: string;
    capture_group: number;
  };
}

interface RawResourceHint {
  id: string;
  resource_type_regex: string;
  componentSubType: string;
  cloud_provider: string;
}

interface RawProviderSvc {
  provider_key_regex: string;
  serviceName: string;
}

interface RawTerraformPatterns {
  version?: number;
  syntax?: {
    block_line_probe_regex?: string;
    block_patterns?: RawBlockPattern[];
  };
  reserved_reference_first_tokens?: string[];
  reference_patterns?: RawReferencePattern[];
  satellite_resource_rules?: RawSatelliteRule[];
  resource_type_hints?: RawResourceHint[];
  provider_service_names?: RawProviderSvc[];
}

let cachedConfig: TerraformPatternConfig | undefined;

export function clearTerraformPatternConfigCache(): void {
  cachedConfig = undefined;
}

function normalizeConfig(raw: RawTerraformPatterns): TerraformPatternConfig {
  if (!raw.syntax?.block_line_probe_regex) {
    throw new Error("terraform.patterns.yaml: missing syntax.block_line_probe_regex");
  }
  const blockLineProbe = compileRegex(raw.syntax.block_line_probe_regex);
  const rawPatterns = raw.syntax.block_patterns;
  if (!Array.isArray(rawPatterns) || rawPatterns.length === 0) {
    throw new Error("terraform.patterns.yaml: syntax.block_patterns must be a non-empty array");
  }

  const blockPatterns: TerraformBlockPatternCompiled[] = [];
  for (const bp of rawPatterns) {
    if (!bp.kind || !bp.regex || typeof bp.block_name_group !== "number") {
      throw new Error(
        "terraform.patterns.yaml: each block_patterns entry needs kind, regex, block_name_group",
      );
    }
    if (!["resource", "data", "module", "provider"].includes(bp.kind)) {
      throw new Error(`terraform.patterns.yaml: invalid block kind '${bp.kind}'`);
    }
    const kind = bp.kind as TerraformBlockPatternCompiled["kind"];
    if (
      (kind === "resource" || kind === "data") &&
      typeof bp.resource_type_group !== "number"
    ) {
      throw new Error(
        `terraform.patterns.yaml: block pattern '${kind}' requires resource_type_group`,
      );
    }
    blockPatterns.push({
      kind,
      regex: compileRegex(bp.regex),
      resourceTypeGroup: bp.resource_type_group,
      blockNameGroup: bp.block_name_group,
    });
  }

  const reserved = new Set(
    (raw.reserved_reference_first_tokens ?? []).map((s) => String(s).toLowerCase()),
  );

  const refPatternsRaw = raw.reference_patterns;
  if (!Array.isArray(refPatternsRaw) || refPatternsRaw.length === 0) {
    throw new Error("terraform.patterns.yaml: reference_patterns required");
  }
  const referencePatterns: TerraformReferencePatternCompiled[] = [];
  for (const rp of refPatternsRaw) {
    if (!rp.id || !rp.regex || !rp.template) {
      throw new Error(
        "terraform.patterns.yaml: each reference_patterns entry needs id, regex, template",
      );
    }
    referencePatterns.push({
      id: rp.id,
      regex: compileRegex(rp.regex, rp.flags ?? "gi"),
      template: rp.template,
      skipWhenFirstTokenReserved: Boolean(rp.skip_when_first_token_reserved),
    });
  }

  const satelliteRules: TerraformSatelliteRuleCompiled[] = [];
  for (const sr of raw.satellite_resource_rules ?? []) {
    if (
      !sr.id ||
      !sr.child_resource_type_regex ||
      !sr.parent_address_from_body_line?.regex
    ) {
      throw new Error("terraform.patterns.yaml: invalid satellite_resource_rules entry");
    }
    const cg = sr.parent_address_from_body_line.capture_group;
    if (typeof cg !== "number" || cg < 1) {
      throw new Error(
        `terraform.patterns.yaml: satellite '${sr.id}' needs parent_address_from_body_line.capture_group >= 1`,
      );
    }
    satelliteRules.push({
      id: sr.id,
      childResourceTypeRegex: compileRegex(sr.child_resource_type_regex),
      parentLineRegex: compileRegex(sr.parent_address_from_body_line.regex),
      parentCaptureGroup: cg,
    });
  }

  const hintsRaw = mergeProviderGeneratedResourceHints(raw.resource_type_hints ?? []);
  if (!Array.isArray(hintsRaw) || hintsRaw.length === 0) {
    throw new Error("terraform.patterns.yaml: resource_type_hints required");
  }
  const resourceTypeHints: TerraformResourceTypeHintCompiled[] = [];
  for (const h of hintsRaw) {
    if (!h.id || !h.resource_type_regex || !h.componentSubType || !h.cloud_provider) {
      throw new Error(
        "terraform.patterns.yaml: each resource_type_hints entry needs id, resource_type_regex, componentSubType, cloud_provider",
      );
    }
    resourceTypeHints.push({
      id: h.id,
      regex: compileRegex(h.resource_type_regex),
      componentSubType: h.componentSubType,
      cloud_provider: h.cloud_provider,
    });
  }

  const providerServiceNames: TerraformProviderServiceNameCompiled[] = [];
  for (const p of raw.provider_service_names ?? []) {
    if (!p.provider_key_regex || !p.serviceName) {
      throw new Error(
        "terraform.patterns.yaml: provider_service_names entries need provider_key_regex and serviceName",
      );
    }
    providerServiceNames.push({
      regex: compileRegex(p.provider_key_regex, "i"),
      serviceName: p.serviceName,
    });
  }

  return {
    syntax: { blockLineProbe, blockPatterns },
    reservedReferencePrefixes: reserved,
    referencePatterns,
    satelliteRules,
    resourceTypeHints,
    providerServiceNames,
  };
}

export function loadTerraformPatternConfig(): TerraformPatternConfig {
  if (process.env.NODE_ENV !== "test" && cachedConfig) {
    return cachedConfig;
  }

  const patternsPath = getPatternsFilePath();
  let rawText: string;
  try {
    rawText = fs.readFileSync(patternsPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Terraform pattern config is required but could not be read from '${patternsPath}': ${message}`,
    );
  }

  const parsed = YAML.parse(rawText) as RawTerraformPatterns;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `Terraform pattern config at '${patternsPath}' did not parse to an object.`,
    );
  }

  try {
    const normalized = normalizeConfig(parsed);
    if (process.env.NODE_ENV !== "test") {
      cachedConfig = normalized;
    }
    return normalized;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid Terraform pattern config at '${patternsPath}': ${message}`);
  }
}

export function lookupTerraformResourceHints(
  resourceType: string,
  config: TerraformPatternConfig,
): TerraformResourceHints {
  const rt = resourceType.trim();
  for (const h of config.resourceTypeHints) {
    if (h.regex.test(rt)) {
      return {
        componentSubType: h.componentSubType,
        cloud_provider: h.cloud_provider,
      };
    }
  }
  return { componentSubType: "application", cloud_provider: "unknown" };
}

export function lookupTerraformProviderServiceName(
  providerName: string,
  config: TerraformPatternConfig,
): string {
  const key = providerName.trim();
  for (const row of config.providerServiceNames) {
    if (row.regex.test(key)) {
      return row.serviceName;
    }
  }
  return `Terraform provider (${key})`;
}
