import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import { appendTerraformBareProviderAttachmentFlows } from "../data-flow/terraform-flows";
import {
  loadProviderTopologyFallbackPolicy,
  loadProviderTopologyRules,
  type FallbackPolicy,
  type ManagedResourceRule,
  type ProviderTopologyRule,
} from "./provider-topology-rules";
import {
  terraformAssetBelongsToProviderRule,
  terraformAssetMatchesManagedServiceTopologyRule,
  terraformSectionMatchesManagedServiceTopologyRule,
} from "./provider-topology-shared";

function componentById(components: DetectedComponent[]): Map<string, DetectedComponent> {
  return new Map(components.map((component) => [component.id, component]));
}

function flowPairKey(flow: Pick<DetectedDataFlow, "sourceComponentId" | "targetComponentId">): string {
  return `${flow.sourceComponentId}::${flow.targetComponentId}`;
}

function preferFlow(existing: DetectedDataFlow, candidate: DetectedDataFlow): DetectedDataFlow {
  const existingFallback = existing.id.startsWith("flow_fallback_");
  const candidateFallback = candidate.id.startsWith("flow_fallback_");
  if (existingFallback !== candidateFallback) {
    return existingFallback ? candidate : existing;
  }
  return (candidate.confidence ?? 0) > (existing.confidence ?? 0) ? candidate : existing;
}

function dedupeDirectionalFlows(flows: DetectedDataFlow[]): DetectedDataFlow[] {
  const chosen = new Map<string, DetectedDataFlow>();
  const order: string[] = [];
  for (const flow of flows) {
    const key = flowPairKey(flow);
    const current = chosen.get(key);
    if (!current) {
      chosen.set(key, flow);
      order.push(key);
      continue;
    }
    chosen.set(key, preferFlow(current, flow));
  }
  return order
    .map((key) => chosen.get(key))
    .filter((flow): flow is DetectedDataFlow => Boolean(flow));
}

function unorderedFlowPairKey(
  flow: Pick<DetectedDataFlow, "sourceComponentId" | "targetComponentId">,
): string {
  return [flow.sourceComponentId, flow.targetComponentId].sort().join("::");
}

function enforceSingleDirectionPerPair(flows: DetectedDataFlow[]): DetectedDataFlow[] {
  const chosen = new Map<string, DetectedDataFlow>();
  const order: string[] = [];
  for (const flow of flows) {
    const key = unorderedFlowPairKey(flow);
    const current = chosen.get(key);
    if (!current) {
      chosen.set(key, flow);
      order.push(key);
      continue;
    }
    chosen.set(key, preferFlow(current, flow));
  }
  return order
    .map((key) => chosen.get(key))
    .filter((flow): flow is DetectedDataFlow => Boolean(flow));
}

/** True for service sections (not root / unsectioned / global). */
function isConcreteServiceSectionId(sectionId: string, policy: FallbackPolicy): boolean {
  const sid = sectionId.trim();
  if (!sid) return false;
  if (policy.nonConcreteSectionIds.includes(sid.toLowerCase())) return false;
  return true;
}

function sectionHasMainApplicationAsset(
  components: DetectedComponent[],
  sectionId: string,
): boolean {
  return components.some(
    (c) =>
      c.type === "asset" &&
      String(c.properties?.section_id ?? "") === sectionId &&
      (c.properties?.isMainApplication === true ||
        c.properties?.isMainApplication === "true"),
  );
}

function getStringValues(
  value: unknown,
): string[] {
  if (typeof value === "string") return [value.toLowerCase()];
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase());
}

function componentMatchesProvider(component: DetectedComponent, keys: string[]): boolean {
  const serviceNameValues = getStringValues(component.properties?.serviceName);
  const name = (component.name || "").trim().toLowerCase();
  const corpus = new Set<string>([name, ...serviceNameValues]);
  return keys.some((k) => corpus.has(k) || name.includes(k));
}

function isManagedResourceComponent(
  component: DetectedComponent,
  managedResource: ManagedResourceRule,
  fallbackPolicy: FallbackPolicy,
): boolean {
  if (!(component.type === "asset" && component.subType === "database")) return false;
  const clients = getStringValues(component.properties?.client);
  const dbTypeValues = getStringValues(component.properties?.databaseType);
  const name = (component.name || "").toLowerCase();
  const corpus = [...clients, ...dbTypeValues, name];
  const hints =
    managedResource.matchHints.length > 0
      ? managedResource.matchHints
      : fallbackPolicy.managedResourceMatchHintsByKind[managedResource.kind];
  if (managedResource.kind === "database") {
    return corpus.some((v) => hints.some((hint) => v.includes(hint)));
  }
  if (managedResource.kind === "cache") {
    return corpus.some((v) => hints.some((hint) => v.includes(hint)));
  }
  return false;
}

function hasAnyClientMatch(component: DetectedComponent, keys: string[]): boolean {
  if (keys.length === 0) return false;
  const clients = getStringValues(component.properties?.client);
  return clients.some((client) => keys.some((k) => client.includes(k)));
}

function hasDirectClientMatch(
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

function normalizeSectionId(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "root" || value === "<unsectioned>" || value === "global") {
    return "";
  }
  return value;
}

function areSectionCompatible(
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

function areComponentsSectionCompatible(
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

function providerUsageCorpus(
  provider: DetectedComponent,
  flows: DetectedDataFlow[],
): string[] {
  const corpus: string[] = [];
  const props = provider.properties ?? {};
  const propSignals = [
    provider.name,
    props.serviceName,
    props.client,
    props.vendor,
    props.integration_method,
    props.api_type,
    props.authentication_method,
    props.section_id,
    props.section_label,
    props.section_role,
  ];
  for (const signal of propSignals) {
    if (signal == null) continue;
    if (Array.isArray(signal)) {
      for (const item of signal) {
        const text = String(item ?? "").trim().toLowerCase();
        if (text) corpus.push(text);
      }
      continue;
    }
    const text = String(signal).trim().toLowerCase();
    if (text) corpus.push(text);
  }
  for (const loc of provider.sourceLocations ?? []) {
    if (loc.filePath) corpus.push(loc.filePath.toLowerCase());
  }
  for (const ref of provider.detectedFrom ?? []) {
    if (ref.pattern) corpus.push(String(ref.pattern).toLowerCase());
    const fp = ref.sourceLocation?.filePath;
    if (fp) corpus.push(fp.toLowerCase());
  }
  for (const flow of flows) {
    if (flow.targetComponentId !== provider.id && flow.sourceComponentId !== provider.id) continue;
    if (flow.description) corpus.push(flow.description.toLowerCase());
    for (const loc of flow.sourceLocations ?? []) {
      if (loc.filePath) corpus.push(loc.filePath.toLowerCase());
    }
  }
  return corpus;
}

function hasUsageSignal(corpus: string[], signals: string[]): boolean {
  if (signals.length === 0) return false;
  return signals.some((sig) => corpus.some((entry) => entry.includes(sig)));
}

function isPostgresLikeDatabase(component: DetectedComponent, policy: FallbackPolicy): boolean {
  if (!(component.type === "asset" && component.subType === "database")) return false;
  const clients = getStringValues(component.properties?.client);
  const name = (component.name || "").toLowerCase();
  const corpus = [...clients, name];
  return corpus.some((v) => policy.postgresLikeSignals.some((signal) => v.includes(signal)));
}

function isGenericLocalPgNode(component: DetectedComponent, policy: FallbackPolicy): boolean {
  if (!(component.type === "asset" && component.subType === "database")) return false;
  if (component.properties?.managed_by_provider) return false;
  const name = String(component.name ?? "").trim().toLowerCase();
  const clients = getStringValues(component.properties?.client);
  const genericName = policy.genericPgNodeNames.includes(name);
  const genericClient = clients.some((v) => policy.genericPgClientSignals.includes(v));
  return genericName || genericClient;
}

function collapseGenericPgIntoManagedProviderNodes(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
  rulesByProviderServiceName: Map<string, ProviderTopologyRule>,
  policy: FallbackPolicy,
): DetectedComponent[] {
  const managedBySection = new Map<string, string>();
  for (const component of components) {
    if (component.properties?.managed_service_key !== "postgres") continue;
    if (typeof component.properties?.managed_by_provider !== "string") continue;
    const sectionId = normalizeSectionId(component.properties?.section_id);
    if (!sectionId) continue;
    if (!managedBySection.has(sectionId)) managedBySection.set(sectionId, component.id);
  }

  const providersBySection = new Map<string, DetectedComponent[]>();
  const managedChildrenByProvider = new Map<string, number>();
  for (const component of components) {
    const sectionId = normalizeSectionId(component.properties?.section_id);
    if (!sectionId) continue;
    if (component.type === "third_party") {
      const list = providersBySection.get(sectionId) ?? [];
      list.push(component);
      providersBySection.set(sectionId, list);
    }
    const managedBy = String(component.properties?.managed_by_provider ?? "").trim();
    if (!managedBy) continue;
    managedChildrenByProvider.set(
      managedBy,
      (managedChildrenByProvider.get(managedBy) ?? 0) + 1,
    );
  }

  const flowIdsToRemove = new Set<string>();
  const removeIds = new Set<string>();
  for (const component of components) {
    if (!isGenericLocalPgNode(component, policy)) continue;
    const sectionId = normalizeSectionId(component.properties?.section_id);
    if (!sectionId) continue;
    const managedId = managedBySection.get(sectionId);
    if (!managedId || managedId === component.id) {
      const providers = providersBySection.get(sectionId) ?? [];
      const providerWithTopology = providers.find(
        (provider) => (managedChildrenByProvider.get(provider.id) ?? 0) > 0,
      );
      if (!providerWithTopology) continue;
      const providerServiceName =
        String(providerWithTopology.properties?.serviceName ?? providerWithTopology.name ?? "")
          .trim()
          .toLowerCase() || "provider";
      const providerRule = rulesByProviderServiceName.get(providerServiceName);
      const providerDisplay = providerDisplayFromServiceName(providerServiceName);
      component.name = `${providerDisplay} Pg`;
      component.properties = {
        ...component.properties,
        managed_by_provider: providerWithTopology.id,
        managed_service_key: "postgres",
        serviceName: providerWithTopology.properties?.serviceName ?? providerServiceName,
        generated_by: "provider_topology_fallback",
      };
      // Drop pre-collapse local DB flows for this node; keep provider->managed link only.
      for (const flow of flows) {
        const touchesComponent =
          flow.sourceComponentId === component.id || flow.targetComponentId === component.id;
        if (!touchesComponent) continue;
        const isProviderManagedLink =
          flow.sourceComponentId === providerWithTopology.id &&
          flow.targetComponentId === component.id;
        if (!isProviderManagedLink) flowIdsToRemove.add(flow.id);
      }
      const existingProviderEdge = flows.some(
        (flow) =>
          flow.sourceComponentId === providerWithTopology.id &&
          flow.targetComponentId === component.id,
      );
      if (!existingProviderEdge) {
        flows.push({
          id: `flow_fallback_${flows.length + 1}`,
          sourceComponentId: providerWithTopology.id,
          targetComponentId: component.id,
          type: "database_query",
          confidence: providerRule?.confidence.collapseManagedPostgresFlowConfidence ?? 0.78,
          description: `${providerWithTopology.name} provides ${component.name}`,
        });
      }
      managedBySection.set(sectionId, component.id);
      continue;
    }
    removeIds.add(component.id);
  }

  if (removeIds.size === 0 && flowIdsToRemove.size === 0) return components;
  const retainedFlows = flows.filter(
    (flow) =>
      !flowIdsToRemove.has(flow.id) &&
      !removeIds.has(flow.sourceComponentId) &&
      !removeIds.has(flow.targetComponentId) &&
      flow.sourceComponentId !== flow.targetComponentId,
  );
  flows.length = 0;
  flows.push(...retainedFlows);
  return components.filter((component) => !removeIds.has(component.id));
}

function removeDirectFlowsToManagedPostgres(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): void {
  const byId = new Map(components.map((component) => [component.id, component]));
  const retained = flows.filter((flow) => {
    const target = byId.get(flow.targetComponentId);
    if (!target) return true;
    if (target.properties?.managed_service_key !== "postgres") return true;
    const providerId = String(target.properties?.managed_by_provider ?? "");
    if (!providerId) return true;
    // Keep only provider -> managed-postgres linkage.
    if (flow.sourceComponentId === providerId) return true;
    return false;
  });
  flows.length = 0;
  flows.push(...retained);
}

function collectSectionRolledUpProviderUsageCorpus(input: {
  provider: DetectedComponent;
  providersInRule: DetectedComponent[];
  flows: DetectedDataFlow[];
}): string[] {
  const base = providerUsageCorpus(input.provider, input.flows);
  const section = normalizeSectionId(input.provider.properties?.section_id);
  if (!section) return base;

  const rolledUp: string[] = [...base];
  for (const other of input.providersInRule) {
    if (other.id === input.provider.id) continue;
    const otherSection = normalizeSectionId(other.properties?.section_id);
    if (!otherSection) continue;
    if (!otherSection.startsWith(`${section}/`)) continue;
    rolledUp.push(...providerUsageCorpus(other, input.flows));
  }
  return rolledUp;
}

function dedupeSourceLocations(
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

function providerDisplayFromServiceName(value: string): string {
  const normalized = value.trim();
  if (!normalized) return normalized;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function providerEvidenceForManagedNode(
  provider: DetectedComponent,
  managedNode: ProviderTopologyRule["managedServiceNodes"][number],
): Pick<DetectedComponent, "detectedFrom" | "sourceLocations"> {
  const detectedFrom = provider.detectedFrom ?? [];
  const sourceLocations = provider.sourceLocations ?? [];
  const evidencePatterns = new Set(managedNode.evidencePatterns);

  if (evidencePatterns.size === 0) {
    return {
      detectedFrom: [...detectedFrom],
      sourceLocations: [...sourceLocations],
    };
  }

  const filteredDetectedFrom = detectedFrom.filter((ref) =>
    evidencePatterns.has(String(ref.pattern ?? "").toLowerCase()),
  );
  const filteredSourceLocations = dedupeSourceLocations(
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

function isProviderManagedDatabaseTarget(
  target: DetectedComponent,
  provider: DetectedComponent,
  rule: ProviderTopologyRule,
): boolean {
  const cloudProvider = String(target.properties?.cloud_provider ?? "").toLowerCase();
  const targetService = String(target.properties?.serviceName ?? "").toLowerCase();
  const targetVendor = String(target.properties?.vendor ?? "").toLowerCase();
  const providerKey = rule.providerId.toLowerCase();
  const hints = [cloudProvider, targetService, targetVendor];
  if (hints.some((h) => h.includes(providerKey))) return true;

  // Shared-file inference is intentionally conservative: only Supabase gets this
  // fallback because projects often colocate supabase + pg references.
  if (!rule.allowManagedDatabaseSharedFileInference) {
    return false;
  }

  const targetClients = getStringValues(target.properties?.client);
  const targetName = String(target.name ?? "").toLowerCase();
  const databaseRule = rule.managedResources.find((resource) => resource.kind === "database");
  const sharedFileSignals = databaseRule?.directClients ?? [];
  const allowsSharedFileProviderInference = [
    ...targetClients,
    targetName,
  ].some((value) => sharedFileSignals.some((signal) => value.includes(signal)));
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

function selectPreferredApiSource(
  source: DetectedComponent,
  target: DetectedComponent,
  components: DetectedComponent[],
): DetectedComponent | undefined {
  if (source.type !== "asset") return undefined;
  if (target.type !== "third_party") return undefined;
  const isMainApp = source.properties?.isMainApplication === true;
  if (!isMainApp) return undefined;

  const sourceSection = String(source.properties?.section_id ?? "");
  const candidates = components.filter((c) => {
    if (c.id === source.id) return false;
    if (c.type !== "asset") return false;
    if (String(c.properties?.section_id ?? "") !== sourceSection) return false;
    if (c.subType !== "api") return false;
    return true;
  });
  if (candidates.length === 0) return undefined;
  return candidates[0];
}

export function applyDeterministicInferenceFallbacks(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): { components: DetectedComponent[]; dataFlows: DetectedDataFlow[] } {
  const nextComponents = components.map((c) => ({
    ...c,
    properties: { ...c.properties },
  }));
  const byId = componentById(nextComponents);
  const next = flows.map((flow) => ({ ...flow }));
  const keys = new Set(next.map((flow) => flowPairKey(flow)));
  const fallbackPolicy = loadProviderTopologyFallbackPolicy();

  for (const flow of next) {
    const source = byId.get(flow.sourceComponentId);
    const target = byId.get(flow.targetComponentId);
    if (!source || !target) continue;

    // Actor/customer should generally call the app/API, not the opposite.
    if (source.type === "asset" && target.type === "actor") {
      const originalSource = flow.sourceComponentId;
      flow.sourceComponentId = flow.targetComponentId;
      flow.targetComponentId = originalSource;
      flow.confidence = Math.max(flow.confidence, fallbackPolicy.actorTargetReverseConfidenceFloor);
    }

    // Prefer backend API nodes as caller for third-party integrations when
    // frontend/main-app and API coexist in the same section.
    const preferredApi = selectPreferredApiSource(source, target, nextComponents);
    if (preferredApi) {
      flow.sourceComponentId = preferredApi.id;
      flow.confidence = Math.max(flow.confidence, fallbackPolicy.preferredApiSourceConfidenceFloor);
    }
  }
  // Keep de-duplication keys aligned after directional rewrites above.
  keys.clear();
  for (const flow of next) {
    keys.add(flowPairKey(flow));
  }

  const providerRules = loadProviderTopologyRules();
  for (const rule of providerRules) {
    const providers = nextComponents.filter(
      (component) =>
        component.type === "third_party" &&
        componentMatchesProvider(component, rule.providerMatchKeys),
    );
    if (providers.length === 0) continue;

    for (const provider of providers) {
      const canonicalName = rule.providerDisplayName;
      const canonicalService = rule.canonicalServiceName;
      if (canonicalName && provider.name !== canonicalName) {
        provider.name = canonicalName;
      }
      provider.properties = {
        ...provider.properties,
        serviceName: canonicalService,
      };

      const sectionId = String(provider.properties?.section_id ?? "root");
      const usageCorpus = collectSectionRolledUpProviderUsageCorpus({
        provider,
        providersInRule: providers,
        flows: next,
      });
      for (const managedNode of rule.managedServiceNodes) {
        const isImplicitManagedPostgresKey =
          fallbackPolicy.implicitManagedPostgresNodeKeys.includes(managedNode.key);
        const postgresSignals = isImplicitManagedPostgresKey
          ? managedNode.usageSignals
          : [];
        const implicitManagedCandidate =
          isImplicitManagedPostgresKey
            ? nextComponents.find((c) => {
                if (!isPostgresLikeDatabase(c, fallbackPolicy)) return false;
                if (!areComponentsSectionCompatible(provider, c)) return false;
                const explicitManagedTarget = isProviderManagedDatabaseTarget(
                  c,
                  provider,
                  rule,
                );
                if (explicitManagedTarget) return true;
                // Provider-agnostic fallback: if provider section usage strongly
                // signals managed postgres and local DB is postgres-like, adopt it.
                return hasUsageSignal(usageCorpus, postgresSignals);
              })
            : undefined;

        const terraformTargetsForNode = nextComponents.filter((c) => {
          if (c.type !== "asset") return false;
          if (typeof c.properties?.managed_by_provider === "string") return false;
          const addr = c.properties?.terraform_address;
          if (typeof addr !== "string" || addr.startsWith("provider.")) return false;
          if (!areComponentsSectionCompatible(provider, c)) return false;
          if (!terraformAssetBelongsToProviderRule(c, rule.providerId)) return false;
          return terraformAssetMatchesManagedServiceTopologyRule(c, managedNode);
        });

        const corpusMatchFromCode = managedNode.usageSignals.some((sig) =>
          usageCorpus.some((entry) => entry.includes(sig)),
        );
        const terraformTopologyEvidence = terraformSectionMatchesManagedServiceTopologyRule(
          provider,
          rule.providerId,
          nextComponents,
          managedNode,
        );
        const corpusMatch = corpusMatchFromCode || terraformTopologyEvidence;

        const shouldInclude =
          Boolean(implicitManagedCandidate) ||
          terraformTargetsForNode.length > 0 ||
          managedNode.alwaysInclude ||
          corpusMatch;
        if (!shouldInclude) continue;

        if (terraformTargetsForNode.length > 0) {
          const multi = terraformTargetsForNode.length > 1;
          for (const t of terraformTargetsForNode) {
            const blockLabel = String(t.properties?.block_name ?? "").trim();
            t.name = multi
              ? `${managedNode.label} · ${blockLabel || t.id}`
              : managedNode.label;
            t.type = managedNode.componentType;
            t.subType = managedNode.componentSubType;
            t.properties = {
              ...t.properties,
              managed_by_provider: provider.id,
              managed_service_key: managedNode.key,
              serviceName: provider.properties?.serviceName ?? rule.providerId,
              generated_by: "provider_topology_fallback",
              section_id: t.properties?.section_id ?? sectionId,
              section_label: t.properties?.section_label ?? provider.properties?.section_label,
              section_role: t.properties?.section_role ?? provider.properties?.section_role,
            };

            const providerToServiceKey = `${provider.id}::${t.id}`;
            if (!keys.has(providerToServiceKey)) {
              keys.add(providerToServiceKey);
              next.push({
                id: `flow_fallback_${next.length + 1}`,
                sourceComponentId: provider.id,
                targetComponentId: t.id,
                type: managedNode.flowType,
                confidence: rule.confidence.providerToManagedNodeFlowConfidence,
                description: `${provider.name} provides ${t.name}`,
              });
            }
          }
          continue;
        }

        const existing = nextComponents.find(
          (c) =>
            c.properties?.managed_by_provider === provider.id &&
            c.properties?.managed_service_key === managedNode.key,
        );
        const existingImplicitManaged = !existing ? implicitManagedCandidate : undefined;
        const serviceNode =
          existingImplicitManaged ??
          existing ??
          (() => {
            const managedEvidence = providerEvidenceForManagedNode(
              provider,
              managedNode,
            );
            const id = `cmp_managed_${rule.providerId}_${managedNode.key}_${nextComponents.length + 1}`;
            const created: DetectedComponent = {
              id,
              name: managedNode.label,
              type: managedNode.componentType,
              subType: managedNode.componentSubType,
              confidence: Math.max(rule.confidence.managedNodeMinConfidence, provider.confidence),
              detectedFrom: managedEvidence.detectedFrom,
              sourceLocations: managedEvidence.sourceLocations,
              properties: {
                section_id: sectionId,
                section_label: provider.properties?.section_label ?? sectionId,
                section_role: provider.properties?.section_role ?? "service",
                managed_by_provider: provider.id,
                managed_service_key: managedNode.key,
                serviceName: provider.properties?.serviceName ?? rule.providerId,
                generated_by: "provider_topology_fallback",
              },
            };
            nextComponents.push(created);
            byId.set(id, created);
            return created;
          })();

        if (serviceNode === existingImplicitManaged) {
          serviceNode.name = managedNode.label;
          serviceNode.properties = {
            ...serviceNode.properties,
            managed_by_provider: provider.id,
            managed_service_key: managedNode.key,
            generated_by: "provider_topology_fallback",
          };
        }

        const providerToServiceKey = `${provider.id}::${serviceNode.id}`;
        if (!keys.has(providerToServiceKey)) {
          keys.add(providerToServiceKey);
          next.push({
            id: `flow_fallback_${next.length + 1}`,
            sourceComponentId: provider.id,
            targetComponentId: serviceNode.id,
            type: managedNode.flowType,
            confidence: rule.confidence.providerToManagedNodeFlowConfidence,
            description: `${provider.name} provides ${serviceNode.name}`,
          });
        }
      }

      for (const managedResource of rule.managedResources) {
        const managedTargets = nextComponents.filter((component) => {
          if (!isManagedResourceComponent(component, managedResource, fallbackPolicy)) return false;
          if (!areComponentsSectionCompatible(provider, component)) return false;
          const viaClientMatch = hasAnyClientMatch(component, managedResource.viaClients);
          const providerManagedHint = isProviderManagedDatabaseTarget(
            component,
            provider,
            rule,
          );
          if (!viaClientMatch && !providerManagedHint) return false;
          return true;
        });

        for (const target of managedTargets) {
          if (!areComponentsSectionCompatible(provider, target)) continue;
          const providerToTargetKey = `${provider.id}::${target.id}`;
          if (!keys.has(providerToTargetKey)) {
            keys.add(providerToTargetKey);
            next.push({
              id: `flow_fallback_${next.length + 1}`,
              sourceComponentId: provider.id,
              targetComponentId: target.id,
              type: "database_query",
              confidence: rule.confidence.providerToManagedResourceFlowConfidence,
              description: `${provider.name} managed ${target.name}`,
            });
          }

          const directAccessExists = hasDirectClientMatch(
            target,
            managedResource.directClients,
            managedResource.viaClients,
          );
          const providerManagedHint = isProviderManagedDatabaseTarget(
            target,
            provider,
            rule,
          );
          if (directAccessExists && !providerManagedHint) continue;

          for (const flow of next) {
            if (flow.targetComponentId !== target.id) continue;
            if (flow.sourceComponentId === provider.id) continue;
            const sourceComponent = byId.get(flow.sourceComponentId);
            if (!sourceComponent) continue;
            if (!areSectionCompatible(sourceComponent, provider, target)) continue;

            const sourceTfAddr = sourceComponent.properties?.terraform_address;
            if (
              typeof sourceTfAddr === "string" &&
              sourceTfAddr.trim().length > 0
            ) {
              // IaC resources already live in the provider plane; skip SDK-style
              // "source → provider" hops and keep direct edges (e.g. RDS → managed PG).
              continue;
            }

            const preferredSource =
              selectPreferredApiSource(sourceComponent, provider, nextComponents) ??
              sourceComponent;

            const sourceToProviderKey = `${preferredSource.id}::${provider.id}`;
            if (!keys.has(sourceToProviderKey)) {
              keys.add(sourceToProviderKey);
              next.push({
                id: `flow_fallback_${next.length + 1}`,
                sourceComponentId: preferredSource.id,
                targetComponentId: provider.id,
                type: "api_call",
                confidence: Math.max(rule.confidence.sourceToProviderFlowConfidenceFloor, flow.confidence),
                description: `${preferredSource.id} accesses ${target.name} via ${provider.name}`,
              });
            }

            if (
              fallbackPolicy.rewriteThroughProviderFlowTypes.includes(flow.type)
            ) {
              flow.sourceComponentId = provider.id;
              flow.confidence = Math.max(flow.confidence, rule.confidence.rewiredFlowConfidenceFloor);
            }
          }
        }
      }
    }
  }

  const rulesByProviderServiceName = new Map<string, ProviderTopologyRule>();
  for (const rule of providerRules) {
    rulesByProviderServiceName.set(rule.providerId, rule);
    rulesByProviderServiceName.set(rule.canonicalServiceName, rule);
  }
  const collapsedComponents = collapseGenericPgIntoManagedProviderNodes(
    nextComponents,
    next,
    rulesByProviderServiceName,
    fallbackPolicy,
  );
  removeDirectFlowsToManagedPostgres(collapsedComponents, next);

  appendTerraformBareProviderAttachmentFlows({
    components: collapsedComponents,
    flows: next,
    pairKeys: keys,
  });

  // Cross-section fallback: if an actor and an asset exist in different
  // sections with no link, ensure at least one directional api_call edge.
  for (const source of components) {
    for (const target of components) {
      if (source.id === target.id) continue;
      if (source.type !== "actor") continue;
      if (target.type !== "asset") continue;
      const sourceSection = String(source.properties.section_id ?? "");
      const targetSection = String(target.properties.section_id ?? "");
      if (!targetSection || sourceSection === targetSection) continue;
      // Do not synthesize edges from a section-scoped actor into another service
      // section (avoids cross-section service graph edges in monorepos).
      if (isConcreteServiceSectionId(sourceSection, fallbackPolicy)) continue;
      // When the target section already has a main application, actor→app edges are
      // emitted by data-flow postprocess — skip redundant actor→leaf shortcuts.
      if (sectionHasMainApplicationAsset(collapsedComponents, targetSection)) continue;
      const key = `${source.id}::${target.id}`;
      if (keys.has(key)) continue;
      keys.add(key);
      next.push({
        id: `flow_fallback_${next.length + 1}`,
        sourceComponentId: source.id,
        targetComponentId: target.id,
        type: "api_call",
        confidence: fallbackPolicy.crossSectionActorAssetFlowConfidence,
      });
    }
  }

  const dedupedDirectional = dedupeDirectionalFlows(next);
  const singleDirectionFlows = enforceSingleDirectionPerPair(dedupedDirectional);
  return { components: collapsedComponents, dataFlows: singleDirectionFlows };
}

