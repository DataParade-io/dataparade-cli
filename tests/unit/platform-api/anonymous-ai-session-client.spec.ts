import {
  cliAnonymousAiSession,
  CliAnonymousIpLimitError,
} from "../../../src/platform-api/anonymous-ai-session-client";

describe("cliAnonymousAiSession", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns session payload on success", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionToken: "dp_anon_abc",
        jobId: "job-1",
        suggestedAiBudgetTokens: 100000,
        expiresAt: "2026-01-01T00:00:00.000Z",
        aiDelivery: "platform_proxy",
      }),
    }) as unknown as typeof fetch;

    const out = await cliAnonymousAiSession({ projectName: "Demo" });
    expect(out.sessionToken).toBe("dp_anon_abc");
    expect(out.jobId).toBe("job-1");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/scans/cli/ai/anonymous-session"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws CliAnonymousIpLimitError on 429", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        message: "Too many anonymous CLI scans from this IP (max 3).",
      }),
    }) as unknown as typeof fetch;

    await expect(cliAnonymousAiSession()).rejects.toBeInstanceOf(
      CliAnonymousIpLimitError,
    );
  });
});
