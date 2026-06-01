const mockCaptureException = jest.fn();
const mockFlush = jest.fn().mockResolvedValue(true);
const mockWithScope = jest.fn((cb: (scope: { setTag: jest.Mock; setExtra: jest.Mock; setExtras: jest.Mock }) => void) => {
  cb({
    setTag: jest.fn(),
    setExtra: jest.fn(),
    setExtras: jest.fn(),
  });
});
const mockInit = jest.fn();

jest.mock("@sentry/node", () => ({
  init: mockInit,
  captureException: mockCaptureException,
  flush: mockFlush,
  withScope: mockWithScope,
}));

import {
  flushCliSentry,
  reportScanCliError,
  resetCliSentryForTests,
} from "../../../src/observability/scan-sentry";

describe("scan-sentry", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetCliSentryForTests();
    process.env = { ...originalEnv };
    delete process.env.SCAN_SENTRY_ENABLED;
    delete process.env.SENTRY_DSN;
    delete process.env.SENTRY_ENVIRONMENT;
  });

  afterAll(() => {
    process.env = originalEnv;
    resetCliSentryForTests();
  });

  it("reports scan errors with cli tags when enabled", async () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/1";

    await reportScanCliError({
      error: new Error("scan blew up"),
      scanRoot: "/tmp/proj",
      jobId: "job-1",
      aiMode: "byok",
      aiProvider: "openai",
      failurePhase: "scan_pipeline",
      failureCode: "scan_errors",
    });

    expect(mockInit).toHaveBeenCalled();
    expect(mockCaptureException).toHaveBeenCalledWith(expect.any(Error));
    expect(mockFlush).toHaveBeenCalled();
  });

  it("is a no-op when SCAN_SENTRY_ENABLED=false", async () => {
    process.env.SCAN_SENTRY_ENABLED = "false";
    process.env.SENTRY_DSN = "https://example@sentry.io/1";

    await reportScanCliError({ error: new Error("ignored") });

    expect(mockInit).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("flushCliSentry does nothing when never initialized", async () => {
    await flushCliSentry();
    expect(mockFlush).not.toHaveBeenCalled();
  });
});
