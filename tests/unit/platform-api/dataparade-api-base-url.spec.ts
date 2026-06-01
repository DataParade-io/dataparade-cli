import {
  DEFAULT_DATAPARADE_API_BASE_URL,
  getDataparadeApiBaseUrl,
} from "../../../src/platform-api/dataparade-api-base-url";

describe("getDataparadeApiBaseUrl", () => {
  it("defaults to production AWS API when unset", () => {
    expect(getDataparadeApiBaseUrl({})).toBe(DEFAULT_DATAPARADE_API_BASE_URL);
  });

  it("prefers DATAPARADE_API_BASE_URL over legacy DATAPARADE_API_URL", () => {
    expect(
      getDataparadeApiBaseUrl({
        DATAPARADE_API_BASE_URL: "http://localhost:3000/",
        DATAPARADE_API_URL: "https://other.example.com",
      }),
    ).toBe("http://localhost:3000");
  });

  it("strips trailing slash", () => {
    expect(
      getDataparadeApiBaseUrl({
        DATAPARADE_API_URL: "https://api.example.com/",
      }),
    ).toBe("https://api.example.com");
  });
});
