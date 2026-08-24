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

  it("retries when a task fails because Lambda is still initializing", async () => {
    let posts = 0;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/scans/cli/ai/infer/tasks") && method === "POST") {
        posts += 1;
        return new Response(
          JSON.stringify({
            tasks: [{ taskId: `t-${posts}`, status: "pending" }],
          }),
          { status: 202 },
        );
      }

      if (url.includes("taskIds=t-1") && method === "GET") {
        return new Response(
          JSON.stringify({
            tasks: [
              {
                taskId: "t-1",
                status: "failed",
                errorMessage:
                  "ERROR: Lambda is initializing your function. It will be ready to invoke shortly.",
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url.includes("taskIds=t-2") && method === "GET") {
        return new Response(
          JSON.stringify({
            tasks: [
              {
                taskId: "t-2",
                status: "completed",
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
      lambdaInitRetryDelaysMs: [0],
      sleep: async () => undefined,
    });

    const result = await provider.infer({
      prompt: "test",
      model: "gpt-4o-mini",
    });

    expect(result.proposals).toHaveLength(1);
    expect(posts).toBe(2);
  });

  it("does not leak the AWS INIT message after retries are exhausted", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/scans/cli/ai/infer/tasks") && method === "POST") {
        return new Response(
          JSON.stringify({ tasks: [{ taskId: "t-1", status: "pending" }] }),
          { status: 202 },
        );
      }
      return new Response(
        JSON.stringify({
          tasks: [
            {
              taskId: "t-1",
              status: "failed",
              errorMessage:
                "ERROR: Lambda is initializing your function. It will be ready to invoke shortly.",
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = new PlatformProxyProvider({
      apiBaseUrl: "https://api.example.com",
      workspaceApiKey: "dp_test",
      jobId: "job-1",
      pollIntervalMs: 1,
      pollTimeoutMs: 5000,
      lambdaInitRetryDelaysMs: [0],
      sleep: async () => undefined,
    });

    await expect(
      provider.infer({ prompt: "test", model: "gpt-4o-mini" }),
    ).rejects.toThrow("Platform AI is still starting");
  });
});
