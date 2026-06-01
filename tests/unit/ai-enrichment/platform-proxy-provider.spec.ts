import { PlatformProxyProvider } from "../../../src/ai-enrichment/providers/platform-proxy-provider";

describe("PlatformProxyProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("submits a task and polls until completed", async () => {
    const calls: { url: string; method: string }[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });

      if (url.endsWith("/api/scans/cli/ai/infer/tasks") && method === "POST") {
        return new Response(
          JSON.stringify({
            tasks: [{ taskId: "t-1", status: "pending" }],
          }),
          { status: 202 },
        );
      }

      if (url.includes("/api/scans/cli/ai/infer/tasks?") && method === "GET") {
        const done = calls.filter((c) => c.method === "GET").length >= 2;
        return new Response(
          JSON.stringify({
            tasks: [
              {
                taskId: "t-1",
                status: done ? "completed" : "running",
                proposals: [{ kind: "setProperties", candidateType: "component" }],
                usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const provider = new PlatformProxyProvider({
      apiBaseUrl: "https://api.example.com",
      workspaceApiKey: "dp_test",
      jobId: "job-1",
      pollIntervalMs: 1,
      pollTimeoutMs: 5000,
    });

    const result = await provider.infer({
      prompt: "test",
      model: "gpt-4o-mini",
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.usage?.totalTokens).toBe(3);
    expect(calls.some((c) => c.method === "POST")).toBe(true);
    expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThanOrEqual(1);
  });
});
