import { runDataflowUpload } from "../../../src/upload/run-upload";

jest.mock("../../../src/platform-api/upload-client", () => ({
  cliUploadAnonymousPreview: jest.fn(),
  cliUploadPreview: jest.fn(),
}));

jest.mock("../../../src/platform-api/telemetry-client", () => ({
  reportCliUsageEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../src/upload/build-preview-url", () => ({
  buildAnonymousCliPreviewUrl: jest.fn(
    (token: string) => `https://app.example/preview/cli/${token}`,
  ),
  buildImportPreviewUrl: jest.fn(
    (draftId: string) => `https://app.example/dashboard?importDraft=${draftId}`,
  ),
}));

import {
  cliUploadAnonymousPreview,
  cliUploadPreview,
} from "../../../src/platform-api/upload-client";
import { reportCliUsageEvent } from "../../../src/platform-api/telemetry-client";

describe("runDataflowUpload anonymous path", () => {
  const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    logSpy.mockRestore();
  });

  it("passes scanJobId to anonymous upload and mentions claim quota", async () => {
    (cliUploadAnonymousPreview as jest.Mock).mockResolvedValue({
      claimToken: "claim-1",
      expiresAt: new Date().toISOString(),
      projectName: "Proj",
    });

    const result = await runDataflowUpload({
      dataflow: { schemaVersion: "1.0" },
      projectName: "Proj",
      scanJobId: "job-anon-1",
      logPrefix: "[scan]",
    });

    expect(cliUploadAnonymousPreview).toHaveBeenCalledWith({
      dataflow: { schemaVersion: "1.0" },
      projectName: "Proj",
      scanJobId: "job-anon-1",
      cliUsageSessionId: undefined,
      command: "scan",
    });
    expect(cliUploadPreview).not.toHaveBeenCalled();
    expect(result.previewUrl).toContain("claim-1");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Claiming this preview after signup uses 1 scan slot"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("platform AI tokens"),
    );
  });

  it("reports upload_failed and rethrows", async () => {
    (cliUploadAnonymousPreview as jest.Mock).mockRejectedValue(
      new Error("network down"),
    );

    await expect(
      runDataflowUpload({
        dataflow: { schemaVersion: "1.0" },
        cliUsageSessionId: "11111111-1111-4111-8111-111111111111",
        logPrefix: "[scan]",
      }),
    ).rejects.toThrow("network down");

    expect(reportCliUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "upload_failed",
        errorCode: "upload_failed",
      }),
    );
  });
});
