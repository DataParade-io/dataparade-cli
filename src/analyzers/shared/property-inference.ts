/**
 * Maps YAML-driven pattern detection results to component properties.
 *
 * Property inference is intentionally driven by `cli/patterns/property.patterns.yaml`
 * to avoid hard-coded inference mappings.
 */

import type { RawFinding } from "../../core/types/detection";
import { loadPropertyDetectionConfig } from "../../config/property-detection-config";

type ConditionSpec = unknown;
type AssignmentSpec = unknown;
type RuleSpec = { when: ConditionSpec; set: Record<string, AssignmentSpec> };

type InferenceContext = Record<string, unknown>;

function isTruthyValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function getContextValue(ctx: InferenceContext, inputName: string): unknown {
  return ctx[inputName];
}

function evalCondition(
  when: any,
  ctx: InferenceContext,
  out: Record<string, unknown>,
  regexes: Record<string, RegExp>,
): boolean {
  if (!when) return false;

  if (when.always === true) return true;

  if (typeof when.notSet === "string") {
    const key = String(when.notSet);
    return out[key] === undefined;
  }

  if (typeof when.exists === "string") {
    const val = getContextValue(ctx, String(when.exists));
    return isTruthyValue(val);
  }

  if (when.regex && typeof when.regex === "object") {
    const inputName = String(when.regex.input);
    const regexName = String(when.regex.regex);
    const re = regexes[regexName];
    if (!re) return false;
    const val = getContextValue(ctx, inputName);
    if (!isTruthyValue(val)) return false;
    return re.test(String(val));
  }

  if (when.equals && typeof when.equals === "object") {
    const inputName = String(when.equals.input);
    const expected = when.equals.value;
    const val = getContextValue(ctx, inputName);
    if (!isTruthyValue(val)) return false;
    return String(val) === String(expected);
  }

  if (Array.isArray(when.anyOf)) {
    return when.anyOf.some((c: any) => evalCondition(c, ctx, out, regexes));
  }

  if (Array.isArray(when.allOf)) {
    return when.allOf.every((c: any) => evalCondition(c, ctx, out, regexes));
  }

  if (when.not) {
    return !evalCondition(when.not, ctx, out, regexes);
  }

  return false;
}

function resolveLookupTable(
  mapName: string,
  config: ReturnType<typeof loadPropertyDetectionConfig>,
): Record<string, string> | undefined {
  return config.lookupTables?.[mapName];
}

function resolveAssignment(
  assignment: any,
  ctx: InferenceContext,
  out: Record<string, unknown>,
  config: ReturnType<typeof loadPropertyDetectionConfig>,
): unknown | undefined {
  if (assignment === undefined) return undefined;
  if (assignment === null) return null;

  const type = typeof assignment;
  if (type !== "object") {
    // Primitive constant.
    return assignment;
  }

  const obj = assignment as any;

  if (typeof obj.fromInput === "string") {
    const v = getContextValue(ctx, obj.fromInput);
    return v === undefined ? undefined : v;
  }

  if (
    obj.preferInputOrConstant &&
    typeof obj.preferInputOrConstant === "object"
  ) {
    const inputName = String(obj.preferInputOrConstant.input);
    const fallback = obj.preferInputOrConstant.fallback;
    const v = getContextValue(ctx, inputName);
    return isTruthyValue(v) ? v : fallback;
  }

  if (obj.lookup && typeof obj.lookup === "object") {
    const lookup = obj.lookup as any;
    const mapName = String(lookup.map);
    const keyInput = String(lookup.keyInput);
    const transform =
      typeof lookup.transform === "string" ? lookup.transform : undefined;
    const onMissing = lookup.onMissing as string | undefined;

    const table = resolveLookupTable(mapName, config);
    if (!table) return undefined;

    const keyVal = getContextValue(ctx, keyInput);
    if (typeof keyVal !== "string") return undefined;

    const mapKey = transform === "lowercase" ? keyVal.toLowerCase() : keyVal;
    const found = table[mapKey];

    if (found === undefined) {
      if (onMissing === "skip") return undefined;
      return undefined;
    }

    return found;
  }

  // Unknown object shape => treat as unset.
  return undefined;
}

function applySet(
  setSpec: any,
  ctx: InferenceContext,
  out: Record<string, unknown>,
  config: ReturnType<typeof loadPropertyDetectionConfig>,
): void {
  if (!setSpec || typeof setSpec !== "object") return;

  for (const [key, assignment] of Object.entries(setSpec)) {
    const resolved = resolveAssignment(assignment, ctx, out, config);
    if (resolved === undefined) continue;
    out[key] = resolved;
  }
}

export function getPropertiesFromFinding(
  finding: RawFinding,
  fileContent?: string,
): Record<string, unknown> {
  const config = loadPropertyDetectionConfig();
  const { regexes, inferenceRules } = config;

  const out: Record<string, unknown> = {};
  const content = fileContent ?? "";

  const props = (finding.properties ?? {}) as Record<string, unknown>;

  const strategy =
    typeof props.strategy === "string" ? props.strategy : undefined;
  const library = typeof props.library === "string" ? props.library : undefined;
  const strategyStr = [strategy, library, content].filter(Boolean).join(" ");

  const context: InferenceContext = {
    // Common inputs.
    content,
    key: typeof props.key === "string" ? props.key : undefined,
    library,
    strategy,
    strategyStr,
    // External API inputs.
    serviceName:
      typeof props.serviceName === "string" ? props.serviceName : undefined,
    documentationUrl:
      typeof props.documentationUrl === "string"
        ? props.documentationUrl
        : undefined,
    apiVersion:
      typeof props.apiVersion === "string" ? props.apiVersion : undefined,
    url: typeof props.url === "string" ? props.url : undefined,
    // Route inputs.
    httpMethods: props.httpMethods,
    path: typeof props.path === "string" ? props.path : undefined,
  };

  const rules = inferenceRules[finding.pattern];
  if (!Array.isArray(rules)) return out;

  for (const rawRule of rules) {
    const rule = rawRule as RuleSpec;
    if (!rule || typeof rule !== "object") continue;

    const ok = evalCondition(rule.when, context, out, regexes);
    if (!ok) continue;

    applySet(rule.set, context, out, config);
  }

  return out;
}

