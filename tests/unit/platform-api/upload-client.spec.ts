import { cliUploadPreview } from "../../../src/platform-api/upload-client";

describe("cliUploadPreview", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("posts dataflow to upload endpoint", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ draftId: "draft-1", projectName: "proj" }),
    }) as typeof fetch;

    const result = await cliUploadPreview({
      apiKey: "dp_live_testkey123456",
      dataflow: { schemaVersion: "1.0", graph: { nodes: [], edges: [] } },
      projectName: "proj",
      scanJobId: "job-1",
    });

    expect(result.draftId).toBe("draft-1");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/scans/cli/upload"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer dp_live_testkey123456",
        }),
      }),
    );
  });

  it("throws with API error message", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "Invalid dataflow" }),
    }) as typeof fetch;

    await expect(
      cliUploadPreview({
        apiKey: "dp_live_testkey123456",
        dataflow: {},
      }),
    ).rejects.toThrow("Invalid dataflow");
  });
});
