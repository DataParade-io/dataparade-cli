/**
 * C4 container/component hierarchy for `dataflow.json` (`metadata.hierarchy`).
 *
 * The app's diagram canvas groups components into L2 containers from this
 * value (frontend `CliHierarchy`); without it the frontend falls back to a
 * heuristic. Ported from the dataparade-cli `feat/a0-likec4-emitter` WIP
 * (`hierarchy-from-dataparade-graph.ts`), minus the LikeC4 rendering:
 *
 * - L3 = `dp_kind: component` nodes of the knowledge graph with
 *   `component_type: asset` (in-boundary components).
 * - L2 = the package/repo path segment of the component's `source_file`; the
 *   component's sub type when it has no path.
 * - Component ids are the diagram graph node ids (the `dp::` prefix of the
 *   knowledge graph id removed, nothing else rewritten) because the frontend
 *   joins on them. Components with no node in the diagram graph are dropped.
 *
 * Pure: no I/O, same input gives the same output.
 */

export type HierarchySlotStatus = 'known' | 'partial' | 'unknown';

/** The parts of a `dataparade-graph.json` node this module reads. */
export interface HierarchyGraphNode {
  id: string;
  label?: string;
  dp_kind?: string;
  source_file?: string | null;
  component_type?: string;
  sub_type?: string;
  confidence_score?: number;
  [attribute: string]: unknown;
}

export interface HierarchyKnowledgeGraph {
  nodes: HierarchyGraphNode[];
}

export interface DataflowHierarchyComponent {
  id: string;
  label: string;
  description: string;
  slotStatus: HierarchySlotStatus;
}

export interface DataflowHierarchyContainer {
  id: string;
  label: string;
  description: string;
  slotStatus: HierarchySlotStatus;
  components: DataflowHierarchyComponent[];
}

export interface DataflowHierarchy {
  heuristic: string;
  provisional: false;
  source: 'dataparade-graph';
  stats: { containers: number; components: number; skippedNotInGraph: number };
  containers: DataflowHierarchyContainer[];
}

const DP_PREFIX = 'dp::';

const HEURISTIC =
  'L2 containers = first path segment of in-boundary asset component source files ' +
  '(sub type when no path); L3 = asset components nested under them. ' +
  'Component ids equal diagram graph node ids.';

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function stripDpPrefix(id: string): string {
  return id.startsWith(DP_PREFIX) ? id.slice(DP_PREFIX.length) : id;
}

/** Same id shape as the LikeC4 emitter used, so container ids stay stable. */
function toContainerKey(raw: string): string {
  let id = raw.replace(/[^A-Za-z0-9_-]/g, '_');
  if (!id) id = 'element';
  if (/^[0-9]/.test(id)) id = `n_${id}`;
  return id;
}

/** Directory segments of a source file path, noise roots removed. */
function pathParts(filePath: string | null | undefined): string[] {
  if (!filePath || typeof filePath !== 'string') return [];
  const parts = filePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .split('/')
    .filter(Boolean);
  // Directories only: a file at the scan root (package.json) names no container.
  parts.pop();
  // Skip noise-like roots.
  while (
    parts.length > 0 &&
    (parts[0].startsWith('.') ||
      parts[0] === 'node_modules' ||
      parts[0] === 'dist')
  ) {
    parts.shift();
  }
  return parts;
}

function slotStatus(score: number | undefined): HierarchySlotStatus {
  if (typeof score === 'number') return score >= 0.8 ? 'known' : 'partial';
  return 'known';
}

/**
 * Build the hierarchy. Returns `undefined` when the graph has no usable asset
 * components (callers then omit `metadata.hierarchy`).
 *
 * @param graphNodeIds ids of the nodes in the `dataflow.json` diagram graph.
 */
export function buildDataflowHierarchy(
  knowledgeGraph: HierarchyKnowledgeGraph,
  graphNodeIds: Iterable<string>
): DataflowHierarchy | undefined {
  const nodeIds = new Set(graphNodeIds);
  let skippedNotInGraph = 0;

  const assets: Array<{
    node: HierarchyGraphNode;
    id: string;
    parts: string[];
  }> = [];
  for (const node of knowledgeGraph.nodes ?? []) {
    if (node.dp_kind !== 'component') continue;
    if (String(node.component_type ?? 'asset') !== 'asset') continue;
    const id = stripDpPrefix(String(node.id));
    if (!nodeIds.has(id)) {
      skippedNotInGraph += 1;
      continue;
    }
    assets.push({ node, id, parts: pathParts(node.source_file) });
  }
  if (assets.length === 0) return undefined;
  assets.sort((a, b) => compare(a.id, b.id));

  // A scan rooted inside one folder has a single shared first segment; descend
  // past it (at most twice) so containers still discriminate.
  let depth = 0;
  for (let i = 0; i < 2; i += 1) {
    const withPath = assets.filter((a) => a.parts.length > depth + 1);
    if (withPath.length === 0) break;
    const first = new Set(withPath.map((a) => a.parts[depth]));
    const allHavePath = withPath.length === assets.length;
    if (first.size === 1 && allHavePath) depth += 1;
    else break;
  }

  const byKey = new Map<string, DataflowHierarchyContainer>();
  for (const { node, id, parts } of assets) {
    const segment =
      parts.length > 0 ? parts[Math.min(depth, parts.length - 1)] : undefined;
    const kind = String(node.sub_type || node.component_type || 'unknown');
    const key = segment
      ? `ctn_${toContainerKey(segment)}`
      : `ctn_kind_${toContainerKey(kind)}`;
    let container = byKey.get(key);
    if (!container) {
      container = {
        id: key,
        label: segment ?? kind,
        description: segment
          ? 'Container grouped by component source package'
          : 'Container grouped by component kind (no source path)',
        slotStatus: segment ? 'known' : 'unknown',
        components: [],
      };
      byKey.set(key, container);
    }
    const ctype = String(node.component_type ?? 'asset');
    container.components.push({
      id,
      label: node.label || id,
      description: node.sub_type ? `${ctype}/${node.sub_type}` : ctype,
      slotStatus: slotStatus(node.confidence_score),
    });
  }

  const containers = [...byKey.values()].sort(
    (a, b) => compare(a.label, b.label) || compare(a.id, b.id)
  );
  return {
    heuristic: HEURISTIC,
    provisional: false,
    source: 'dataparade-graph',
    stats: {
      containers: containers.length,
      components: assets.length,
      skippedNotInGraph,
    },
    containers,
  };
}
