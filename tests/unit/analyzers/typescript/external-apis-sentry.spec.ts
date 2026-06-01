import type { FileInfo } from "../../../../src/core/types/file";
import { detectExternalApiCalls } from "../../../../src/analyzers/typescript/third-party-detection";
import { buildCodeModel } from "../../../../src/analyzers/typescript/parser";

describe("TS external API detection - Sentry", () => {
  it("infers serviceName 'sentry' from fetch calls to Sentry ingestion URLs", () => {
    const content = `
      fetch("https://o123456.ingest.sentry.io/api/123/envelope/", {
        method: "POST",
        body: "{}",
      });
    `;

    const file: FileInfo = {
      path: "src/monitoring/sentry-example.ts",
      name: "sentry-example.ts",
      language: "typescript",
      size: content.length,
      content,
    };

    const model = buildCodeModel(file);
    const findings = detectExternalApiCalls(file, model);

    const sentryFinding = findings.find(
      (f) =>
        f.pattern === "external_api_call" &&
        f.properties?.serviceName === "sentry",
    );

    expect(sentryFinding).toBeDefined();
    expect(sentryFinding?.properties?.url).toBe(
      "https://o123456.ingest.sentry.io/api/123/envelope/",
    );
  });
});

