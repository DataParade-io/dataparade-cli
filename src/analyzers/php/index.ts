import type { Analyzer } from "../types";
import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { detectPhpPatterns } from "./detector";

export function createPhpAnalyzer(): Analyzer {
  return {
    detect(file: FileInfo): RawFinding[] {
      return detectPhpPatterns(file);
    },
  };
}
