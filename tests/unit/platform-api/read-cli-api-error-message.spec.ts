import {
  parseCliApiErrorBody,
  readCliApiErrorMessage,
} from "../../../src/platform-api/read-cli-api-error-message";

describe("readCliApiErrorMessage", () => {
  it("reads flat quota error body", () => {
    expect(
      readCliApiErrorMessage(
        {
          code: "scan_quota_exceeded",
          message: "No scan slots remaining in this workspace.",
        },
        "fallback",
      ),
    ).toEqual({
      code: "scan_quota_exceeded",
      message: "No scan slots remaining in this workspace.",
    });
  });

  it("reads nested Nest conflict error body", () => {
    expect(
      readCliApiErrorMessage(
        {
          statusCode: 409,
          message: {
            code: "scan_already_running",
            message:
              "Scan in progress — start a new scan after the current one completes.",
          },
        },
        "fallback",
      ),
    ).toEqual({
      code: "scan_already_running",
      message:
        "Scan in progress — start a new scan after the current one completes.",
    });
  });

  it("joins validation message arrays", () => {
    expect(
      parseCliApiErrorBody({
        message: ["field is required", "field must be a string"],
      }),
    ).toEqual({
      message: "field is required, field must be a string",
    });
  });

  it("falls back when message is missing", () => {
    expect(readCliApiErrorMessage({}, "Scan preflight failed (500)")).toEqual({
      message: "Scan preflight failed (500)",
    });
  });
});
