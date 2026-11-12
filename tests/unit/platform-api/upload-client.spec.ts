import { cliUploadPreview } from '../../../src/platform-api/upload-client';

describe('cliUploadPreview', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('posts dataflow to upload endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ draftId: 'draft-1', projectName: 'proj' }),
    }) as typeof fetch;

    const result = await cliUploadPreview({
      apiKey: 'dp_live_testkey123456',
      dataflow: { schemaVersion: '1.0', graph: { nodes: [], edges: [] } },
      projectName: 'proj',
      scanJobId: 'job-1',
    });

    expect(result.draftId).toBe('draft-1');
    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body as string
    ) as Record<string, unknown>;
    expect(body).toEqual({
      dataflow: { schemaVersion: '1.0', graph: { nodes: [], edges: [] } },
      projectName: 'proj',
      scanJobId: 'job-1',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/scans/cli/upload'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer dp_live_testkey123456',
        }),
      })
    );
  });

  it('posts graphify, the knowledge graph, and Facts beside dataflow', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ draftId: 'draft-2', projectName: 'proj' }),
    }) as typeof fetch;

    const graphifyGraph = { nodes: [{ id: 'src/api.ts' }] };
    const dataparadeGraph = {
      nodes: [{ id: 'dp::cmp_a', dp_kind: 'component' }],
      links: [],
    };
    const facts = [
      {
        dataparade: {
          asserts: 'dp:scan/entity/occurrence:email:src/api.ts:4',
          asserted_slot: 'file_path',
          asserted_value: 'src/api.ts',
        },
      },
    ];

    await cliUploadPreview({
      apiKey: 'dp_live_testkey123456',
      dataflow: { schemaVersion: '1.0', graph: { nodes: [], edges: [] } },
      graphifyGraph,
      dataparadeGraph,
      facts,
    });

    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body as string
    ) as Record<string, unknown>;
    expect(body.graphifyGraph).toEqual(graphifyGraph);
    expect(body.dataparadeGraph).toEqual(dataparadeGraph);
    expect(body.facts).toEqual(facts);
    expect(body.dataflow).toEqual({
      schemaVersion: '1.0',
      graph: { nodes: [], edges: [] },
    });
  });

  it('posts scan files after the diagram, not inside the diagram body', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ draftId: 'draft-3', projectName: 'proj' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      }) as typeof fetch;

    await cliUploadPreview({
      apiKey: 'dp_live_testkey123456',
      dataflow: { schemaVersion: '1.0', graph: { nodes: [], edges: [] } },
      files: [
        {
          relativePath: 'graphify.json',
          content: '{"nodes":[]}',
        },
      ],
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
    const diagram = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body as string
    ) as Record<string, unknown>;
    expect(diagram.graphifyGraph).toBeUndefined();
    const filesUrl = (global.fetch as jest.Mock).mock.calls[1][0] as string;
    expect(filesUrl).toContain('/api/scans/cli/upload/draft-3/files');
    const filesBody = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[1][1].body as string
    ) as { files: Array<{ relativePath: string }> };
    expect(filesBody.files[0]?.relativePath).toBe('graphify.json');
  });

  it('completes the upload once after the files, with the remote URL', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ draftId: 'draft-4', projectName: 'proj' }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }) as typeof fetch;

    await cliUploadPreview({
      apiKey: 'dp_live_testkey123456',
      dataflow: {},
      files: [{ relativePath: 'facts.json', content: '{"scan":{}}' }],
      remoteUrl: 'https://github.com/org/repo',
    });

    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[2][0]).toContain('/api/scans/cli/upload/draft-4/complete');
    expect(calls[2][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer dp_live_testkey123456',
      }),
    });
    expect(JSON.parse(calls[2][1].body as string)).toEqual({
      remoteUrl: 'https://github.com/org/repo',
    });
  });

  it('sends the rename map with a diff --upload head and returns the comparison (DATAP-890)', async () => {
    const complete = {
      stored: true,
      scanId: 'scan-1',
      repositoryId: 'repo-1',
      created: true,
      comparable: true,
      comparison: { compared: false, reason: 'no_base_scan', message: 'none' },
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ draftId: 'draft-5' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => complete,
      }) as typeof fetch;
    const compare = {
      baseCommitSha: 'b'.repeat(40),
      rootCommitSha: 'a'.repeat(40),
      renames: [{ from: 'a.ts', to: 'b.ts', similarity: 90 }],
    };

    const result = await cliUploadPreview({
      apiKey: 'dp_live_testkey123456',
      dataflow: {},
      files: [{ relativePath: 'facts.json', content: '{"scan":{}}' }],
      remoteUrl: null,
      compare,
    });

    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(JSON.parse(calls[2][1].body as string)).toEqual({ compare });
    expect(result.complete).toEqual(complete);
  });

  it('does not complete an upload without scan files', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ draftId: 'draft-5' }),
    }) as typeof fetch;

    await cliUploadPreview({ apiKey: 'dp_live_testkey123456', dataflow: {} });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a rejected completion', { ok: false, status: 500, json: async () => ({}) }],
    ['a network error', new Error('socket hang up')],
  ])('only warns on %s', async (_label, outcome) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ draftId: 'draft-6' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    if (outcome instanceof Error) fetchMock.mockRejectedValueOnce(outcome);
    else fetchMock.mockResolvedValueOnce(outcome);
    global.fetch = fetchMock as typeof fetch;

    const result = await cliUploadPreview({
      apiKey: 'dp_live_testkey123456',
      dataflow: {},
      files: [{ relativePath: 'facts.json', content: '{}' }],
    });

    expect(result.draftId).toBe('draft-6');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({});
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('not stored for comparison')
    );
  });

  it('throws with API error message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Invalid dataflow' }),
    }) as typeof fetch;

    await expect(
      cliUploadPreview({
        apiKey: 'dp_live_testkey123456',
        dataflow: {},
      })
    ).rejects.toThrow('Invalid dataflow');
  });
});
