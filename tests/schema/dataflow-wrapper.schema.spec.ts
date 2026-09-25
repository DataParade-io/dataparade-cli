import {
  dataflowWrapperSchema,
  gitContextSchema,
  validateDataflowJson,
} from '../../src/core/schema/dataflow-wrapper.schema';
describe('dataflowWrapperSchema', () => {
  it('accepts a valid dataflow.json wrapper', () => {
    const input = {
      schemaVersion: '1.0',
      graph: {
        nodes: [
          {
            id: 'n1',
            type: 'asset',
            position: { x: 0, y: 0 },
            data: { label: 'Node 1', privacy: {} },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      metadata: {
        componentsCount: 1,
        dataFlowsCount: 0,
        filesScanned: 10,
        scanDurationMs: 100,
      },
    };

    const result = validateDataflowJson(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graph.nodes[0].id).toBe('n1');
    }
  });

  it('accepts metadata.terraform when shape matches CLI output', () => {
    const input = {
      schemaVersion: '1.0',
      graph: {
        nodes: [
          {
            id: 'n1',
            type: 'asset',
            position: { x: 0, y: 0 },
            data: { label: 'Node 1', privacy: {} },
          },
        ],
        edges: [],
      },
      metadata: {
        componentsCount: 1,
        terraform: {
          mode: 'json_overlay',
          staticTfFiles: 2,
          jsonInputPath: '/tmp/plan.json',
          jsonFindingsMerged: 1,
        },
      },
    };

    const result = validateDataflowJson(input);
    expect(result.ok).toBe(true);
  });

  it('rejects wrappers missing schemaVersion or graph', () => {
    const input = {
      graph: {},
    } as unknown;

    const result = validateDataflowJson(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const message = result.errors.join(' | ');
      expect(message).toMatch(/schemaVersion/);
    }
  });

  it('rejects invalid graph structures', () => {
    const input = {
      schemaVersion: '1.0',
      graph: {
        nodes: [
          {
            id: '',
            type: 'asset',
            position: { x: 0, y: 0 },
            data: { label: 'Invalid Node', privacy: {} },
          },
        ],
        edges: [],
      },
    };

    const result = dataflowWrapperSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('accepts metadata.gitContext for evidence linking', () => {
    const input = {
      schemaVersion: '1.0',
      graph: {
        nodes: [
          {
            id: 'n1',
            type: 'asset',
            position: { x: 0, y: 0 },
            data: { label: 'Node 1', privacy: {} },
          },
        ],
        edges: [],
      },
      metadata: {
        componentsCount: 1,
        gitContext: {
          provider: 'github',
          repository: 'dataparade-io/dataparade',
          commitSha: 'abc1234567890abc1234567890abc1234567890a',
        },
      },
    };

    const result = validateDataflowJson(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata?.gitContext).toEqual({
        provider: 'github',
        repository: 'dataparade-io/dataparade',
        commitSha: 'abc1234567890abc1234567890abc1234567890a',
      });
    }
  });

  it('accepts metadata.gitContext with baseUrl for self-hosted GitLab', () => {
    const input = {
      schemaVersion: '1.0',
      graph: {
        nodes: [],
        edges: [],
      },
      metadata: {
        gitContext: {
          provider: 'gitlab',
          repository: 'internal/project',
          commitSha: 'def1234567890def1234567890def1234567890d',
          baseUrl: 'https://gitlab.mycompany.com',
        },
      },
    };

    const result = validateDataflowJson(input);
    expect(result.ok).toBe(true);
  });
});

describe('gitContextSchema', () => {
  it('accepts valid GitHub context', () => {
    const result = gitContextSchema.safeParse({
      provider: 'github',
      repository: 'owner/repo',
      commitSha: 'abc1234567890abc1234567890abc1234567890a',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid GitLab context', () => {
    const result = gitContextSchema.safeParse({
      provider: 'gitlab',
      repository: 'group/project',
      commitSha: 'def1234567890def1234567890def1234567890d',
    });
    expect(result.success).toBe(true);
  });

  it('accepts baseUrl for self-hosted instances', () => {
    const result = gitContextSchema.safeParse({
      provider: 'gitlab',
      repository: 'internal/project',
      commitSha: '1234567890123456789012345678901234567890',
      baseUrl: 'https://gitlab.mycompany.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseUrl).toBe('https://gitlab.mycompany.com');
    }
  });

  it('rejects invalid provider', () => {
    const result = gitContextSchema.safeParse({
      provider: 'bitbucket',
      repository: 'owner/repo',
      commitSha: 'abc1234567890abc1234567890abc1234567890a',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty repository', () => {
    const result = gitContextSchema.safeParse({
      provider: 'github',
      repository: '',
      commitSha: 'abc1234567890abc1234567890abc1234567890a',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid commitSha (not 40 hex chars)', () => {
    const shortSha = gitContextSchema.safeParse({
      provider: 'github',
      repository: 'owner/repo',
      commitSha: 'abc123',
    });
    expect(shortSha.success).toBe(false);

    const invalidChars = gitContextSchema.safeParse({
      provider: 'github',
      repository: 'owner/repo',
      commitSha: 'xyz1234567890xyz1234567890xyz1234567890z',
    });
    expect(invalidChars.success).toBe(false);
  });

  it('rejects invalid baseUrl', () => {
    const result = gitContextSchema.safeParse({
      provider: 'gitlab',
      repository: 'internal/project',
      commitSha: '1234567890123456789012345678901234567890',
      baseUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});
