import { fetchWithTimeout } from "../../../../src/ai-enrichment/providers/fetch-with-timeout";

describe("fetchWithTimeout", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it("aborts when the request exceeds timeoutMs", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;

    const promise = fetchWithTimeout("https://example.com", { method: "GET" }, 50);
    const expectation = expect(promise).rejects.toThrow();
    jest.advanceTimersByTime(60);
    await expectation;
  });
});
