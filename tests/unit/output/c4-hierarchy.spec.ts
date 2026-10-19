import { buildDataflowHierarchy } from '../../../src/output/c4-hierarchy';
import { buildDataflowWrapper } from '../../../src/output/json';
import fixture from '../../fixtures/c4-hierarchy-dogfood.json';

const dogfoodGraph = { nodes: fixture.nodes as never[] };

function comp(
  id: string,
  file: string | null,
  extra: Record<string, unknown> = {}
) {
  return {
    id: `dp::${id}`,
    label: id,
    dp_kind: 'component',
    component_type: 'asset',
    sub_type: 'service',
    source_file: file,
    ...extra,
  };
}

describe('buildDataflowHierarchy', () => {
  it('groups asset components by source package and keeps node ids', () => {
    const h = buildDataflowHierarchy(
      {
        nodes: [
          comp('cmp_2', 'backend/src/a.ts'),
          comp('cmp_1', 'backend/src/b.ts'),
          comp('cmp_3', 'frontend/app/c.tsx'),
          comp('cmp_4', null, { sub_type: 'database' }),
          comp('cmp_5', 'x/y.ts', { component_type: 'third_party' }),
          { id: 'dp::flow_1', dp_kind: 'data_flow', label: 'f' },
        ],
      },
      ['cmp_1', 'cmp_2', 'cmp_3', 'cmp_4', 'cmp_5']
    )!;
    expect(
      h.containers.map((c) => [c.id, c.components.map((x) => x.id)])
    ).toEqual([
      ['ctn_backend', ['cmp_1', 'cmp_2']],
      ['ctn_kind_database', ['cmp_4']],
      ['ctn_frontend', ['cmp_3']],
    ]);
    expect(h.provisional).toBe(false);
  });

  it('drops components that are not nodes of the diagram graph', () => {
    const h = buildDataflowHierarchy(
      { nodes: [comp('cmp_1', 'a/x.ts'), comp('cmp_2', 'a/y.ts')] },
      ['cmp_1']
    )!;
    expect(h.stats).toEqual({
      containers: 1,
      components: 1,
      skippedNotInGraph: 1,
    });
  });

  it('descends past a single shared root segment', () => {
    const h = buildDataflowHierarchy(
      {
        nodes: [
          comp('cmp_1', 'src/auth/a.ts'),
          comp('cmp_2', 'src/billing/b.ts'),
        ],
      },
      ['cmp_1', 'cmp_2']
    )!;
    expect(h.containers.map((c) => c.label)).toEqual(['auth', 'billing']);
  });

  it('does not make a container out of a file at the scan root', () => {
    const h = buildDataflowHierarchy(
      { nodes: [comp('cmp_1', 'package.json', { sub_type: 'database' })] },
      ['cmp_1']
    )!;
    expect(h.containers.map((c) => c.id)).toEqual(['ctn_kind_database']);
  });

  it('returns undefined without asset components', () => {
    expect(buildDataflowHierarchy({ nodes: [] }, [])).toBeUndefined();
    expect(
      buildDataflowHierarchy({ nodes: [comp('cmp_1', 'a/b.ts')] }, [])
    ).toBeUndefined();
  });

  describe('on the dogfood graph', () => {
    const h = buildDataflowHierarchy(dogfoodGraph, fixture.graphNodeIds)!;

    it('has sensible containers', () => {
      const labels = h.containers.map((c) => c.label);
      expect(labels).toEqual(expect.arrayContaining(['backend', 'frontend']));
      const total = h.containers.reduce((n, c) => n + c.components.length, 0);
      expect(total).toBe(45);
      expect(h.stats.skippedNotInGraph).toBe(0);
    });

    it('only references node ids of the graph, each component once', () => {
      const ids = new Set(fixture.graphNodeIds);
      const seen = new Set<string>();
      for (const c of h.containers) {
        for (const comp of c.components) {
          expect(ids.has(comp.id)).toBe(true);
          expect(seen.has(comp.id)).toBe(false);
          seen.add(comp.id);
        }
      }
    });

    it('is deterministic regardless of input order', () => {
      const shuffled = {
        nodes: [...dogfoodGraph.nodes].reverse(),
      };
      expect(
        JSON.stringify(
          buildDataflowHierarchy(shuffled, [...fixture.graphNodeIds].reverse())
        )
      ).toBe(JSON.stringify(h));
    });
  });
});

describe('buildDataflowWrapper hierarchy', () => {
  const scanResult = {
    components: [],
    dataFlows: [],
    filesScanned: 1,
    scanDurationMs: 1,
  } as never;
  const graph = {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  } as never;

  it('writes metadata.hierarchy when given', () => {
    const hierarchy = buildDataflowHierarchy(
      { nodes: [comp('cmp_1', 'a/x.ts')] },
      ['cmp_1']
    )!;
    const w = buildDataflowWrapper(scanResult, graph, { hierarchy });
    expect((w.metadata as Record<string, unknown>).hierarchy).toEqual(
      hierarchy
    );
  });

  it('omits it otherwise', () => {
    const w = buildDataflowWrapper(scanResult, graph);
    expect(w.metadata).not.toHaveProperty('hierarchy');
  });
});
