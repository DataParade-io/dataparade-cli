import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import type { ManagedResourceRule } from "./provider-topology-rules";

export function getStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value.toLowerCase()];
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase());
}

export function componentMatchesProvider(
  component: DetectedComponent,
  keys: string[],
): boolean {
  const serviceNameValues = getStringValues(component.properties?.serviceName);
  const name = (component.name || "").trim().toLowerCase();
  const corpus = new Set<string>([name, ...serviceNameValues]);
  const providerKey = component.properties?.provider_name;
  if (typeof providerKey === "string" && providerKey.trim()) {
    corpus.add(providerKey.trim().toLowerCase());
  }
  return keys.some((k) => corpus.has(k) || name.includes(k));
}

export function isManagedResourceComponent(
  component: DetectedComponent,
  managedResource: ManagedResourceRule,
): boolean {
  if (!(component.type === "asset" && component.subType === "database")) return false;
  const clients = getStringValues(component.properties?.client);
  const dbTypeValues = getStringValues(component.properties?.databaseType);
  const name = (component.name || "").toLowerCase();
  const corpus = [...clients, ...dbTypeValues, name];
  if (managedResource.kind === "database") {
    return corpus.some(
      (v) =>
        v.includes("postgres") ||
        v.includes("pg") ||
        v.includes("mysql") ||
        v.includes("mongo") ||
        v.includes("sql"),
    );
  }
  if (managedResource.kind === "cache") {
    return corpus.some(
      (v) =>
        v.includes("redis") ||
        v.includes("cache") ||
        v.includes("kv"),
    );
  }
  return false;
}

export function hasAnyClientMatch(component: DetectedComponent, keys: string[]): boolean {
  if (keys.length === 0) return false;
  const clients = getStringValues(component.properties?.client);
  return clients.some((client) => keys.some((k) => client.includes(k)));
}

export function hasDirectClientMatch(
  component: DetectedComponent,
  directKeys: string[],
  viaKeys: string[],
): boolean {
  if (directKeys.length === 0) return false;
  const clients = getStringValues(component.properties?.client);
  return clients.some((client) => {
    const matchesDirect = directKeys.some((k) => client.includes(k));
    if (!matchesDirect) return false;
    const matchesVia = viaKeys.some((k) => client.includes(k));
    return !matchesVia;
  });
}

export function normalizeSectionId(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "root" || value === "<unsectioned>" || value === "global") {
    return "";
  }
  return value;
}

export function areSectionCompatible(
  source: DetectedComponent,
  provider: DetectedComponent,
  target: DetectedComponent,
): boolean {
  const sourceSection = normalizeSectionId(source.properties?.section_id);
  const providerSection = normalizeSectionId(provider.properties?.section_id);
  const targetSection = normalizeSectionId(target.properties?.section_id);

  if (providerSection && targetSection && providerSection !== targetSection) {
    return false;
  }
  if (sourceSection && providerSection && sourceSection !== providerSection) {
    return false;
  }
  return true;
}

export function areComponentsSectionCompatible(
  left: DetectedComponent,
  right: DetectedComponent,
): boolean {
  const leftSection = normalizeSectionId(left.properties?.section_id);
  const rightSection = normalizeSectionId(right.properties?.section_id);
  if (leftSection && rightSection && leftSection !== rightSection) {
    return false;
  }
  return true;
}

export function providerUsageCorpus(
  provider: DetectedComponent,
  flows: DetectedDataFlow[],
): string[] {
  const corpus: string[] = [];
  for (const loc of provider.sourceLocations ?? []) {
    if (loc.filePath) corpus.push(loc.filePath.toLowerCase());
  }
  for (const ref of provider.detectedFrom ?? []) {
    if (ref.pattern) corpus.push(String(ref.pattern).toLowerCase());
    const fp = ref.sourceLocation?.filePath;
    if (fp) corpus.push(fp.toLowerCase());
  }
  for (const flow of flows) {
    if (flow.targetComponentId !== provider.id && flow.sourceComponentId !== provider.id) {
      continue;
    }
    if (flow.description) corpus.push(flow.description.toLowerCase());
    for (const loc of flow.sourceLocations ?? []) {
      if (loc.filePath) corpus.push(loc.filePath.toLowerCase());
    }
  }
  return corpus;
}

function dedupeTopologyEvidenceSourceLocations(
  locations: NonNullable<DetectedComponent["sourceLocations"]>,
): NonNullable<DetectedComponent["sourceLocations"]> {
  const seen = new Set<string>();
  const result: NonNullable<DetectedComponent["sourceLocations"]> = [];
  for (const loc of locations) {
    const key = `${loc.filePath}:${loc.startLine}:${loc.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(loc);
  }
  return result;
}

export function providerEvidenceForManagedNode(
  provider: DetectedComponent,
  managedServiceKey: string,
): Pick<DetectedComponent, "detectedFrom" | "sourceLocations"> {
  const detectedFrom = provider.detectedFrom ?? [];
  const sourceLocations = provider.sourceLocations ?? [];
  const normalizedKey = managedServiceKey.trim().toLowerCase();
  const evidencePatterns =
    normalizedKey === "postgres"
      ? new Set(["database_connection"])
      : normalizedKey === "auth"
        ? new Set(["auth_middleware"])
        : normalizedKey === "storage"
          ? new Set<string>()
          : new Set<string>();

  if (evidencePatterns.size === 0) {
    return {
      detectedFrom: [...detectedFrom],
      sourceLocations: [...sourceLocations],
    };
  }

  const filteredDetectedFrom = detectedFrom.filter((ref) =>
    evidencePatterns.has(String(ref.pattern ?? "").toLowerCase()),
  );
  const filteredSourceLocations = dedupeTopologyEvidenceSourceLocations(
    filteredDetectedFrom
      .map((ref) => ref.sourceLocation)
      .filter(
        (loc): loc is NonNullable<DetectedComponent["sourceLocations"]>[number] =>
          Boolean(loc),
      ),
  );

  return {
    detectedFrom: filteredDetectedFrom.length > 0 ? filteredDetectedFrom : [...detectedFrom],
    sourceLocations:
      filteredSourceLocations.length > 0
        ? filteredSourceLocations
        : [...sourceLocations],
  };
}

export function isProviderManagedDatabaseTarget(
  target: DetectedComponent,
  provider: DetectedComponent,
  providerId: string,
): boolean {
  const cloudProvider = String(target.properties?.cloud_provider ?? "").toLowerCase();
  const targetService = String(target.properties?.serviceName ?? "").toLowerCase();
  const targetVendor = String(target.properties?.vendor ?? "").toLowerCase();
  const providerKey = providerId.toLowerCase();
  const hints = [cloudProvider, targetService, targetVendor];
  if (hints.some((h) => h.includes(providerKey))) return true;

  const targetClients = getStringValues(target.properties?.client);
  const targetName = String(target.name ?? "").toLowerCase();
  const allowsSharedFileProviderInference = [...targetClients, targetName].some(
    (value) =>
      value.includes("pg") ||
      value.includes("postgres") ||
      value.includes("postgresql"),
  );
  if (!allowsSharedFileProviderInference) {
    return false;
  }

  const targetFiles = new Set(
    (target.sourceLocations ?? [])
      .map((loc) => loc.filePath)
      .filter((p): p is string => typeof p === "string"),
  );
  const providerFiles = new Set(
    (provider.sourceLocations ?? [])
      .map((loc) => loc.filePath)
      .filter((p): p is string => typeof p === "string"),
  );
  for (const file of targetFiles) {
    if (providerFiles.has(file)) return true;
  }
  return false;
}

/**
 * Terraform analogue of {@link providerUsageCorpus}: strings derived from
 * `resource_type`, `block_name`, and addresses (legacy / diagnostics; AWS
 * topology uses `terraformResourceTypePrefixes` in YAML instead).
 */
export function providerUsageCorpusFromTerraformAssets(
  provider: DetectedComponent,
  components: DetectedComponent[],
): string[] {
  const corpus: string[] = [];
  for (const c of components) {
    if (c.type !== "asset") continue;
    const addr = c.properties?.terraform_address;
    if (typeof addr !== "string" || addr.startsWith("provider.")) continue;
    if (!areComponentsSectionCompatible(provider, c)) continue;
    const rt = String(c.properties?.resource_type ?? "").toLowerCase();
    const bn = String(c.properties?.block_name ?? "").toLowerCase();
    if (rt) corpus.push(rt);
    if (bn) corpus.push(bn);
    corpus.push(addr.toLowerCase());
    const cp = String(c.properties?.cloud_provider ?? "").toLowerCase();
    if (cp) corpus.push(cp);
  }
  return corpus;
}

export function terraformAssetBelongsToProviderRule(
  component: DetectedComponent,
  providerId: string,
): boolean {
  const rt = String(component.properties?.resource_type ?? "").toLowerCase();
  const cp = String(component.properties?.cloud_provider ?? "").toLowerCase();
  const id = providerId.trim().toLowerCase();

  if (id === "aws") {
    return rt.startsWith("aws_") || cp === "aws";
  }
  if (id === "azure") {
    return rt.startsWith("azurerm_") || rt.startsWith("azapi_") || cp === "azure";
  }
  if (id === "kubernetes") {
    return rt.startsWith("kubernetes_") || cp === "kubernetes";
  }
  if (id === "supabase") {
    return rt.startsWith("supabase_") || cp === "supabase" || rt.includes("supabase");
  }
  if (id === "vercel") {
    return rt.startsWith("vercel_") || cp === "vercel";
  }
  return false;
}

/** Subset of managed-service node fields used for Terraform `resource_type` matching. */
export interface ManagedServiceTerraformTopologyRule {
  key: string;
  usageSignals: string[];
  terraformResourceTypes: string[];
  terraformResourceTypePrefixes: string[];
}

/**
 * Match Terraform `resource_type` against HashiCorp-provider-style names
 * (e.g. `aws_s3_bucket`, prefix `aws_s3_`).
 */
export function terraformResourceTypeMatchesTopologyRule(
  resourceType: string,
  exactTypes: string[],
  prefixes: string[],
): boolean {
  const rt = resourceType.trim().toLowerCase();
  if (!rt) return false;
  for (const t of exactTypes) {
    if (rt === t.trim().toLowerCase()) return true;
  }
  for (const p of prefixes) {
    const prefix = p.trim().toLowerCase();
    if (prefix.length > 0 && rt.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * When `terraformResourceTypes` / `terraformResourceTypePrefixes` are set on the
 * rule (see `provider-topology.rules.yaml`), Terraform matching uses **only**
 * `resource_type` — not block labels like `lambda_bucket`. Otherwise falls back
 * to `usageSignals` + {@link terraformManagedNodeConsistentWithResourceType}.
 */
export function terraformAssetMatchesManagedServiceTopologyRule(
  component: DetectedComponent,
  managedNode: ManagedServiceTerraformTopologyRule,
): boolean {
  const hasTfSchema =
    managedNode.terraformResourceTypePrefixes.length > 0 ||
    managedNode.terraformResourceTypes.length > 0;
  if (hasTfSchema) {
    const rt = String(component.properties?.resource_type ?? "");
    return terraformResourceTypeMatchesTopologyRule(
      rt,
      managedNode.terraformResourceTypes,
      managedNode.terraformResourceTypePrefixes,
    );
  }
  return (
    terraformAssetMatchesManagedServiceSignals(component, managedNode.usageSignals) &&
    terraformManagedNodeConsistentWithResourceType(component, managedNode.key)
  );
}

export function terraformSectionMatchesManagedServiceTopologyRule(
  provider: DetectedComponent,
  providerId: string,
  components: DetectedComponent[],
  managedNode: ManagedServiceTerraformTopologyRule,
): boolean {
  return components.some((c) => {
    if (c.type !== "asset") return false;
    const addr = c.properties?.terraform_address;
    if (typeof addr !== "string" || addr.startsWith("provider.")) return false;
    if (!areComponentsSectionCompatible(provider, c)) return false;
    if (!terraformAssetBelongsToProviderRule(c, providerId)) return false;
    return terraformAssetMatchesManagedServiceTopologyRule(c, managedNode);
  });
}

export function terraformAssetMatchesManagedServiceSignals(
  component: DetectedComponent,
  usageSignals: string[],
): boolean {
  const hay =
    `${String(component.properties?.resource_type ?? "").toLowerCase()} ${String(component.properties?.block_name ?? "").toLowerCase()} ${String(component.properties?.terraform_address ?? "").toLowerCase()}`;
  return usageSignals.some((sig) => hay.includes(sig.trim().toLowerCase()));
}

/**
 * Disambiguates Terraform resources when block names include words like "lambda"
 * but the resource is IAM, etc. Used only for **legacy** matching when YAML does
 * not define `terraformResourceTypePrefixes` / `terraformResourceTypes`.
 */
export function terraformManagedNodeConsistentWithResourceType(
  component: DetectedComponent,
  managedServiceKey: string,
): boolean {
  const rt = String(component.properties?.resource_type ?? "").toLowerCase();
  if (!rt) return true;

  const k = managedServiceKey.trim().toLowerCase();
  if (k === "lambda") {
    return rt.includes("lambda") && !rt.includes("iam");
  }
  if (k === "s3") {
    return rt.includes("s3");
  }
  if (k === "postgres") {
    return (
      rt.includes("rds") ||
      rt.includes("db_instance") ||
      rt.includes("aurora") ||
      rt.includes("postgres") ||
      rt.includes("redshift") ||
      rt.includes("dynamodb") ||
      rt.includes("neptune") ||
      rt.includes("documentdb")
    );
  }
  return true;
}
