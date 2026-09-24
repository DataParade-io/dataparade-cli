import { mergeAiProposals } from '../../../src/ai-enrichment/merge-rules';
import type { AiProposal } from '../../../src/ai-enrichment/types';
import type { DetectedComponent } from '../../../src/core/types/component';
import type { DetectedDataFlow } from '../../../src/core/types/data-flow';

function makeBaseComponents(): DetectedComponent[] {
  return [
    {
      id: 'asset_frontend',
      name: 'Frontend',
      type: 'asset',
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [],
      properties: {},
    },
    {
      id: 'asset_backend',
      name: 'Backend',
      type: 'asset',
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [],
      properties: {},
    },
  ];
}

function makeBaseFlows(): DetectedDataFlow[] {
  return [
    {
      id: 'flow_1',
      sourceComponentId: 'asset_frontend',
      targetComponentId: 'asset_backend',
      type: 'api_call',
      confidence: 0.8,
    },
  ];
}

describe('ai-enrichment merge rules', () => {
  it('remaps provider component target from path alias to canonical component id', () => {
    const components: DetectedComponent[] = [
      {
        id: 'cmp_11',
        name: 'auth-helper',
        type: 'asset',
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [
          {
            filePath: 'backend/lambdas/auth-helper/index.js',
            startLine: 1,
            endLine: 20,
          },
        ],
        properties: {},
      },
    ];
    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'provider_1',
        proposal: {
          kind: 'component_patch',
          targetComponentId: 'backend/lambdas/auth-helper',
          candidateType: 'node_property',
          setProperties: { programming_language: ['javascript'] },
          confidence: { score: 0.82, band: 'high' },
          evidence: [
            {
              filePath: 'backend/lambdas/auth-helper/index.js',
              startLine: 1,
              endLine: 10,
              reason: 'lambda source file',
            },
          ],
          provider: 'openai',
          model: 'gpt-4o-mini',
          agent: 'propertyAgent',
        },
      },
    ];

    const result = mergeAiProposals(components, [], proposals);
    expect(result.appliedProposalIds).toEqual(['provider_1']);
    expect(result.rejectedProposalIds).toEqual([]);
    expect(result.components[0]?.id).toBe('cmp_11');
    expect(result.components[0]?.properties.programming_language).toEqual([
      'javascript',
    ]);
  });

  it('applies only the highest-ranked proposal per target', () => {
    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'p_low',
        proposal: {
          kind: 'component_patch',
          targetComponentId: 'asset_backend',
          candidateType: 'node_property',
          setProperties: { pii: false },
          confidence: { score: 0.8, band: 'medium' },
          evidence: [
            {
              filePath: 'src/backend.ts',
              startLine: 10,
              endLine: 20,
              reason: 'no pii path',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'propertyAgent',
        },
      },
      {
        id: 'p_high',
        proposal: {
          kind: 'component_patch',
          targetComponentId: 'asset_backend',
          candidateType: 'node_property',
          setProperties: { pii: true },
          confidence: { score: 0.92, band: 'high' },
          evidence: [
            {
              filePath: 'src/backend.ts',
              startLine: 10,
              endLine: 20,
              reason: 'user email persisted',
            },
            {
              filePath: 'src/db.ts',
              startLine: 1,
              endLine: 4,
              reason: 'email column present',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'propertyAgent',
        },
      },
    ];

    const result = mergeAiProposals(
      makeBaseComponents(),
      makeBaseFlows(),
      proposals
    );

    const backend = result.components.find((c) => c.id === 'asset_backend');
    expect(backend?.properties.pii).toBe(true);
    expect(result.appliedProposalIds).toEqual(['p_high']);
    expect(result.rejectedProposalIds).toEqual([
      {
        proposalId: 'p_low',
        reason: 'target_already_modified_by_higher_ranked_proposal',
      },
    ]);
  });

  it('rejects flow inserts below insert threshold', () => {
    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'insert_low_confidence',
        proposal: {
          kind: 'flow_patch',
          candidateType: 'missing_interaction',
          insertIfMissing: true,
          sourceComponentId: 'asset_backend',
          targetComponentId: 'asset_frontend',
          setType: 'api_call',
          confidence: { score: 0.8, band: 'medium' },
          evidence: [
            {
              filePath: 'src/api.ts',
              startLine: 3,
              endLine: 5,
              reason: 'response mapper reference',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'interactionAgent',
        },
      },
    ];

    const result = mergeAiProposals(
      makeBaseComponents(),
      makeBaseFlows(),
      proposals
    );

    expect(result.appliedProposalIds).toEqual([]);
    expect(result.rejectedProposalIds).toEqual([
      {
        proposalId: 'insert_low_confidence',
        reason: 'confidence_below_threshold:0.85',
      },
    ]);
    expect(result.dataFlows).toHaveLength(1);
  });

  it('rejects flow_patch when preserving data-flow topology even above insert threshold', () => {
    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'insert_high_confidence',
        proposal: {
          kind: 'flow_patch',
          candidateType: 'missing_interaction',
          insertIfMissing: true,
          sourceComponentId: 'asset_backend',
          targetComponentId: 'asset_frontend',
          setType: 'api_call',
          confidence: { score: 0.95, band: 'high' },
          evidence: [
            {
              filePath: 'src/api.ts',
              startLine: 3,
              endLine: 5,
              reason: 'response mapper reference',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'interactionAgent',
        },
      },
    ];

    const result = mergeAiProposals(
      makeBaseComponents(),
      makeBaseFlows(),
      proposals,
      {},
      { preserveDataFlowTopology: true }
    );

    expect(result.appliedProposalIds).toEqual([]);
    expect(result.rejectedProposalIds).toEqual([
      {
        proposalId: 'insert_high_confidence',
        reason: 'data_flow_topology_preserved',
      },
    ]);
    expect(result.dataFlows).toHaveLength(1);
    expect(result.dataFlows[0]?.targetComponentId).toBe('asset_backend');
  });

  it('rejects flow_patch when intra-section gate is enabled and endpoints are in different sections', () => {
    const components: DetectedComponent[] = [
      {
        id: 'asset_frontend',
        name: 'Frontend',
        type: 'asset',
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: 'frontend' },
      },
      {
        id: 'asset_backend',
        name: 'Backend',
        type: 'asset',
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: 'backend' },
      },
    ];
    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'insert_cross_section',
        proposal: {
          kind: 'flow_patch',
          candidateType: 'missing_interaction',
          insertIfMissing: true,
          sourceComponentId: 'asset_frontend',
          targetComponentId: 'asset_backend',
          setType: 'api_call',
          confidence: { score: 0.95, band: 'high' },
          evidence: [
            {
              filePath: 'src/api.ts',
              startLine: 3,
              endLine: 5,
              reason: 'request path observed',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'interactionAgent',
        },
      },
    ];

    const result = mergeAiProposals(
      components,
      [],
      proposals,
      {},
      {
        enforceIntraSectionFlowChangesOnly: true,
      }
    );

    expect(result.appliedProposalIds).toEqual([]);
    expect(result.rejectedProposalIds).toEqual([
      {
        proposalId: 'insert_cross_section',
        reason: 'cross_section_flow_change_blocked',
      },
    ]);
  });

  it('applies flow_patch when intra-section gate is enabled and endpoints share a section', () => {
    const components: DetectedComponent[] = [
      {
        id: 'asset_frontend_api',
        name: 'Frontend API',
        type: 'asset',
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: 'frontend' },
      },
      {
        id: 'asset_frontend_worker',
        name: 'Frontend Worker',
        type: 'asset',
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: 'frontend' },
      },
    ];
    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'insert_same_section',
        proposal: {
          kind: 'flow_patch',
          candidateType: 'missing_interaction',
          insertIfMissing: true,
          sourceComponentId: 'asset_frontend_api',
          targetComponentId: 'asset_frontend_worker',
          setType: 'api_call',
          confidence: { score: 0.95, band: 'high' },
          evidence: [
            {
              filePath: 'src/frontend.ts',
              startLine: 12,
              endLine: 20,
              reason: 'internal call observed',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'interactionAgent',
        },
      },
    ];

    const result = mergeAiProposals(
      components,
      [],
      proposals,
      {},
      {
        enforceIntraSectionFlowChangesOnly: true,
      }
    );

    expect(result.appliedProposalIds).toEqual(['insert_same_section']);
    expect(result.rejectedProposalIds).toEqual([]);
    expect(result.dataFlows).toHaveLength(1);
    expect(result.dataFlows[0]?.sourceComponentId).toBe('asset_frontend_api');
    expect(result.dataFlows[0]?.targetComponentId).toBe(
      'asset_frontend_worker'
    );
  });

  it('rejects component patch when all updates are no-op or empty-equivalent', () => {
    const components = makeBaseComponents();
    components[1]!.properties = {
      inference_status: undefined,
      api_versioning_strategy: null,
      access_controls_for_delivery: null,
      cloud_services_used: [],
    };

    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'p_noop',
        proposal: {
          kind: 'component_patch',
          targetComponentId: 'asset_backend',
          candidateType: 'node_property',
          setProperties: {
            inference_status: 'needs_review',
            api_versioning_strategy: 'none',
            access_controls_for_delivery: null,
            cloud_services_used: null,
          },
          confidence: { score: 0.9, band: 'high' },
          evidence: [
            {
              filePath: 'src/backend.ts',
              startLine: 1,
              endLine: 2,
              reason: 'existing metadata only',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'propertyAgent',
        },
      },
    ];

    const result = mergeAiProposals(components, makeBaseFlows(), proposals);
    const backend = result.components.find((c) => c.id === 'asset_backend');

    expect(result.appliedProposalIds).toEqual([]);
    expect(result.rejectedProposalIds).toEqual([
      { proposalId: 'p_noop', reason: 'no_meaningful_changes' },
    ]);
    expect(backend?.properties).toEqual({
      inference_status: undefined,
      api_versioning_strategy: null,
      access_controls_for_delivery: null,
      cloud_services_used: [],
    });
  });

  it('applies component patch when at least one property meaningfully changes', () => {
    const components = makeBaseComponents();
    components[1]!.properties = {
      cloud_services_used: [],
      inference_status: undefined,
    };

    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'p_meaningful',
        proposal: {
          kind: 'component_patch',
          targetComponentId: 'asset_backend',
          candidateType: 'node_property',
          setProperties: {
            inference_status: 'needs_review',
            cloud_services_used: ['aws'],
          },
          confidence: { score: 0.9, band: 'high' },
          evidence: [
            {
              filePath: 'src/backend.ts',
              startLine: 1,
              endLine: 2,
              reason: 'cloud provider usage',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'propertyAgent',
        },
      },
    ];

    const result = mergeAiProposals(components, makeBaseFlows(), proposals);
    const backend = result.components.find((c) => c.id === 'asset_backend');

    expect(result.appliedProposalIds).toEqual(['p_meaningful']);
    expect(result.rejectedProposalIds).toEqual([]);
    expect(backend?.properties.inference_status).toBeUndefined();
    expect(backend?.properties.cloud_services_used).toEqual(['aws']);
  });

  it('merges AI data_action verbs into dataActions without removing deterministic assignments', () => {
    const components = makeBaseComponents();
    components[1]!.properties = {
      dataActions: [
        {
          action: 'store',
          source: 'deterministic',
          confidence: 1,
          status: 'asserted',
          evidence: {
            kind: 'storage_subtype',
            description: 'database subtype',
          },
        },
        {
          action: 'disclose',
          source: 'user',
          confidence: 1,
          status: 'asserted',
          evidence: [
            {
              filePath: 'src/backend.ts',
              startLine: 1,
              endLine: 2,
              reason: 'user confirmed outbound share',
            },
          ],
        },
      ],
      primaryDataAction: 'store',
    };

    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'p_data_actions',
        proposal: {
          kind: 'component_patch',
          targetComponentId: 'asset_backend',
          candidateType: 'node_property',
          setProperties: {
            data_action: ['log', 'store'],
          },
          propertyEvidence: {
            data_action: [
              {
                filePath: 'src/backend.ts',
                startLine: 40,
                endLine: 42,
                reason: 'logger.info email',
              },
            ],
          },
          confidence: { score: 0.88, band: 'high' },
          evidence: [
            {
              filePath: 'src/backend.ts',
              startLine: 40,
              endLine: 42,
              reason: 'logger.info email',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'propertyAgent',
        },
      },
    ];

    const result = mergeAiProposals(components, makeBaseFlows(), proposals);
    const backend = result.components.find((c) => c.id === 'asset_backend');
    const actions = backend?.properties.dataActions as Array<{
      action: string;
      source: string;
    }>;

    expect(result.appliedProposalIds).toEqual(['p_data_actions']);
    expect(actions?.map((a) => a.action).sort()).toEqual([
      'disclose',
      'log',
      'store',
    ]);
    expect(actions?.find((a) => a.action === 'store')?.source).toBe(
      'deterministic'
    );
    expect(actions?.find((a) => a.action === 'disclose')?.source).toBe('user');
    expect(actions?.find((a) => a.action === 'log')?.source).toBe('ai');
    expect(backend?.properties.data_action).toBeUndefined();
    expect(backend?.properties.primaryDataAction).toBeDefined();
  });

  it('rejects data_action merge below 0.72 confidence and leaves deterministic verbs intact', () => {
    const components = makeBaseComponents();
    components[1]!.properties = {
      dataActions: [
        {
          action: 'store',
          source: 'deterministic',
          confidence: 1,
          status: 'asserted',
          evidence: {
            kind: 'storage_subtype',
            description: 'database subtype',
          },
        },
      ],
    };

    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'p_low_da',
        proposal: {
          kind: 'component_patch',
          targetComponentId: 'asset_backend',
          candidateType: 'node_property',
          setProperties: {
            data_action: ['log'],
          },
          confidence: { score: 0.71, band: 'medium' },
          evidence: [
            {
              filePath: 'src/backend.ts',
              startLine: 1,
              endLine: 1,
              reason: 'weak log guess',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'propertyAgent',
        },
      },
    ];

    const result = mergeAiProposals(components, makeBaseFlows(), proposals);
    const backend = result.components.find((c) => c.id === 'asset_backend');

    expect(result.appliedProposalIds).toEqual([]);
    expect(result.rejectedProposalIds).toEqual([
      {
        proposalId: 'p_low_da',
        reason: 'confidence_below_threshold:0.72',
      },
    ]);
    expect(backend?.properties.dataActions).toEqual([
      {
        action: 'store',
        source: 'deterministic',
        confidence: 1,
        status: 'asserted',
        evidence: {
          kind: 'storage_subtype',
          description: 'database subtype',
        },
      },
    ]);
  });

  it('does not write dataActions onto actor nodes', () => {
    const components: DetectedComponent[] = [
      {
        id: 'actor_user',
        name: 'End User',
        type: 'actor',
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: {},
      },
    ];
    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'p_actor_da',
        proposal: {
          kind: 'component_patch',
          targetComponentId: 'actor_user',
          candidateType: 'node_property',
          setProperties: {
            data_action: ['collect'],
          },
          confidence: { score: 0.9, band: 'high' },
          evidence: [
            {
              filePath: 'src/ui.ts',
              startLine: 1,
              endLine: 2,
              reason: 'form submit',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'propertyAgent',
        },
      },
    ];

    const result = mergeAiProposals(components, [], proposals);
    expect(result.appliedProposalIds).toEqual([]);
    expect(result.rejectedProposalIds).toEqual([
      { proposalId: 'p_actor_da', reason: 'no_meaningful_changes' },
    ]);
    expect(result.components[0]?.properties.dataActions).toBeUndefined();
  });

  it('promotes a deterministic relay candidate when AI supplies corroboration', () => {
    const components = makeBaseComponents();
    components[0]!.properties = {
      dataActions: [
        {
          action: 'relay',
          source: 'deterministic',
          confidence: 0.6,
          status: 'candidate',
          evidence: {
            kind: 'relay_topology',
            description: 'in-degree and out-degree without store',
          },
        },
      ],
    };

    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'p_relay',
        proposal: {
          kind: 'component_patch',
          targetComponentId: 'asset_frontend',
          candidateType: 'node_property',
          setProperties: {
            data_action: ['relay'],
          },
          propertyEvidence: {
            data_action: [
              {
                filePath: 'src/proxy.ts',
                startLine: 8,
                endLine: 12,
                reason: 'express proxy middleware passthrough',
              },
            ],
          },
          confidence: { score: 0.9, band: 'high' },
          evidence: [
            {
              filePath: 'src/proxy.ts',
              startLine: 8,
              endLine: 12,
              reason: 'express proxy middleware passthrough',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'propertyAgent',
        },
      },
    ];

    const result = mergeAiProposals(components, makeBaseFlows(), proposals);
    const frontend = result.components.find((c) => c.id === 'asset_frontend');
    const relay = (
      frontend?.properties.dataActions as Array<{
        action: string;
        status?: string;
        source: string;
      }>
    )?.find((a) => a.action === 'relay');

    expect(result.appliedProposalIds).toEqual(['p_relay']);
    expect(relay?.status).toBe('asserted');
    expect(relay?.source).toBe('ai');
  });

  it('persists propertyEvidence for non-data-action properties onto the component', () => {
    const components = makeBaseComponents();
    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'p_cloud',
        proposal: {
          kind: 'component_patch',
          targetComponentId: 'asset_backend',
          candidateType: 'node_property',
          setProperties: {
            cloud_provider: 'aws',
            programming_language: ['typescript'],
          },
          propertyEvidence: {
            cloud_provider: [
              {
                filePath: 'infra/main.tf',
                startLine: 12,
                endLine: 18,
                reason: 'provider aws block',
              },
            ],
            programming_language: [
              {
                filePath: 'src/backend.ts',
                startLine: 1,
                endLine: 1,
                reason: 'typescript source file',
              },
            ],
          },
          confidence: { score: 0.9, band: 'high' },
          evidence: [
            {
              filePath: 'infra/main.tf',
              startLine: 12,
              endLine: 18,
              reason: 'provider aws block',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'propertyAgent',
        },
      },
    ];

    const result = mergeAiProposals(components, makeBaseFlows(), proposals);
    const backend = result.components.find((c) => c.id === 'asset_backend');
    const propertyEvidence = backend?.properties.propertyEvidence as
      | Record<string, Array<{ filePath: string; reason: string }>>
      | undefined;

    expect(result.appliedProposalIds).toEqual(['p_cloud']);
    expect(backend?.properties.cloud_provider).toBe('aws');
    expect(backend?.properties.programming_language).toEqual(['typescript']);
    expect(propertyEvidence?.cloud_provider).toEqual([
      {
        filePath: 'infra/main.tf',
        startLine: 12,
        endLine: 18,
        reason: 'provider aws block',
      },
    ]);
    expect(propertyEvidence?.programming_language).toEqual([
      {
        filePath: 'src/backend.ts',
        startLine: 1,
        endLine: 1,
        reason: 'typescript source file',
      },
    ]);
  });

  it('persists an AI patch with five or more independently cited keys', () => {
    const keys = [
      'cloud_provider',
      'programming_language',
      'hosting_type',
      'api_type',
      'authentication_method',
      'integration_status',
    ];
    const setProperties = Object.fromEntries(
      keys.map((key) => [key, `${key}_value`])
    );
    const propertyEvidence = Object.fromEntries(
      keys.map((key, index) => [
        key,
        [
          {
            filePath: 'src/backend.ts',
            startLine: index + 1,
            endLine: index + 1,
            reason: `${key} literal`,
          },
        ],
      ])
    );

    const result = mergeAiProposals(makeBaseComponents(), makeBaseFlows(), [
      {
        id: 'p_many_properties',
        proposal: {
          kind: 'component_patch',
          targetComponentId: 'asset_backend',
          candidateType: 'node_property',
          setProperties,
          propertyEvidence,
          confidence: { score: 0.9, band: 'high' },
          evidence: propertyEvidence.cloud_provider,
          provider: 'openai',
          model: 'x',
          agent: 'propertyAgent',
        },
      },
    ]);

    const backend = result.components.find((c) => c.id === 'asset_backend');
    for (const key of keys) {
      expect(backend?.properties[key]).toBe(`${key}_value`);
      expect(
        (
          backend?.properties.propertyEvidence as Record<
            string,
            Array<{ reason: string }>
          >
        )[key]
      ).toHaveLength(1);
    }
  });

  it('merges propertyEvidence by key without wiping unrelated existing evidence', () => {
    const components = makeBaseComponents();
    components[1]!.properties = {
      cloud_provider: 'aws',
      propertyEvidence: {
        cloud_provider: [
          {
            filePath: 'infra/main.tf',
            startLine: 1,
            endLine: 2,
            reason: 'existing aws evidence',
          },
        ],
        encrypt_at_rest: [
          {
            filePath: 'infra/db.tf',
            startLine: 5,
            endLine: 8,
            reason: 'existing encryption evidence',
          },
        ],
      },
    };

    const proposals: Array<{ id: string; proposal: AiProposal }> = [
      {
        id: 'p_lang',
        proposal: {
          kind: 'component_patch',
          targetComponentId: 'asset_backend',
          candidateType: 'node_property',
          setProperties: {
            programming_language: ['typescript'],
          },
          propertyEvidence: {
            programming_language: [
              {
                filePath: 'src/backend.ts',
                startLine: 1,
                endLine: 1,
                reason: 'typescript source',
              },
            ],
          },
          confidence: { score: 0.9, band: 'high' },
          evidence: [
            {
              filePath: 'src/backend.ts',
              startLine: 1,
              endLine: 1,
              reason: 'typescript source',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'propertyAgent',
        },
      },
    ];

    const result = mergeAiProposals(components, makeBaseFlows(), proposals);
    const backend = result.components.find((c) => c.id === 'asset_backend');
    const propertyEvidence = backend?.properties.propertyEvidence as
      | Record<string, Array<{ filePath: string }>>
      | undefined;

    expect(result.appliedProposalIds).toEqual(['p_lang']);
    expect(propertyEvidence?.encrypt_at_rest?.[0]?.filePath).toBe(
      'infra/db.tf'
    );
    expect(propertyEvidence?.cloud_provider?.[0]?.filePath).toBe(
      'infra/main.tf'
    );
    expect(propertyEvidence?.programming_language?.[0]?.filePath).toBe(
      'src/backend.ts'
    );
  });

  it('keeps a non-sparse scanner value and its evidence when AI disagrees', () => {
    const components = makeBaseComponents();
    components[1]!.properties = {
      cloud_provider: 'aws',
      propertyEvidence: {
        cloud_provider: [
          {
            filePath: 'infra/main.tf',
            startLine: 1,
            endLine: 2,
            reason: 'property.patterns.yaml:terraform_provider',
          },
        ],
      },
    };

    const result = mergeAiProposals(components, makeBaseFlows(), [
      {
        id: 'p_cloud_disagreement',
        proposal: {
          kind: 'component_patch',
          targetComponentId: 'asset_backend',
          candidateType: 'node_property',
          setProperties: { cloud_provider: 'gcp' },
          propertyEvidence: {
            cloud_provider: [
              {
                filePath: 'src/backend.ts',
                startLine: 1,
                endLine: 1,
                reason: 'AI inferred GCP',
              },
            ],
          },
          confidence: { score: 0.9, band: 'high' },
          evidence: [
            {
              filePath: 'src/backend.ts',
              startLine: 1,
              endLine: 1,
              reason: 'AI inferred GCP',
            },
          ],
          provider: 'openai',
          model: 'x',
          agent: 'propertyAgent',
        },
      },
    ]);

    const backend = result.components.find((c) => c.id === 'asset_backend');
    expect(backend?.properties.cloud_provider).toBe('aws');
    expect(backend?.properties.propertyEvidence).toEqual({
      cloud_provider: [
        {
          filePath: 'infra/main.tf',
          startLine: 1,
          endLine: 2,
          reason: 'property.patterns.yaml:terraform_provider',
        },
      ],
    });
    expect(result.rejectedProposalIds).toEqual([
      {
        proposalId: 'p_cloud_disagreement',
        reason: 'no_meaningful_changes',
      },
    ]);
  });
});
