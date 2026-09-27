import {
  applyConnectivityRedFlagPass,
  collectRedFlags,
  collapseServerlessHandlersIntoManagedLambda,
  formatRedFlagWarning,
} from '../../../src/ai-enrichment/red-flags';
import { applyDeterministicInferenceFallbacks } from '../../../src/ai-enrichment/fallbacks';
import { clearProviderTopologyRulesCacheForTest } from '../../../src/ai-enrichment/provider-topology-rules';
import { buildDataflowWrapper } from '../../../src/output/json';
import type { DetectedComponent } from '../../../src/core/types/component';
import type { DetectedDataFlow } from '../../../src/core/types/data-flow';
import type { DiagramGraphJsonSchema } from '../../../src/core/schema';
import type { ScanResult } from '../../../src/core/types';

describe('connectivity red flags', () => {
  beforeEach(() => {
    clearProviderTopologyRulesCacheForTest();
  });

  it('absorbs a serverless handler into Aws Lambda and wires the section hub', () => {
    const components: DetectedComponent[] = [
      {
        id: 'hub_backend',
        name: 'backend',
        type: 'asset',
        subType: 'application',
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: 'backend',
          section_label: 'backend',
          isMainApplication: true,
        },
      },
      {
        id: 'cmp_lambda',
        name: 'Aws Lambda',
        type: 'asset',
        subType: 'compute_service',
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: 'backend',
          section_label: 'backend',
          managed_service_key: 'lambda',
        },
      },
      {
        id: 'handler_lambda',
        name: 'Aws Lambda Handler',
        type: 'asset',
        subType: 'function',
        confidence: 0.9,
        detectedFrom: [{ pattern: 'lambda_handler' }],
        sourceLocations: [
          {
            filePath: 'backend/src/lambda.ts',
            startLine: 72,
            endLine: 72,
          },
        ],
        properties: {
          section_id: 'backend',
          section_label: 'backend',
          handlerType: 'serverless_handler',
        },
      },
    ];

    const collapsed = collapseServerlessHandlersIntoManagedLambda(
      components,
      []
    );

    expect(collapsed.components.some((c) => c.id === 'handler_lambda')).toBe(
      false
    );
    const lambda = collapsed.components.find((c) => c.id === 'cmp_lambda');
    expect(lambda).toBeDefined();
    expect(lambda?.sourceLocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'backend/src/lambda.ts',
          startLine: 72,
        }),
      ])
    );
    expect(
      collapsed.dataFlows.some(
        (f) =>
          f.sourceComponentId === 'hub_backend' &&
          f.targetComponentId === 'cmp_lambda' &&
          f.enrichmentNotes === 'section_hub_to_managed_lambda'
      )
    ).toBe(true);

    const flags = collectRedFlags(collapsed.components, collapsed.dataFlows);
    expect(
      flags.find((f) => f.code === 'disconnected_handler')
    ).toBeUndefined();
  });

  it('creates Aws Lambda when absorbing a handler with no managed node yet', () => {
    const components: DetectedComponent[] = [
      {
        id: 'hub_backend',
        name: 'backend',
        type: 'asset',
        subType: 'application',
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: 'backend',
          isMainApplication: true,
        },
      },
      {
        id: 'handler_only',
        name: 'orphan handler',
        type: 'asset',
        subType: 'function',
        confidence: 0.9,
        detectedFrom: [{ pattern: 'lambda_handler' }],
        sourceLocations: [
          { filePath: 'backend/handler.ts', startLine: 7, endLine: 7 },
        ],
        properties: {
          section_id: 'backend',
          section_label: 'backend',
          handlerType: 'serverless_handler',
        },
      },
    ];

    const collapsed = collapseServerlessHandlersIntoManagedLambda(
      components,
      []
    );
    expect(collapsed.components.some((c) => c.id === 'handler_only')).toBe(
      false
    );
    const lambda = collapsed.components.find(
      (c) => c.properties?.managed_service_key === 'lambda'
    );
    expect(lambda).toBeDefined();
    expect(lambda?.name).toBe('Aws Lambda');
    expect(lambda?.sourceLocations?.[0]?.filePath).toBe('backend/handler.ts');
    expect(
      collapsed.dataFlows.some(
        (f) =>
          f.sourceComponentId === 'hub_backend' &&
          f.targetComponentId === lambda?.id
      )
    ).toBe(true);

    const flags = collectRedFlags(collapsed.components, collapsed.dataFlows);
    expect(flags.some((f) => f.code === 'disconnected_handler')).toBe(false);
    expect(
      formatRedFlagWarning({
        code: 'missing_section_hub',
        severity: 'red',
        sectionId: 'x',
        message: 'm',
      })
    ).toMatch(/^red-flag:/);
  });

  it('end-to-end fallbacks + red-flag pass absorb a lone backend handler', () => {
    const components: DetectedComponent[] = [
      {
        id: 'handler_lambda',
        name: 'Aws Lambda Handler',
        type: 'asset',
        subType: 'function',
        confidence: 0.9,
        detectedFrom: [{ pattern: 'lambda_handler' }],
        sourceLocations: [
          { filePath: 'backend/handler.ts', startLine: 1, endLine: 1 },
        ],
        properties: {
          section_id: 'backend',
          section_label: 'backend',
          section_role: 'service',
          handlerType: 'serverless_handler',
        },
      },
    ];

    const fallback = applyDeterministicInferenceFallbacks(components, []);
    const pass = applyConnectivityRedFlagPass(
      fallback.components,
      fallback.dataFlows
    );

    const hub = pass.components.find(
      (c) =>
        c.properties?.section_id === 'backend' &&
        (c.properties?.isMainApplication === true ||
          c.properties?.isMainApplication === 'true')
    );
    expect(hub).toBeDefined();
    expect(pass.components.some((c) => c.id === 'handler_lambda')).toBe(false);
    const lambda = pass.components.find(
      (c) => c.properties?.managed_service_key === 'lambda'
    );
    expect(lambda).toBeDefined();
    expect(
      pass.dataFlows.some(
        (f) =>
          f.sourceComponentId === hub?.id && f.targetComponentId === lambda?.id
      )
    ).toBe(true);
    expect(
      pass.redFlags.filter(
        (f) =>
          f.code === 'disconnected_handler' || f.code === 'missing_section_hub'
      )
    ).toHaveLength(0);
  });

  it('flags disconnected non-handler section nodes that remain after repair', () => {
    const components: DetectedComponent[] = [
      {
        id: 'hub',
        name: 'backend',
        type: 'asset',
        subType: 'application',
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: 'backend',
          isMainApplication: true,
        },
      },
      {
        id: 'lonely_db',
        name: 'Orphan Cache',
        type: 'asset',
        subType: 'cache',
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: 'backend' },
      },
    ];
    const flows: DetectedDataFlow[] = [];

    const flags = collectRedFlags(components, flows);
    expect(
      flags.some(
        (f) =>
          f.code === 'disconnected_section_node' &&
          f.componentId === 'lonely_db'
      )
    ).toBe(true);
  });

  it('embeds redFlags into dataflow metadata when present', () => {
    const scanResult = {
      components: [],
      dataFlows: [],
      filesScanned: 0,
      filesSkipped: 0,
      totalLines: 0,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    } as ScanResult;

    const graph = {
      nodes: [],
      edges: [],
    } as DiagramGraphJsonSchema;

    const wrapper = buildDataflowWrapper(scanResult, graph, {
      projectName: 'test',
      redFlags: [
        {
          code: 'disconnected_handler',
          severity: 'red',
          sectionId: 'backend',
          componentId: 'handler_1',
          message: 'Handler disconnected',
        },
      ],
    });

    expect((wrapper.metadata as Record<string, unknown>).redFlags).toEqual([
      {
        code: 'disconnected_handler',
        severity: 'red',
        sectionId: 'backend',
        componentId: 'handler_1',
        message: 'Handler disconnected',
      },
    ]);
  });
});
