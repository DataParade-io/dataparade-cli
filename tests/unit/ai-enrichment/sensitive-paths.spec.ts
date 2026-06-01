import { isSensitiveEnvPath, isSensitiveFileForAiPrompt } from "../../../src/ai-enrichment/sensitive-paths";
import type { FileInfo } from "../../../src/core/types/file";

describe("sensitive-paths", () => {
  it("detects .env paths", () => {
    expect(isSensitiveEnvPath(".env")).toBe(true);
    expect(isSensitiveEnvPath("apps/api/.env.local")).toBe(true);
    expect(isSensitiveEnvPath("src/config.ts")).toBe(false);
  });

  it("flags env language files for AI prompts", () => {
    const envFile: FileInfo = {
      path: "ignored.env",
      name: "ignored.env",
      content: "SECRET=x",
      language: "env",
      size: 8,
    };
    expect(isSensitiveFileForAiPrompt(envFile)).toBe(true);
  });
});
