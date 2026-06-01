import type { RawFinding, PatternId } from "../core/types/detection";
import type {
  ComponentType,
  DetectedComponent,
  DetectedFromRef,
} from "../core/types/component";
import type { SourceLocation } from "../core/types/file";
import {
  loadClassifierConfig,
  type ClassifierConfig,
  type NameNormalizationConfig,
  type PatternDefaultConfig,
  type ThirdPartyConfigEntry,
} from "./config";
import {
  inferThirdPartyFromLiteralHttpUrl,
  shouldIgnoreExternalHttpUrl,
} from "./external-url-third-party";
import {
  NON_RUNTIME_METADATA_EXTENSIONS,
  NON_RUNTIME_METADATA_FILE_NAMES,
} from "../patterns/flow-source-patterns";
import { isTerraformOmittedFromServiceGraphResourceType } from "../analyzers/terraform/terraform-utility-resource";

interface FindingGroup {
  key: string;
  displayName: string;
  findings: RawFinding[];
}

const MERGED_HTTP_ROUTE_GROUP_KEY_PREFIX = "__cli_http_api_routes__";
const FRONTEND_FRAMEWORK_GROUP_KEY_PREFIX = "__cli_frontend_framework__";
const MERGED_HTTP_ROUTE_DISPLAY_NAME = "HTTP API";

function escapeForCharClass(input: string): string {
  return input.replace(/[-\\^$*+?.()|[\]{}]/g, "\\$&");
}

function normalizeComponentName(
  rawName: string,
  rules: NameNormalizationConfig,
): string {
  let name = rawName.trim();
  if (!name) return "";
  let lower = name.toLowerCase();

  for (const suffix of rules.removeSuffixes) {
    if (!suffix) continue;
    if (lower === suffix) {
      lower = "";
      break;
    }
    if (lower.endsWith(suffix)) {
      lower = lower.slice(0, -suffix.length).trim();
    }
  }

  for (const regex of rules.removeSuffixPatterns) {
    lower = lower.replace(regex, "").trim();
  }

  if (rules.trimChars && rules.trimChars.length > 0) {
    const escaped = escapeForCharClass(rules.trimChars);
    const boundaryRegex = new RegExp(
      `^[${escaped}]+|[${escaped}]+$`,
      "g",
    );
    lower = lower.replace(boundaryRegex, "").trim();
  }

  lower = lower.replace(/[\s_\-]+/g, " ").trim();
  if (!lower) return rawName.trim().toLowerCase();
  return lower;
}

function getSectionIdFromProperties(
  properties: Record<string, unknown> | undefined,
): string {
  const raw = properties?.section_id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "<unsectioned>";
}

function toDisplayName(normalized: string, fallback: string): string {
  const base = normalized || fallback.trim();
  if (!base) return "<unknown>";

  return base
    .split(/\s+/)
    .map((part) =>
      part.length === 0
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

function normalizeApiDisplayName(
  rawName: string,
  properties: Record<string, unknown> | undefined,
): string {
  const name = (rawName || "").trim();
  if (!name) return name;

  const lower = name.toLowerCase();
  const isGenericApiName =
    lower === "route handler" ||
    lower.startsWith("nest_controller") ||
    /^(get|post|put|delete|patch|options|head)\s+/.test(lower);
  if (!isGenericApiName) return name;

  const sectionLabel = properties?.section_label;
  if (typeof sectionLabel === "string" && sectionLabel.trim()) {
    return `${sectionLabel.trim()} API`;
  }

  const sectionId = properties?.section_id;
  if (
    typeof sectionId === "string" &&
    sectionId.trim() &&
    sectionId !== "root" &&
    sectionId !== "global" &&
    sectionId !== "<unsectioned>"
  ) {
    return `${sectionId.trim()} API`;
  }

  return "API";
}

function terraformInfrastructureDisplayName(
  finding: RawFinding,
  config: ClassifierConfig,
): string {
  if (finding.pattern === "terraform_provider") {
    const sn = finding.properties?.serviceName;
    if (typeof sn === "string" && sn.trim()) {
      return sn.trim();
    }
    const pn = finding.properties?.provider_name;
    if (typeof pn === "string" && pn.trim()) {
      return `${pn.trim()} provider`;
    }
    return "Terraform provider";
  }
  if (finding.pattern === "terraform_module") {
    const mn = finding.properties?.module_name;
    if (typeof mn === "string" && mn.trim()) {
      return `Module · ${mn.trim()}`;
    }
    return "Terraform module";
  }
  const rt = finding.properties?.resource_type;
  const bn = finding.properties?.block_name;
  const addrRaw = finding.properties?.terraform_address;
  if (
    typeof rt === "string" &&
    rt.trim() &&
    typeof bn === "string" &&
    bn.trim()
  ) {
    if (
      bn.trim() === "this" &&
      typeof addrRaw === "string" &&
      addrRaw.startsWith("module.")
    ) {
      const segs = addrRaw.split(".").filter(Boolean);
      if (segs.length >= 4) {
        const modName = segs[1];
        const resType = segs[2] ?? rt.trim();
        return `this (${resType}) · ${modName}`;
      }
    }
    return `${bn.trim()} (${rt.trim()})`;
  }
  const normalized = normalizeComponentName(
    finding.name,
    config.nameNormalization,
  );
  return toDisplayName(normalized, finding.name);
}

function groupFindings(
  findings: RawFinding[],
  config: ClassifierConfig,
): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();

  for (const finding of findings) {
    let key: string;
    let displayName: string;

    if (finding.pattern === "express_route") {
      const sourceContext = finding.properties?.sourceContext;
      if (sourceContext === "dependency_manifest") {
        const sectionId = getSectionIdFromProperties(finding.properties);
        const frameworkRaw = finding.properties?.framework;
        const framework =
          typeof frameworkRaw === "string" && frameworkRaw.trim()
            ? frameworkRaw.trim().toLowerCase()
            : "frontend";
        const packageNameRaw = finding.properties?.packageName;
        const packageDisplayName =
          typeof packageNameRaw === "string" && packageNameRaw.trim()
            ? toDisplayName(
                normalizeComponentName(packageNameRaw, config.nameNormalization),
                packageNameRaw,
              )
            : undefined;
        key = `${FRONTEND_FRAMEWORK_GROUP_KEY_PREFIX}:${sectionId}:${framework}`;
        displayName = packageDisplayName ?? toDisplayName(framework, framework);
      } else {
        const sectionId = getSectionIdFromProperties(finding.properties);
        key = `${MERGED_HTTP_ROUTE_GROUP_KEY_PREFIX}:${sectionId}`;
        displayName = MERGED_HTTP_ROUTE_DISPLAY_NAME;
      }
    } else if (
      finding.pattern === "terraform_resource" ||
      finding.pattern === "terraform_module" ||
      finding.pattern === "terraform_provider"
    ) {
      const sectionId = getSectionIdFromProperties(finding.properties);
      const addrRaw = finding.properties?.terraform_address;
      const addr =
        typeof addrRaw === "string" && addrRaw.trim()
          ? addrRaw.trim()
          : finding.name.trim();
      key = `${sectionId}::tf::${addr}`;
      displayName = terraformInfrastructureDisplayName(finding, config);
    } else {
      const normalized = normalizeComponentName(
        finding.name,
        config.nameNormalization,
      );
      const sectionId = getSectionIdFromProperties(finding.properties);
      const keyBase =
        normalized || finding.name.trim().toLowerCase() || "<unknown>";
      key = `${sectionId}::${keyBase}`;
      displayName = toDisplayName(keyBase, keyBase);
    }

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        displayName,
        findings: [],
      };
      groups.set(key, group);
    }

    group.findings.push(finding);
  }

  const groupList = Array.from(groups.values());
  for (const group of groupList) {
    if (!group.key.startsWith(MERGED_HTTP_ROUTE_GROUP_KEY_PREFIX)) continue;
    const normalizedLabels = group.findings.map((f) =>
      normalizeApiDisplayName(f.name, f.properties),
    );
    const nonGeneric = normalizedLabels
      .filter((l) => l !== "API")
      .sort((a, b) => a.localeCompare(b))[0];
    group.displayName = nonGeneric ?? MERGED_HTTP_ROUTE_DISPLAY_NAME;
  }

  return groupList.sort((a, b) => a.key.localeCompare(b.key));
}

function buildPatternDefaultMap(
  config: ClassifierConfig,
): Record<PatternId, PatternDefaultConfig | undefined> {
  const map: Partial<Record<PatternId, PatternDefaultConfig>> = {};
  for (const def of config.patternDefaults) {
    map[def.patternId] = def;
  }
  return map as Record<PatternId, PatternDefaultConfig | undefined>;
}

function syntheticThirdPartyEntry(
  serviceName: string,
  subType: string,
): ThirdPartyConfigEntry {
  return {
    serviceName,
    matchKeys: [],
    type: "third_party",
    subType,
  };
}

function findThirdPartyMatch(
  finding: RawFinding,
  config: ClassifierConfig,
): ThirdPartyConfigEntry | undefined {
  if (finding.pattern !== "external_api_call") {
    return undefined;
  }

  const props = finding.properties ?? {};
  const candidates: string[] = [];
  const serviceName = props.serviceName;
  const client = props.client;
  const urlProp = props.url;

  if (typeof serviceName === "string") candidates.push(serviceName.toLowerCase());
  if (typeof client === "string") candidates.push(client.toLowerCase());
  if (typeof urlProp === "string" && /^https?:\/\//i.test(urlProp.trim())) {
    candidates.push(urlProp.toLowerCase());
  }
  if (
    typeof finding.name === "string" &&
    /^https?:\/\//i.test(finding.name.trim())
  ) {
    candidates.push(finding.name.toLowerCase());
  }

  for (const tp of config.thirdParties) {
    for (const key of tp.matchKeys) {
      if (candidates.some((c) => c.includes(key))) return tp;
    }
  }

  const inferred = inferThirdPartyFromLiteralHttpUrl(finding);
  if (inferred) return syntheticThirdPartyEntry(inferred.serviceName, inferred.subType);
  return undefined;
}

function aggregateConfidence(
  findings: RawFinding[],
  strategy: "max" | "average",
): number {
  if (findings.length === 0) return 0;
  if (strategy === "average") {
    const sum = findings.reduce((acc, f) => acc + f.confidence, 0);
    return Math.min(1, Math.max(0, sum / findings.length));
  }
  const max = findings.reduce(
    (acc, f) => (f.confidence > acc ? f.confidence : acc),
    0,
  );
  return Math.min(1, Math.max(0, max));
}

function mergeProperties(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) {
      target[key] = value;
      continue;
    }
    const existing = target[key];
    if (existing === value) continue;

    const existingArray = Array.isArray(existing) ? existing : [existing];
    const incomingArray = Array.isArray(value) ? value : [value];
    const merged: unknown[] = [...existingArray];
    for (const v of incomingArray) {
      if (!merged.includes(v)) merged.push(v);
    }
    target[key] = merged;
  }
}

function dedupeSourceLocations(
  locations: SourceLocation[],
): SourceLocation[] {
  const seen = new Set<string>();
  const result: SourceLocation[] = [];
  for (const loc of locations) {
    const key = `${loc.filePath}:${loc.startLine}:${loc.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(loc);
  }
  return result;
}

function compareSourceLocations(a: SourceLocation, b: SourceLocation): number {
  const fileCmp = a.filePath.localeCompare(b.filePath);
  if (fileCmp !== 0) return fileCmp;
  if (a.startLine !== b.startLine) return a.startLine - b.startLine;
  if (a.endLine !== b.endLine) return a.endLine - b.endLine;
  return 0;
}

function compareDetectedFromRefs(a: DetectedFromRef, b: DetectedFromRef): number {
  const patternCmp = String(a.pattern).localeCompare(String(b.pattern));
  if (patternCmp !== 0) return patternCmp;

  const al = a.sourceLocation;
  const bl = b.sourceLocation;
  if (!al && !bl) return 0;
  if (!al) return 1;
  if (!bl) return -1;
  return compareSourceLocations(al, bl);
}

function isNonRuntimeMetadataPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const fileName = normalized.split("/").pop() ?? normalized;
  if (NON_RUNTIME_METADATA_FILE_NAMES.has(fileName)) return true;
  return NON_RUNTIME_METADATA_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

function buildDetectedFromRefs(
  findings: RawFinding[],
): DetectedFromRef[] {
  const seen = new Set<string>();
  const result: DetectedFromRef[] = [];
  for (const finding of findings) {
    const loc = finding.location;
    const key = `${finding.pattern}:${loc.filePath}:${loc.startLine}:${loc.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      pattern: finding.pattern,
      sourceLocation: loc,
    });
  }
  return result;
}

function decideComponentTypeAndSubType(
  group: FindingGroup,
  config: ClassifierConfig,
  patternDefaultsById: Record<PatternId, PatternDefaultConfig | undefined>,
): {
  type: ComponentType;
  subType?: string;
  thirdParty?: ThirdPartyConfigEntry;
} {
  let chosenType: ComponentType = "asset";
  let chosenSubType: string | undefined;
  let bestPriority = Number.POSITIVE_INFINITY;
  let matchedThirdParty: ThirdPartyConfigEntry | undefined;
  const databaseTypes: string[] = [];

  for (const finding of group.findings) {
    const patternDefault = patternDefaultsById[
      finding.pattern
    ] as PatternDefaultConfig | undefined;
    if (patternDefault && patternDefault.priority < bestPriority) {
      bestPriority = patternDefault.priority;
      chosenType = patternDefault.type;
      chosenSubType = patternDefault.subType;
    }

    if (finding.pattern === "database_connection") {
      const dbType = finding.properties.databaseType;
      if (typeof dbType === "string" && dbType) {
        databaseTypes.push(dbType.toLowerCase());
      }
    }

    const tp = findThirdPartyMatch(finding, config);
    if (tp && !matchedThirdParty) matchedThirdParty = tp;
  }

  if (matchedThirdParty && config.resolution.preferThirdPartyOverAsset) {
    return {
      type: "third_party",
      subType: matchedThirdParty.subType,
      thirdParty: matchedThirdParty,
    };
  }

  if (databaseTypes.length > 0) {
    const firstDbType = databaseTypes[0];
    const mapped = config.databaseTypeMapping[firstDbType];
    if (mapped?.subType) chosenSubType = mapped.subType;
  }

  for (const finding of group.findings) {
    if (
      finding.pattern !== "terraform_resource" &&
      finding.pattern !== "terraform_module" &&
      finding.pattern !== "terraform_provider"
    ) {
      continue;
    }
    const explicit = finding.properties?.componentSubType;
    if (typeof explicit === "string" && explicit.trim()) {
      chosenSubType = explicit.trim();
      break;
    }
  }

  return { type: chosenType, subType: chosenSubType };
}

export function classifyRawFindings(
  rawFindings: RawFinding[],
): DetectedComponent[] {
  if (!rawFindings || rawFindings.length === 0) return [];

  const findings = rawFindings.filter((f) => {
    if (f.pattern !== "terraform_resource") return true;
    const rt = f.properties?.resource_type;
    if (typeof rt !== "string") return true;
    return !isTerraformOmittedFromServiceGraphResourceType(rt);
  });

  const config = loadClassifierConfig();
  const groups = groupFindings(findings, config);
  const patternDefaultsById = buildPatternDefaultMap(config);

  let nextId = 1;
  const components: DetectedComponent[] = [];

  for (const group of groups) {
    if (
      group.findings.length > 0 &&
      group.findings.every((f) => f.pattern === "env_variable")
    ) {
      const key = group.findings[0].properties?.key;
      if (
        typeof key === "string" &&
        config.envVariableExcludeKeys.has(key.toUpperCase())
      ) {
        continue;
      }
    }

    if (
      group.findings.length > 0 &&
      group.findings.every(
        (f) =>
          f.pattern === "database_connection" &&
          f.name.toLowerCase() === "sql_query_detected",
      )
    ) {
      continue;
    }

    if (
      group.findings.length > 0 &&
      group.findings.every(
        (f) =>
          f.pattern === "express_route" &&
          typeof f.location.filePath === "string" &&
          f.location.filePath.endsWith(".py"),
      )
    ) {
      continue;
    }

    const { type, subType, thirdParty } = decideComponentTypeAndSubType(
      group,
      config,
      patternDefaultsById,
    );

    if (
      type === "third_party" &&
      group.findings.length > 0 &&
      group.findings.every((f) => isNonRuntimeMetadataPath(f.location.filePath)) &&
      !group.findings.some(
        (f) => f.properties?.sourceContext === "dependency_manifest",
      )
    ) {
      continue;
    }

    if (
      type === "third_party" &&
      group.findings.length > 0 &&
      group.findings.every((f) => f.pattern === "external_api_call") &&
      group.findings.every((f) => {
        if (f.properties?.sourceContext === "dependency_manifest") {
          return false;
        }
        const serviceName =
          typeof f.properties?.serviceName === "string"
            ? f.properties.serviceName.trim()
            : "";
        if (serviceName.length > 0) {
          return false;
        }
        const urlRaw =
          typeof f.properties?.url === "string"
            ? f.properties.url
            : typeof f.name === "string" && /^https?:\/\//i.test(f.name)
              ? f.name
              : undefined;
        return shouldIgnoreExternalHttpUrl(urlRaw);
      })
    ) {
      continue;
    }

    const confidence = aggregateConfidence(
      group.findings,
      config.resolution.confidenceAggregation,
    );

    const detectedFrom = buildDetectedFromRefs(group.findings);
    const allLocations = group.findings.map((f) => f.location);
    const sourceLocations = dedupeSourceLocations(allLocations);
    detectedFrom.sort(compareDetectedFromRefs);
    sourceLocations.sort(compareSourceLocations);

    const mergedProperties: Record<string, unknown> = {};
    for (const finding of group.findings) {
      mergeProperties(mergedProperties, finding.properties);
    }

    if (
      type === "third_party" &&
      thirdParty &&
      (typeof mergedProperties.serviceName !== "string" ||
        !String(mergedProperties.serviceName).trim())
    ) {
      mergedProperties.serviceName = thirdParty.serviceName;
    }

    if (type === "asset" && subType === "config") continue;

    const component: DetectedComponent = {
      id: `cmp_${nextId++}`,
      name: group.displayName,
      type,
      subType,
      confidence,
      detectedFrom,
      sourceLocations,
      properties: mergedProperties,
    };

    if (component.type === "third_party") {
      const svc = mergedProperties.serviceName;
      if (typeof svc === "string" && svc.trim()) {
        const normalizedService = normalizeComponentName(
          svc,
          config.nameNormalization,
        );
        component.name = toDisplayName(normalizedService, svc);
      }
    }

    if (component.type === "asset" && component.subType === "api") {
      component.name = normalizeApiDisplayName(component.name, mergedProperties);
    }

    components.push(component);
  }

  components.sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;
    return a.type.localeCompare(b.type);
  });

  return components;
}

