import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";

const managedResourceSchema = z.object({
  kind: z.enum(["database", "cache"]),
  viaClients: z.array(z.string().min(1)).default([]),
  directClients: z.array(z.string().min(1)).default([]),
  matchHints: z.array(z.string().min(1)).default([]),
});

const managedServiceNodeSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  componentType: z.enum(["asset", "third_party"]).default("asset"),
  componentSubType: z.string().min(1),
  flowType: z
    .enum(["api_call", "database_query", "message_queue", "file_transfer", "webhook", "rpc"])
    .default("api_call"),
  usageSignals: z.array(z.string().min(1)).default([]),
  alwaysInclude: z.boolean().default(false),
  evidencePatterns: z.array(z.string().min(1)).default([]),
  /** HashiCorp AWS provider-style `resource` type names (lowercase), e.g. `aws_lambda_function`. */
  terraformResourceTypes: z.array(z.string().min(1)).default([]),
  /** Prefixes on `resource_type`, e.g. `aws_s3_` matches `aws_s3_bucket`, `aws_s3_bucket_acl`. */
  terraformResourceTypePrefixes: z.array(z.string().min(1)).default([]),
});

const providerConfidenceSchema = z.object({
  managedNodeMinConfidence: z.number().min(0).max(1).default(0.78),
  providerToManagedNodeFlowConfidence: z.number().min(0).max(1).default(0.78),
  providerToManagedResourceFlowConfidence: z.number().min(0).max(1).default(0.75),
  sourceToProviderFlowConfidenceFloor: z.number().min(0).max(1).default(0.72),
  rewiredFlowConfidenceFloor: z.number().min(0).max(1).default(0.75),
  collapseManagedPostgresFlowConfidence: z.number().min(0).max(1).default(0.78),
});
const managedResourceMatchHintsByKindSchema = z.object({
  database: z.array(z.string().min(1)).default(["postgres", "pg", "mysql", "mongo", "sql"]),
  cache: z.array(z.string().min(1)).default(["redis", "cache", "kv"]),
});
const fallbackPolicySchema = z.object({
  nonConcreteSectionIds: z.array(z.string().min(1)).default(["root", "<unsectioned>", "global"]),
  actorTargetReverseConfidenceFloor: z.number().min(0).max(1).default(0.8),
  preferredApiSourceConfidenceFloor: z.number().min(0).max(1).default(0.75),
  crossSectionActorAssetFlowConfidence: z.number().min(0).max(1).default(0.7),
  rewriteThroughProviderFlowTypes: z
    .array(
      z.enum(["api_call", "database_query", "message_queue", "file_transfer", "webhook", "rpc"]),
    )
    .default(["database_query", "api_call"]),
  postgresLikeSignals: z.array(z.string().min(1)).default(["postgres", "pg", "postgresql"]),
  genericPgNodeNames: z.array(z.string().min(1)).default(["pg", "postgres", "postgresql"]),
  genericPgClientSignals: z
    .array(z.string().min(1))
    .default(["pg", "postgres", "postgresql", "node-postgres", "psycopg", "psycopg2"]),
  implicitManagedPostgresNodeKeys: z.array(z.string().min(1)).default(["postgres"]),
  managedResourceMatchHintsByKind: managedResourceMatchHintsByKindSchema.optional(),
});
const defaultProviderConfidence = {
  managedNodeMinConfidence: 0.78,
  providerToManagedNodeFlowConfidence: 0.78,
  providerToManagedResourceFlowConfidence: 0.75,
  sourceToProviderFlowConfidenceFloor: 0.72,
  rewiredFlowConfidenceFloor: 0.75,
  collapseManagedPostgresFlowConfidence: 0.78,
} as const;

const providerTopologyRuleSchema = z.object({
  providerId: z.string().min(1),
  providerDisplayName: z.string().min(1).optional(),
  canonicalServiceName: z.string().min(1).optional(),
  providerMatchKeys: z.array(z.string().min(1)).default([]),
  allowManagedDatabaseSharedFileInference: z.boolean().default(false),
  confidence: providerConfidenceSchema.optional(),
  managedResources: z.array(managedResourceSchema).default([]),
  managedServiceNodes: z.array(managedServiceNodeSchema).default([]),
});

const providerTopologyCatalogSchema = z.object({
  provider_topology_rules: z.array(providerTopologyRuleSchema).default([]),
  fallback_policy: fallbackPolicySchema.optional(),
});

export interface ManagedResourceRule {
  kind: "database" | "cache";
  viaClients: string[];
  directClients: string[];
  matchHints: string[];
}

export interface ProviderTopologyRule {
  providerId: string;
  providerDisplayName: string;
  canonicalServiceName: string;
  providerMatchKeys: string[];
  allowManagedDatabaseSharedFileInference: boolean;
  confidence: {
    managedNodeMinConfidence: number;
    providerToManagedNodeFlowConfidence: number;
    providerToManagedResourceFlowConfidence: number;
    sourceToProviderFlowConfidenceFloor: number;
    rewiredFlowConfidenceFloor: number;
    collapseManagedPostgresFlowConfidence: number;
  };
  managedResources: ManagedResourceRule[];
  managedServiceNodes: Array<{
    key: string;
    label: string;
    componentType: "asset" | "third_party";
    componentSubType: string;
    flowType:
      | "api_call"
      | "database_query"
      | "message_queue"
      | "file_transfer"
      | "webhook"
      | "rpc";
    usageSignals: string[];
    alwaysInclude: boolean;
    evidencePatterns: string[];
    terraformResourceTypes: string[];
    terraformResourceTypePrefixes: string[];
  }>;
}

export interface FallbackPolicy {
  nonConcreteSectionIds: string[];
  actorTargetReverseConfidenceFloor: number;
  preferredApiSourceConfidenceFloor: number;
  crossSectionActorAssetFlowConfidence: number;
  rewriteThroughProviderFlowTypes: Array<
    "api_call" | "database_query" | "message_queue" | "file_transfer" | "webhook" | "rpc"
  >;
  postgresLikeSignals: string[];
  genericPgNodeNames: string[];
  genericPgClientSignals: string[];
  implicitManagedPostgresNodeKeys: string[];
  managedResourceMatchHintsByKind: {
    database: string[];
    cache: string[];
  };
}

let cachedRules: ProviderTopologyRule[] | undefined;
let cachedFallbackPolicy: FallbackPolicy | undefined;

export function clearProviderTopologyRulesCacheForTest(): void {
  cachedRules = undefined;
  cachedFallbackPolicy = undefined;
}

function getProviderTopologyRulesPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const cliRoot =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "..", "..");
  return path.join(cliRoot, "patterns", "provider-topology.rules.yaml");
}

export function loadProviderTopologyRules(): ProviderTopologyRule[] {
  if (cachedRules) return cachedRules;
  const configPath = getProviderTopologyRulesPath();

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Provider topology rules are required but could not be read from '${configPath}': ${message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Provider topology rules at '${configPath}' could not be parsed as YAML: ${message}`,
    );
  }

  let normalized: z.infer<typeof providerTopologyCatalogSchema>;
  try {
    normalized = providerTopologyCatalogSchema.parse(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Provider topology rules at '${configPath}' failed schema validation: ${message}`,
    );
  }

  cachedRules = normalized.provider_topology_rules.map((rule) => ({
    providerId: rule.providerId.trim().toLowerCase(),
    providerDisplayName: (rule.providerDisplayName ?? rule.providerId).trim(),
    canonicalServiceName: (rule.canonicalServiceName ?? rule.providerId)
      .trim()
      .toLowerCase(),
    providerMatchKeys: rule.providerMatchKeys.map((k) => k.trim().toLowerCase()),
    allowManagedDatabaseSharedFileInference: rule.allowManagedDatabaseSharedFileInference,
    confidence: { ...defaultProviderConfidence, ...(rule.confidence ?? {}) },
    managedResources: rule.managedResources.map((resource) => ({
      kind: resource.kind,
      viaClients: resource.viaClients.map((k) => k.trim().toLowerCase()),
      directClients: resource.directClients.map((k) => k.trim().toLowerCase()),
      matchHints: resource.matchHints.map((k) => k.trim().toLowerCase()),
    })),
    managedServiceNodes: rule.managedServiceNodes.map((node) => ({
      key: node.key.trim().toLowerCase(),
      label: node.label.trim(),
      componentType: node.componentType,
      componentSubType: node.componentSubType.trim().toLowerCase(),
      flowType: node.flowType,
      usageSignals: node.usageSignals.map((k) => k.trim().toLowerCase()),
      alwaysInclude: node.alwaysInclude,
      evidencePatterns: node.evidencePatterns.map((k) => k.trim().toLowerCase()),
      terraformResourceTypes: node.terraformResourceTypes.map((t) => t.trim().toLowerCase()),
      terraformResourceTypePrefixes: node.terraformResourceTypePrefixes.map((p) =>
        p.trim().toLowerCase(),
      ),
    })),
  }));
  const rawPolicy = normalized.fallback_policy ?? fallbackPolicySchema.parse({});
  const managedResourceMatchHintsByKind =
    rawPolicy.managedResourceMatchHintsByKind ?? managedResourceMatchHintsByKindSchema.parse({});
  cachedFallbackPolicy = {
    nonConcreteSectionIds: rawPolicy.nonConcreteSectionIds.map((value) =>
      value.trim().toLowerCase(),
    ),
    actorTargetReverseConfidenceFloor: rawPolicy.actorTargetReverseConfidenceFloor,
    preferredApiSourceConfidenceFloor: rawPolicy.preferredApiSourceConfidenceFloor,
    crossSectionActorAssetFlowConfidence: rawPolicy.crossSectionActorAssetFlowConfidence,
    rewriteThroughProviderFlowTypes: rawPolicy.rewriteThroughProviderFlowTypes,
    postgresLikeSignals: rawPolicy.postgresLikeSignals.map((value) =>
      value.trim().toLowerCase(),
    ),
    genericPgNodeNames: rawPolicy.genericPgNodeNames.map((value) =>
      value.trim().toLowerCase(),
    ),
    genericPgClientSignals: rawPolicy.genericPgClientSignals.map((value) =>
      value.trim().toLowerCase(),
    ),
    implicitManagedPostgresNodeKeys: rawPolicy.implicitManagedPostgresNodeKeys.map((value) =>
      value.trim().toLowerCase(),
    ),
    managedResourceMatchHintsByKind: {
      database: managedResourceMatchHintsByKind.database.map((value) =>
        value.trim().toLowerCase(),
      ),
      cache: managedResourceMatchHintsByKind.cache.map((value) =>
        value.trim().toLowerCase(),
      ),
    },
  };
  return cachedRules;
}

export function loadProviderTopologyFallbackPolicy(): FallbackPolicy {
  if (!cachedFallbackPolicy) {
    loadProviderTopologyRules();
  }
  if (cachedFallbackPolicy) return cachedFallbackPolicy;
  const fallback = fallbackPolicySchema.parse({});
  const managedResourceMatchHintsByKind =
    fallback.managedResourceMatchHintsByKind ?? managedResourceMatchHintsByKindSchema.parse({});
  return {
    ...fallback,
    implicitManagedPostgresNodeKeys: fallback.implicitManagedPostgresNodeKeys.map((value) =>
      value.trim().toLowerCase(),
    ),
    managedResourceMatchHintsByKind: {
      database: managedResourceMatchHintsByKind.database.map((value) => value.trim().toLowerCase()),
      cache: managedResourceMatchHintsByKind.cache.map((value) => value.trim().toLowerCase()),
    },
  };
}
