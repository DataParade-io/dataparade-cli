import {
  normScanPath,
  resolveScannedFile,
} from "../../../src/ai-enrichment/scan-paths";

describe("scan-paths", () => {
  it("normScanPath normalizes separators", () => {
    expect(normScanPath("a\\b/c")).toBe("a/b/c");
  });

  it("resolveScannedFile matches exact and suffix paths", () => {
    const files = [
      {
        path: "pkg/handler.ts",
        name: "handler.ts",
        content: "",
        language: "typescript" as const,
        size: 0,
      },
    ];
    expect(resolveScannedFile(files, "pkg/handler.ts")?.path).toBe("pkg/handler.ts");
    expect(resolveScannedFile(files, "deep/pkg/handler.ts")?.path).toBe("pkg/handler.ts");
  });
});
