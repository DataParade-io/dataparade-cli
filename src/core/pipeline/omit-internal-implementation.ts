/**
 * NestJS `services/*.service.ts` classes and bare HTTP clients (Axios, HttpClient)
 * are implementation details. Directus collection services (`extends ItemsService`)
 * and calls that name a real third party stay on the diagram.
 */

const HTTP_TRANSPORT_NAMES = new Set([
  'axios',
  'fetch',
  'got',
  'ky',
  'httpclient',
  'httpclientfactory',
  'restsharp',
  'flurl',
  'undici',
  'nodefetch',
  'crossfetch',
]);

export interface OmittableLocation {
  filePath: string;
  code?: string;
  startLine?: number;
}

export interface OmittableComponent {
  id: string;
  name: string;
  type: string;
  subType?: string;
  detectedFrom?: Array<{
    pattern: string;
    sourceLocation?: OmittableLocation;
  }>;
  sourceLocations?: OmittableLocation[];
  properties?: Record<string, unknown>;
}

export interface OmittableFlow {
  sourceComponentId: string;
  targetComponentId: string;
  type: string;
}

export interface OmitInternalImplementationOptions {
  readSource?: (filePath: string) => string | undefined;
}

function compactName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function isMainApplication(component: OmittableComponent): boolean {
  const flag = component.properties?.isMainApplication;
  return flag === true || flag === 'true';
}

function sectionId(component: OmittableComponent): string {
  const raw = component.properties?.section_id;
  return typeof raw === 'string' ? raw.trim() : '';
}

function serviceFileLocations(
  component: OmittableComponent
): OmittableLocation[] {
  return (component.sourceLocations ?? []).filter((location) =>
    /(?:^|\/)services\/.+\.tsx?$/i.test(location.filePath.replace(/\\/g, '/'))
  );
}

function declarationWindow(source: string, startLine: number | undefined): string {
  const lines = source.split(/\r?\n/);
  const start = Math.max(0, (startLine ?? 1) - 1);
  return lines.slice(start, start + 4).join('\n');
}

function isDirectusItemsService(
  component: OmittableComponent,
  readSource: (filePath: string) => string | undefined
): boolean {
  for (const location of serviceFileLocations(component)) {
    const fromSnippet = location.code ?? '';
    if (/extends\s+(?:\w+\.)?ItemsService\b/.test(fromSnippet)) return true;
    const source = readSource(location.filePath);
    if (!source) continue;
    if (
      /extends\s+(?:\w+\.)?ItemsService\b/.test(
        declarationWindow(source, location.startLine)
      )
    ) {
      return true;
    }
  }
  return false;
}

function isNestServiceClassNode(
  component: OmittableComponent,
  readSource: (filePath: string) => string | undefined
): boolean {
  if (component.type !== 'asset' || component.subType !== 'service') return false;
  const locations = serviceFileLocations(component);
  if (locations.length === 0) return false;
  const patterns = (component.detectedFrom ?? []).map((ref) => ref.pattern);
  if (patterns.length === 0 || patterns.some((pattern) => pattern !== 'auth_middleware')) {
    return false;
  }
  if (isDirectusItemsService(component, readSource)) return false;

  for (const location of locations) {
    const snippet = location.code ?? '';
    if (/export\s+class\s+\w+Service\b/.test(snippet)) return true;
    const source = readSource(location.filePath);
    if (!source) continue;
    if (
      /export\s+class\s+\w+Service\b/.test(
        declarationWindow(source, location.startLine)
      )
    ) {
      return true;
    }
  }
  return false;
}

function stringProp(
  component: OmittableComponent,
  key: string
): string {
  const value = component.properties?.[key];
  return typeof value === 'string' ? value : '';
}

function hasPublicUrl(component: OmittableComponent): boolean {
  const url = stringProp(component, 'url') || (
    /^https?:\/\//i.test(component.name) ? component.name : ''
  );
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\$\{|process\.env|localhost|127\.0\.0\.1/i.test(url)) return false;
  return true;
}

function isBareHttpTransportNode(component: OmittableComponent): boolean {
  if (component.properties?.sourceContext === 'dependency_manifest') return false;
  if (hasPublicUrl(component)) return false;

  const serviceName = compactName(stringProp(component, 'serviceName'));
  if (serviceName && !HTTP_TRANSPORT_NAMES.has(serviceName)) return false;

  const client = compactName(stringProp(component, 'client'));
  const fromName = compactName(component.name).replace(/call$/, '');
  const namedAsClientCall =
    /\bcall$/i.test(component.name.trim()) &&
    HTTP_TRANSPORT_NAMES.has(fromName);
  return (
    HTTP_TRANSPORT_NAMES.has(client) ||
    HTTP_TRANSPORT_NAMES.has(serviceName) ||
    namedAsClientCall
  );
}

function hubIdFor(
  components: OmittableComponent[],
  dropped: OmittableComponent,
  dropIds: Set<string>
): string | undefined {
  const hubs = components.filter(
    (component) => isMainApplication(component) && !dropIds.has(component.id)
  );
  const section = sectionId(dropped);
  const sameSection = hubs.find((hub) => sectionId(hub) === section);
  return (sameSection ?? hubs[0])?.id;
}

export function omitInternalImplementationNodes<
  C extends OmittableComponent,
  F extends OmittableFlow,
>(
  components: C[],
  flows: F[],
  options: OmitInternalImplementationOptions = {}
): { components: C[]; dataFlows: F[] } {
  const readSource = options.readSource ?? (() => undefined);
  const dropIds = new Set(
    components
      .filter(
        (component) =>
          isNestServiceClassNode(component, readSource) ||
          isBareHttpTransportNode(component)
      )
      .map((component) => component.id)
  );
  if (dropIds.size === 0) {
    return { components, dataFlows: flows };
  }

  const kept = components.filter((component) => !dropIds.has(component.id));
  const seen = new Set<string>();
  const dataFlows: F[] = [];

  for (const flow of flows) {
    if (dropIds.has(flow.targetComponentId)) continue;

    let sourceId = flow.sourceComponentId;
    if (dropIds.has(sourceId)) {
      const dropped = components.find((component) => component.id === sourceId);
      const hub = dropped ? hubIdFor(components, dropped, dropIds) : undefined;
      if (!hub || hub === flow.targetComponentId) continue;
      sourceId = hub;
    }

    const key = `${sourceId}\t${flow.targetComponentId}\t${flow.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dataFlows.push(
      sourceId === flow.sourceComponentId
        ? flow
        : { ...flow, sourceComponentId: sourceId }
    );
  }

  return { components: kept, dataFlows };
}
