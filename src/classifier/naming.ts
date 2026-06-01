import type { NameNormalizationConfig } from "./config";

function escapeForCharClass(input: string): string {
  return input.replace(/[-\\^$*+?.()|[\]{}]/g, "\\$&");
}

export function normalizeComponentName(
  rawName: string,
  rules: NameNormalizationConfig,
): string {
  let name = rawName.trim();
  if (!name) {
    return "";
  }

  let lower = name.toLowerCase();

  // Remove simple suffix tokens (case-insensitive).
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

  // Apply regex-based suffix removals.
  for (const regex of rules.removeSuffixPatterns) {
    lower = lower.replace(regex, "").trim();
  }

  // Trim configured characters from start/end.
  if (rules.trimChars && rules.trimChars.length > 0) {
    const escaped = escapeForCharClass(rules.trimChars);
    const boundaryRegex = new RegExp(
      `^[${escaped}]+|[${escaped}]+$`,
      "g",
    );
    lower = lower.replace(boundaryRegex, "").trim();
  }

  // Collapse common separators to a single space.
  lower = lower.replace(/[\s_\-]+/g, " ").trim();

  if (!lower) {
    return rawName.trim().toLowerCase();
  }

  return lower;
}

export function toDisplayName(normalized: string, fallback: string): string {
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

export function normalizeApiDisplayName(
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

