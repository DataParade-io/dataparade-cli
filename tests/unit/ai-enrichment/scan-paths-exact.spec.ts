import {
  resolveScannedFile,
  resolveScannedFileExact,
} from "../../../src/ai-enrichment/scan-paths";
import type { FileInfo } from "../../../src/core/types/file";

describe("resolveScannedFileExact", () => {
  const files: FileInfo[] = [
    {
      path: "packages/app/src/index.ts",
      name: "index.ts",
      content: "a",
      language: "typescript",
      size: 1,
    },
    {
      path: "app/src/index.ts",
      name: "index.ts",
      content: "b",
      language: "typescript",
      size: 1,
    },
  ];

  it("matches only exact paths", () => {
    expect(resolveScannedFileExact(files, "app/src/index.ts")?.content).toBe("b");
    expect(resolveScannedFileExact(files, "packages/app/src/index.ts")?.content).toBe(
      "a",
    );
    expect(resolveScannedFileExact(files, "src/index.ts")).toBeUndefined();
  });

  it("fuzzy resolveScannedFile suffix-matches when exact path is absent", () => {
    const match = resolveScannedFile(files, "src/index.ts");
    expect(match?.path).toMatch(/src\/index\.ts$/);
  });

  it("exact match does not pick the wrong file when two paths share a suffix", () => {
    expect(resolveScannedFileExact(files, "src/index.ts")).toBeUndefined();
    expect(resolveScannedFileExact(files, "app/src/index.ts")?.content).toBe("b");
    expect(resolveScannedFileExact(files, "packages/app/src/index.ts")?.content).toBe(
      "a",
    );
  });
});
