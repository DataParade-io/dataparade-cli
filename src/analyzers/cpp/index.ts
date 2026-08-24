import type { Analyzer } from "../types";
import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { detectCppPatterns } from "./detector";

export function createCppAnalyzer(): Analyzer {
  return {
    detect(file: FileInfo): RawFinding[] {
      return detectCppPatterns(file);
    },
  };
}
