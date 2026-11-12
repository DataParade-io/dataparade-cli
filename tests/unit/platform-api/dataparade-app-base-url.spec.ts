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

  it("uses the app the API names when DATAPARADE_APP_URL is unset", () => {
    expect(getDataparadeAppBaseUrl({}, "https://dev-app.example.com/")).toBe("https://dev-app.example.com");
  });

  it("prefers DATAPARADE_APP_URL over the app the API names", () => {
    expect(getDataparadeAppBaseUrl({ DATAPARADE_APP_URL: "http://localhost:3001" }, "https://dev-app.example.com")).toBe("http://localhost:3001");
  });

  it("ignores an app URL from the API that is not http(s)", () => {
    expect(getDataparadeAppBaseUrl({}, "javascript:alert(1)")).toBe(DEFAULT_DATAPARADE_APP_URL);
  });
});
