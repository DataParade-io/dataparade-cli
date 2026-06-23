import { resolveSkipAutoUpload } from "../../../src/config/upload-env";

describe("resolveSkipAutoUpload", () => {
  it("is false when unset", () => {
    expect(resolveSkipAutoUpload({})).toBe(false);
  });

  it("is true for truthy env values", () => {
    expect(resolveSkipAutoUpload({ DATAPARADE_SKIP_AUTO_UPLOAD: "true" })).toBe(
      true,
    );
    expect(resolveSkipAutoUpload({ DATAPARADE_SKIP_AUTO_UPLOAD: "1" })).toBe(
      true,
    );
  });
});
