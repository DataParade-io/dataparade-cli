import {
  isLambdaInitializingError,
  LAMBDA_INITIALIZING_USER_MESSAGE,
  toUserFacingLambdaInitError,
} from "../../../src/ai-enrichment/lambda-init-error";

describe("lambda-init-error", () => {
  it("detects the AWS INIT message", () => {
    expect(
      isLambdaInitializingError(
        new Error(
          "ERROR: Lambda is initializing your function. It will be ready to invoke shortly.",
        ),
      ),
    ).toBe(true);
  });

  it("maps INIT errors to a user-facing message", () => {
    expect(
      toUserFacingLambdaInitError(
        new Error("Lambda is initializing your function."),
      ).message,
    ).toBe(LAMBDA_INITIALIZING_USER_MESSAGE);
  });
});
