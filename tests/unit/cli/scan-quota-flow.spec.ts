import fs from "fs";
import os from "os";
import path from "path";
import { run } from "../../../src/cli";

function jsonResponse(body: unknown, status = 200): {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  };
}

describe("scan quota flow", () => {
  let tempRoot: string;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dp-scan-quota-"));
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.exitCode = 0;
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.DATAPARADE_WORKSPACE_API_KEY;
    delete process.env.DATAPARADE_SKIP_AUTO_UPLOAD;
    process.exitCode = 0;
  });

  it("skips quota API when workspace key is present but AI is disabled", async () => {
    process.env.DATAPARADE_WORKSPACE_API_KEY = "dp_live_test";
    process.env.DATAPARADE_SKIP_AUTO_UPLOAD = "true";

    await run(["node", "cli", "scan", tempRoot]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prints workspace quota message when preflight is quota-blocked", async () => {
    process.env.DATAPARADE_WORKSPACE_API_KEY = "dp_live_test";
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          code: "scan_quota_exceeded",
          message: "No scan slots remaining in this workspace.",
          scansRemaining: 0,
          aiTokensRemaining: 1000,
        },
        403,
      ),
    );

    await run(["node", "cli", "scan", tempRoot, "--ai-inference"]);

    expect(errorSpy).toHaveBeenCalledWith(
      "[scan] workspace quota: No scan slots remaining in this workspace.",
    );
    errorSpy.mockRestore();
  });

  it("reports failed completion when preflight succeeds but config validation fails", async () => {
    process.env.DATAPARADE_WORKSPACE_API_KEY = "dp_live_test";
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          allowed: true,
          jobId: "job-123",
          scansRemaining: 2,
          aiTokensRemaining: 1000,
          suggestedAiBudgetTokens: 100,
          aiDelivery: "platform_proxy",
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await run([
      "node",
      "cli",
      "scan",
      tempRoot,
      "--ai-inference",
      "--ai-temperature",
      "not-a-number",
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/scans/cli/preflight");
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "/api/scans/cli/job-123/complete"
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual(
      expect.objectContaining({ status: "failed", failureCode: "scan_failed" })
    );
  });
});
