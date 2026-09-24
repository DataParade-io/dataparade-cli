import type { DetectedComponent } from '../core/types/component';
import type { DetectedDataFlow } from '../core/types/data-flow';
import {
  loadProviderTopologyFallbackPolicy,
  type FallbackPolicy,
} from './provider-topology-rules';

export type ScanRedFlagCode =
  | 'missing_section_hub'
  | 'disconnected_handler'
  | 'disconnected_section_node';

export interface ScanRedFlag {
  code: ScanRedFlagCode;
  severity: 'red';
  sectionId?: string;
  componentId?: string;
  message: string;
}

const HANDLER_PATTERN_IDS = new Set([
  'lambda_handler',
  'aws_lambda',
  'aws_lambda_go',
  'serverless_handler',
]);

function flowPairKey(
  flow: Pick<DetectedDataFlow, 'sourceComponentId' | 'targetComponentId'>
): string {
  return `${flow.sourceComponentId}::${flow.targetComponentId}`;
}

function isConcreteServiceSectionId(
  sectionId: string,
  policy: FallbackPolicy
): boolean {
  const sid = sectionId.trim();
  if (!sid) return false;
  if (policy.nonConcreteSectionIds.includes(sid.toLowerCase())) return false;
  return true;
}

function isMainApplication(component: DetectedComponent): boolean {
  return (
    component.properties?.isMainApplication === true ||
    component.properties?.isMainApplication === 'true'
  );
}

function sectionIdOf(component: DetectedComponent): string {
  return String(component.properties?.section_id ?? '').trim();
}

/**
 * Serverless entrypoint assets that should be absorbed into Aws Lambda —
 * not the managed Lambda compute node itself.
 */
export function isAbsorbableServerlessHandler(
  component: DetectedComponent
): boolean {
  if (component.type !== 'asset') return false;
  if (typeof component.properties?.managed_service_key === 'string') {
    return false;
  }
  if (component.subType === 'compute_service') return false;
  if (component.properties?.handlerType === 'serverless_handler') return true;
  const fromHandlerPattern = (component.detectedFrom ?? []).some((ref) =>
    HANDLER_PATTERN_IDS.has(String(ref.pattern ?? '').toLowerCase())
  );
  if (fromHandlerPattern) return true;
  if (component.subType === 'function') {
    const name = (component.name || '').toLowerCase();
    return name.includes('lambda') || name.includes('handler');
  }
  return false;
}

/** @deprecated Prefer {@link isAbsorbableServerlessHandler}; kept for flag messaging. */
function isHandlerAsset(component: DetectedComponent): boolean {
  return isAbsorbableServerlessHandler(component);
}

function incidentComponentIds(flows: DetectedDataFlow[]): Set<string> {
  const ids = new Set<string>();
  for (const flow of flows) {
    ids.add(flow.sourceComponentId);
    ids.add(flow.targetComponentId);
  }
  return ids;
}

function findSectionHub(
  components: DetectedComponent[],
  sectionId: string
): DetectedComponent | undefined {
  return components.find(
    (c) =>
      c.type === 'asset' && sectionIdOf(c) === sectionId && isMainApplication(c)
  );
}

function findManagedLambda(
  components: DetectedComponent[],
  sectionId: string
): DetectedComponent | undefined {
  return components.find((c) => {
    if (sectionIdOf(c) !== sectionId) return false;
    if (c.properties?.managed_service_key === 'lambda') return true;
    if (c.subType === 'compute_service' && /lambda/i.test(c.name || '')) {
      return true;
    }
    return false;
  });
}

function findAwsProvider(
  components: DetectedComponent[],
  sectionId: string
): DetectedComponent | undefined {
  return components.find((c) => {
    if (c.type !== 'third_party') return false;
    if (sectionIdOf(c) !== sectionId) return false;
    const service = String(c.properties?.serviceName ?? '').toLowerCase();
    const name = (c.name || '').toLowerCase();
    return service === 'aws' || name === 'aws' || name.includes('amazon');
  });
}

function nextSyntheticComponentId(components: DetectedComponent[]): string {
  let maxNumericId = 0;
  for (const component of components) {
    const match = /^cmp_(\d+)$/.exec(component.id);
    if (match) {
      const num = Number.parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxNumericId) maxNumericId = num;
    }
  }
  return `cmp_${maxNumericId + 1}`;
}

function dedupeSourceLocations(
  locations: DetectedComponent['sourceLocations']
): DetectedComponent['sourceLocations'] {
  const seen = new Set<string>();
  const out: DetectedComponent['sourceLocations'] = [];
  for (const loc of locations ?? []) {
    const key = `${loc.filePath}:${loc.startLine}:${loc.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(loc);
  }
  return out;
}

function ensureManagedLambda(
  components: DetectedComponent[],
  sectionId: string,
  sample: DetectedComponent
): DetectedComponent {
  const existing = findManagedLambda(components, sectionId);
  if (existing) return existing;

  const provider = findAwsProvider(components, sectionId);
  const label =
    String(sample.properties?.section_label ?? '').trim() || sectionId;
  const role =
    String(sample.properties?.section_role ?? '').trim() || 'service';
  const created: DetectedComponent = {
    id: nextSyntheticComponentId(components),
    name: 'Aws Lambda',
    type: 'asset',
    subType: 'compute_service',
    confidence: Math.max(0.78, sample.confidence),
    detectedFrom: [],
    sourceLocations: [],
    properties: {
      section_id: sectionId,
      section_label: label,
      section_role: role,
      managed_service_key: 'lambda',
      ...(provider ? { managed_by_provider: provider.id } : {}),
      generated_by: 'handler_absorb_into_lambda',
    },
  };
  components.push(created);
  return created;
}

function mergeHandlerEvidenceIntoLambda(
  lambdaNode: DetectedComponent,
  handlers: DetectedComponent[]
): void {
  const locations = dedupeSourceLocations([
    ...(lambdaNode.sourceLocations ?? []),
    ...handlers.flatMap((h) => h.sourceLocations ?? []),
  ]);
  const detectedFrom = [
    ...(lambdaNode.detectedFrom ?? []),
    ...handlers.flatMap((h) => h.detectedFrom ?? []),
  ];
  const seenPatterns = new Set<string>();
  const dedupedFrom = detectedFrom.filter((ref) => {
    const key = `${ref.pattern}:${ref.sourceLocation?.filePath ?? ''}:${ref.sourceLocation?.startLine ?? ''}`;
    if (seenPatterns.has(key)) return false;
    seenPatterns.add(key);
    return true;
  });

  lambdaNode.sourceLocations = locations;
  lambdaNode.detectedFrom = dedupedFrom;
  lambdaNode.properties = {
    ...lambdaNode.properties,
    hosting_entrypoints: handlers.map((h) => h.name).filter(Boolean),
    absorbed_handler_ids: handlers.map((h) => h.id),
  };
}

function rewireFlowsAwayFromHandlers(
  flows: DetectedDataFlow[],
  handlerIds: Set<string>,
  lambdaId: string
): DetectedDataFlow[] {
  const remapped = flows.map((flow) => {
    let source = flow.sourceComponentId;
    let target = flow.targetComponentId;
    if (handlerIds.has(source)) source = lambdaId;
    if (handlerIds.has(target)) target = lambdaId;
    if (
      source === flow.sourceComponentId &&
      target === flow.targetComponentId
    ) {
      return flow;
    }
    return {
      ...flow,
      sourceComponentId: source,
      targetComponentId: target,
      enrichmentNotes: flow.enrichmentNotes
        ? `${flow.enrichmentNotes},handler_absorbed_into_lambda`
        : 'handler_absorbed_into_lambda',
    };
  });

  const seen = new Set<string>();
  const out: DetectedDataFlow[] = [];
  for (const flow of remapped) {
    if (flow.sourceComponentId === flow.targetComponentId) continue;
    const key = `${flowPairKey(flow)}::${flow.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(flow);
  }
  return out;
}

/**
 * Absorb serverless handler assets into the section's Aws Lambda managed
 * service (creating Lambda if needed). Evidence stays on Lambda; handlers
 * are removed from the graph. Ensures section hub → Aws Lambda connectivity.
 */
export function collapseServerlessHandlersIntoManagedLambda(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
  policy: FallbackPolicy = loadProviderTopologyFallbackPolicy()
): { components: DetectedComponent[]; dataFlows: DetectedDataFlow[] } {
  const nextComponents = components.map((c) => ({
    ...c,
    properties: { ...c.properties },
    detectedFrom: [...(c.detectedFrom ?? [])],
    sourceLocations: [...(c.sourceLocations ?? [])],
  }));
  let nextFlows = flows.map((f) => ({ ...f }));

  const handlers = nextComponents
    .filter((c) => {
      if (!isAbsorbableServerlessHandler(c)) return false;
      return isConcreteServiceSectionId(sectionIdOf(c), policy);
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  if (handlers.length === 0) {
    return { components: nextComponents, dataFlows: nextFlows };
  }

  const bySection = new Map<string, DetectedComponent[]>();
  for (const handler of handlers) {
    const sid = sectionIdOf(handler);
    const list = bySection.get(sid) ?? [];
    list.push(handler);
    bySection.set(sid, list);
  }

  const absorbedIds = new Set<string>();

  for (const sectionId of [...bySection.keys()].sort((a, b) =>
    a.localeCompare(b)
  )) {
    const sectionHandlers = bySection.get(sectionId)!;
    const lambdaNode = ensureManagedLambda(
      nextComponents,
      sectionId,
      sectionHandlers[0]!
    );
    mergeHandlerEvidenceIntoLambda(lambdaNode, sectionHandlers);

    for (const h of sectionHandlers) {
      absorbedIds.add(h.id);
    }

    nextFlows = rewireFlowsAwayFromHandlers(
      nextFlows,
      new Set(sectionHandlers.map((h) => h.id)),
      lambdaNode.id
    );

    const hub = findSectionHub(nextComponents, sectionId);
    if (hub && hub.id !== lambdaNode.id) {
      const pairKeys = new Set(nextFlows.map((f) => flowPairKey(f)));
      const key = flowPairKey({
        sourceComponentId: hub.id,
        targetComponentId: lambdaNode.id,
      });
      if (!pairKeys.has(key)) {
        nextFlows.push({
          id: `flow_fallback_${nextFlows.length + 1}`,
          sourceComponentId: hub.id,
          targetComponentId: lambdaNode.id,
          type: 'api_call',
          confidence: 0.6,
          description: 'Section hub hosts on Aws Lambda',
          enrichmentNotes: 'section_hub_to_managed_lambda',
        });
      }
    }

    const providerId = lambdaNode.properties?.managed_by_provider;
    if (typeof providerId === 'string' && providerId.trim()) {
      const pairKeys = new Set(nextFlows.map((f) => flowPairKey(f)));
      const key = flowPairKey({
        sourceComponentId: providerId,
        targetComponentId: lambdaNode.id,
      });
      if (!pairKeys.has(key)) {
        nextFlows.push({
          id: `flow_fallback_${nextFlows.length + 1}`,
          sourceComponentId: providerId,
          targetComponentId: lambdaNode.id,
          type: 'api_call',
          confidence: 0.78,
          description: 'Aws provides Aws Lambda',
          enrichmentNotes: 'provider_to_managed_lambda',
        });
      }
    }
  }

  const kept = nextComponents.filter((c) => !absorbedIds.has(c.id));
  return { components: kept, dataFlows: nextFlows };
}

/**
 * @deprecated Use {@link collapseServerlessHandlersIntoManagedLambda}.
 * Kept as a thin alias so older imports keep compiling during the transition.
 */
export function repairDisconnectedHandlers(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
  policy: FallbackPolicy = loadProviderTopologyFallbackPolicy()
): { components: DetectedComponent[]; dataFlows: DetectedDataFlow[] } {
  return collapseServerlessHandlersIntoManagedLambda(components, flows, policy);
}

/**
 * Collect connectivity RED flags that remain after repair passes.
 */
export function collectRedFlags(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
  policy: FallbackPolicy = loadProviderTopologyFallbackPolicy()
): ScanRedFlag[] {
  const flags: ScanRedFlag[] = [];
  const degree = incidentComponentIds(flows);

  const occupied = new Set<string>();
  for (const c of components) {
    const sid = sectionIdOf(c);
    if (isConcreteServiceSectionId(sid, policy)) occupied.add(sid);
  }

  for (const sectionId of [...occupied].sort((a, b) => a.localeCompare(b))) {
    if (!findSectionHub(components, sectionId)) {
      flags.push({
        code: 'missing_section_hub',
        severity: 'red',
        sectionId,
        message: `Section "${sectionId}" has components but no main-application hub.`,
      });
    }
  }

  const sectionComponents = components
    .filter((c) => isConcreteServiceSectionId(sectionIdOf(c), policy))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const component of sectionComponents) {
    if (degree.has(component.id)) continue;
    if (isMainApplication(component)) continue;

    const sectionId = sectionIdOf(component);
    if (isHandlerAsset(component)) {
      flags.push({
        code: 'disconnected_handler',
        severity: 'red',
        sectionId,
        componentId: component.id,
        message: `Handler "${component.name}" (${component.id}) in section "${sectionId}" has no connected flows.`,
      });
      continue;
    }

    flags.push({
      code: 'disconnected_section_node',
      severity: 'red',
      sectionId,
      componentId: component.id,
      message: `Component "${component.name}" (${component.id}) in section "${sectionId}" has no connected flows.`,
    });
  }

  return flags;
}

export function formatRedFlagWarning(flag: ScanRedFlag): string {
  const parts = [`red-flag: ${flag.code}`];
  if (flag.sectionId) parts.push(`section=${flag.sectionId}`);
  if (flag.componentId) parts.push(`component=${flag.componentId}`);
  parts.push(flag.message);
  return parts.join(': ');
}

/**
 * Absorb serverless handlers into Aws Lambda, then verify remaining gaps.
 */
export function applyConnectivityRedFlagPass(
  components: DetectedComponent[],
  flows: DetectedDataFlow[]
): {
  components: DetectedComponent[];
  dataFlows: DetectedDataFlow[];
  redFlags: ScanRedFlag[];
} {
  const policy = loadProviderTopologyFallbackPolicy();
  const collapsed = collapseServerlessHandlersIntoManagedLambda(
    components,
    flows,
    policy
  );
  const redFlags = collectRedFlags(
    collapsed.components,
    collapsed.dataFlows,
    policy
  );
  return {
    components: collapsed.components,
    dataFlows: collapsed.dataFlows,
    redFlags,
  };
}
