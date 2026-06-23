import { buildImportPreviewUrl } from "../../../src/upload/build-preview-url";

describe("buildImportPreviewUrl", () => {
  const original = process.env.DATAPARADE_APP_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DATAPARADE_APP_URL;
    } else {
      process.env.DATAPARADE_APP_URL = original;
    }
  });

  it("builds dashboard deep link with importDraft query param", () => {
    process.env.DATAPARADE_APP_URL = "http://localhost:3001";
    const url = buildImportPreviewUrl("draft-abc");
    expect(url).toBe(
      "http://localhost:3001/dashboard?importDraft=draft-abc",
    );
  });
});
