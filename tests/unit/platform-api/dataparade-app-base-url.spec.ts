import {
  DEFAULT_DATAPARADE_APP_URL,
  getDataparadeAppBaseUrl,
} from "../../../src/platform-api/dataparade-app-base-url";

describe("getDataparadeAppBaseUrl", () => {
  it("defaults to production frontend URL", () => {
    expect(getDataparadeAppBaseUrl({})).toBe(DEFAULT_DATAPARADE_APP_URL);
  });

  it("strips trailing slash from DATAPARADE_APP_URL", () => {
    expect(
      getDataparadeAppBaseUrl({
        DATAPARADE_APP_URL: "http://localhost:3001/",
      }),
    ).toBe("http://localhost:3001");
  });
});
