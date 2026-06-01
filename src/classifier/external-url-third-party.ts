import type { RawFinding } from "../core/types/detection";
import { loadClassifierConfig } from "./config";

/**
 * Structural heuristics (not a vendor list): URLs that are obviously templated or
 * env-driven should not be treated as static third-party endpoints.
 */
const ENV_OR_DYNAMIC_URL = /\$\{|process\.env|import\.meta\.env|\bgetenv\s*\(/i;

function extractLiteralHttpUrl(finding: RawFinding): string | undefined {
  if (finding.pattern !== "external_api_call") {
    return undefined;
  }

  const props = finding.properties ?? {};
  const fromProp = typeof props.url === "string" ? props.url.trim() : "";
  const fromName =
    typeof finding.name === "string" && /^https?:\/\//i.test(finding.name)
      ? finding.name.trim()
      : "";

  const raw = fromProp || fromName;
  if (!raw || !/^https?:\/\//i.test(raw)) {
    return undefined;
  }
  if (ENV_OR_DYNAMIC_URL.test(raw)) {
    return undefined;
  }

  return raw;
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "127.0.0.1" || h === "0.0.0.0" || h === "::1") return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split(".").map((x) => Number(x));
    if (p[0] === 10) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
  }
  return false;
}

export function shouldIgnoreExternalHttpUrl(url: string | undefined): boolean {
  if (typeof url !== "string") return true;
  const t = url.trim();
  if (!/^https?:\/\//i.test(t)) return true;
  if (ENV_OR_DYNAMIC_URL.test(t)) return true;
  if (/^https?:\/\/\.\.\.(\/|$)/i.test(t)) return true;
  try {
    const hostnameRaw = new URL(t).hostname;
    if (hostnameRaw == null || !hostnameRaw || hostnameRaw.includes("${")) {
      return true;
    }
    const hostname = hostnameRaw.toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(hostname)) {
      return true;
    }
    if (isLocalOrPrivateHost(hostname)) return true;
  } catch {
    return true;
  }
  return false;
}

/**
 * Stable third-party key: registrable-style host (last two DNS labels), e.g.
 * api.openai.com → openai.com, clipdrop-api.co → clipdrop-api.co.
 */
export function deriveServiceKeyFromHostname(host: string): string {
  const h = host.replace(/^www\./, "").toLowerCase();
  const parts = h.split(".").filter(Boolean);
  if (parts.length < 2) {
    return parts[0] ?? h;
  }
  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

/**
 * Hostname + registrable domain keys from an absolute http(s) URL (for matching
 * external_api_call findings to third_party nodes by endpoint).
 */
export function urlHostMatchKeys(url: string): Set<string> {
  const keys = new Set<string>();
  const t = url.trim();
  if (!/^https?:\/\//i.test(t)) {
    return keys;
  }
  try {
    const hostnameRaw = new URL(t).hostname;
    if (hostnameRaw == null || !hostnameRaw) {
      return keys;
    }
    const hostname = hostnameRaw.toLowerCase();
    keys.add(hostname);
    keys.add(deriveServiceKeyFromHostname(hostname));
  } catch {
    // ignore malformed URLs
  }
  return keys;
}

/**
 * When YAML `url_host_patterns` do not match, derive a stable service key from the
 * URL hostname (registrable-style). Skips env-interpolated and local/private hosts.
 * Used at detection time so we do not maintain an exhaustive vendor URL list.
 */
export function defaultServiceNameFromLiteralPublicUrl(
  url: string | undefined,
): string | undefined {
  if (shouldIgnoreExternalHttpUrl(url)) {
    return undefined;
  }
  const t = (url as string).trim();
  try {
    const hostname = new URL(t).hostname;
    if (hostname == null || !hostname) {
      return undefined;
    }
    return deriveServiceKeyFromHostname(hostname);
  } catch {
    return undefined;
  }
}

const DEFAULT_INFERRED_THIRD_PARTY_SUBTYPE = "saas_service";

/**
 * Pick subType from third-party.classifier.yaml by longest matchKey substring
 * contained in the hostname (import-style keys like @scope/pkg are skipped).
 */
function inferSubTypeFromClassifierCatalog(hostname: string): string {
  const hostLower = hostname.toLowerCase();
  const { thirdParties } = loadClassifierConfig();
  let bestLen = 0;
  let bestSubType = DEFAULT_INFERRED_THIRD_PARTY_SUBTYPE;

  for (const tp of thirdParties) {
    for (const mk of tp.matchKeys) {
      const k = mk.toLowerCase().trim();
      if (k.length < 3) continue;
      if (k.startsWith("@")) continue;
      if (k.includes("/") && !k.includes(".")) continue;
      if (!hostLower.includes(k)) continue;
      if (k.length > bestLen) {
        bestLen = k.length;
        bestSubType = tp.subType;
      }
    }
  }

  return bestSubType;
}

/**
 * When a finding is an external_api_call with a literal public http(s) URL and no
 * env interpolation, treat it as a third-party SaaS/API for classification.
 */
export function inferThirdPartyFromLiteralHttpUrl(
  finding: RawFinding,
): { serviceName: string; subType: string } | undefined {
  const urlString = extractLiteralHttpUrl(finding);
  if (!urlString || shouldIgnoreExternalHttpUrl(urlString)) {
    return undefined;
  }

  let hostname: string;
  try {
    const hostnameRaw = new URL(urlString).hostname;
    if (hostnameRaw == null || !hostnameRaw) {
      return undefined;
    }
    hostname = hostnameRaw;
  } catch {
    return undefined;
  }

  if (isLocalOrPrivateHost(hostname)) {
    return undefined;
  }

  const serviceName = deriveServiceKeyFromHostname(hostname);
  if (!serviceName) {
    return undefined;
  }

  return {
    serviceName,
    subType: inferSubTypeFromClassifierCatalog(hostname),
  };
}
