import {
  isCliTelemetryEnabled,
  reportCliUsageEvent,
} from "../../../src/platform-api/telemetry-client";

describe("isCliTelemetryEnabled", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    delete process.env.DATAPARADE_TELEMETRY;
    delete process.env.SCAN_TELEMETRY_ENABLED;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("is off in test unless explicitly enabled", () => {
    process.env.NODE_ENV = "test";
    delete process.env.DATAPARADE_TELEMETRY;
    expect(isCliTelemetryEnabled({ NODE_ENV: "test" })).toBe(false);
  });

  it("honors DATAPARADE_TELEMETRY=false", () => {
    expect(
      isCliTelemetryEnabled({ DATAPARADE_TELEMETRY: "false", NODE_ENV: "production" }),
    ).toBe(false);
  });

  it("honors SCAN_TELEMETRY_ENABLED=false", () => {
    expect(
      isCliTelemetryEnabled({
        SCAN_TELEMETRY_ENABLED: "false",
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });
});

describe("reportCliUsageEvent", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("does not throw when the API returns 5xx", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(
      reportCliUsageEvent(
        {
          sessionId: "11111111-1111-4111-8111-111111111111",
          event: "scan_started",
          command: "scan",
        },
        { DATAPARADE_TELEMETRY: "true", NODE_ENV: "test" },
      ),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("is a no-op when telemetry is disabled", async () => {
    await reportCliUsageEvent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        event: "scan_started",
      },
      { DATAPARADE_TELEMETRY: "false" },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
