import type { FileInfo } from "../core/types/file";
import { isSensitiveEnvPath } from "../ingest/sensitive-paths";

export { isSensitiveEnvPath };

/** True when file content must not be embedded in provider prompts. */
export function isSensitiveFileForAiPrompt(file: FileInfo): boolean {
  return file.language === "env" || isSensitiveEnvPath(file.path);
}
